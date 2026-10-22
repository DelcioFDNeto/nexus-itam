// =============================================================================
// Nexus ITAM - Agente Windows (NexusAgent.exe) 3.1
// -----------------------------------------------------------------------------
// Um executavel, dois papeis:
//  --service  Servico do Windows (SYSTEM): sinal de vida, telemetria, comandos
//             remotos e inventario completo. Funciona antes do logon e sem
//             ninguem na maquina.
//  (padrao)   Bandeja na sessao do colaborador: ID de acesso, pedido de
//             suporte, consentimento e transmissao da tela no acesso remoto,
//             mensagens e bloqueio de tela. Sem o servico (modo portatil), a
//             bandeja faz tudo sozinha.
//
// Identidade: login anonimo do Firebase + matricula em /agentEnrollments feita
// UMA vez com prova do token da empresa (sha256(token:uid)). Na matricula o
// token sai do config.json; a credencial da maquina fica em device.dat (DPAPI).
// Nenhum documento gravado pelo agente carrega o token. Ver firestore.rules,
// secao AGENTE ITAM.
//
// Cota do Firestore: sem polling ocioso. O console "acorda" a maquina gravando
// consoleWakeAt em agentDevices e o agente le esse campo na resposta do proprio
// sinal de vida. Acordado, consulta o canal de controle a cada 2 s.
//
// Privacidade: tela so com sessao aberta, aviso fixo na tela durante a sessao,
// o colaborador encerra quando quiser e o ultimo frame e apagado ao final.
//
// Compila com o csc.exe do .NET Framework 4.x (C# 5), sem dependencias:
//   csc /target:winexe /r:System.dll /r:System.Core.dll /r:System.Drawing.dll
//       /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll
//       /r:System.Management.dll /r:System.Security.dll
//       /r:System.ServiceProcess.dll NexusAgent.cs
// =============================================================================

using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Management;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Nexus ITAM Agent")]
[assembly: AssemblyDescription("Agente de inventario, monitoramento e suporte remoto do Nexus ITAM")]
[assembly: AssemblyCompany("Nexus ITAM")]
[assembly: AssemblyProduct("Nexus ITAM")]
[assembly: AssemblyCopyright("Nexus ITAM")]
[assembly: AssemblyVersion("3.1.0.0")]
[assembly: AssemblyFileVersion("3.1.0.0")]

namespace NexusITAM
{
    internal static class AgentInfo
    {
        public const string Version = "3.1.0";
        public const string ServiceName = "NexusITAMAgent";
        public const string ServiceDisplayName = "Nexus ITAM Agent";
        public const string RunValueName = "NexusITAMAgent";
        public const string LegacyTaskName = "NexusITAM_AgentSync";
        public const string SyncEventName = @"Global\NexusITAMSyncNow";
        public const string ShortcutName = "Nexus ITAM - Suporte.lnk";
        public const string LegacyShortcutName = "Nexus ITAM - Suporte e Agente.lnk";

        // Preenchidos pelo instalador (agentScripts.js) e pelo build
        // (scripts/build-agent.mjs). Sem preenchimento, valem os do config.json.
        public const string BuildProjectId = "__PROJECT_ID__";
        public const string BuildApiKey = "__API_KEY__";

        public static string Filled(string value, string fallback)
        {
            return string.IsNullOrEmpty(value) || value.StartsWith("__", StringComparison.Ordinal) ? fallback : value;
        }
    }

    // -------------------------------------------------------------------------
    // Win32
    // -------------------------------------------------------------------------
    internal static class NativeMethods
    {
        [DllImport("user32.dll")]
        public static extern bool SetCursorPos(int x, int y);

        [DllImport("user32.dll")]
        public static extern bool GetCursorPos(out POINT point);

        [DllImport("user32.dll")]
        public static extern void mouse_event(uint flags, int dx, int dy, int data, UIntPtr extraInfo);

        [DllImport("user32.dll")]
        public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extraInfo);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint SendInput(uint count, INPUT[] inputs, int size);

        [DllImport("user32.dll")]
        public static extern bool LockWorkStation();

        [DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();

        [DllImport("kernel32.dll")]
        public static extern ulong GetTickCount64();

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool GetSystemTimes(out long idle, out long kernel, out long user);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GlobalMemoryStatusEx([In, Out] MEMORYSTATUSEX buffer);

        public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        public const uint MOUSEEVENTF_LEFTUP = 0x0004;
        public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        public const uint MOUSEEVENTF_WHEEL = 0x0800;
        public const uint KEYEVENTF_KEYUP = 0x0002;
        public const uint KEYEVENTF_UNICODE = 0x0004;
        public const uint INPUT_KEYBOARD = 1;

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT
        {
            public int X;
            public int Y;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Explicit)]
        public struct INPUTUNION
        {
            [FieldOffset(0)] public MOUSEINPUT mi;
            [FieldOffset(0)] public KEYBDINPUT ki;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct INPUT
        {
            public uint type;
            public INPUTUNION u;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
        public class MEMORYSTATUSEX
        {
            public uint dwLength;
            public uint dwMemoryLoad;
            public ulong ullTotalPhys;
            public ulong ullAvailPhys;
            public ulong ullTotalPageFile;
            public ulong ullAvailPageFile;
            public ulong ullTotalVirtual;
            public ulong ullAvailVirtual;
            public ulong ullAvailExtendedVirtual;

            public MEMORYSTATUSEX()
            {
                dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX));
            }
        }
    }

    // -------------------------------------------------------------------------
    // Pastas e log
    // -------------------------------------------------------------------------
    internal static class AgentPaths
    {
        private static string _dataDir;

        public static string MachineDir
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "NexusITAM"); }
        }

        public static string UserDir
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NexusITAM"); }
        }

        public static string DataDir
        {
            get { return _dataDir ?? MachineDir; }
            set { _dataDir = value; }
        }

        public static string ConfigFile { get { return Path.Combine(DataDir, "config.json"); } }
        public static string CredentialFile { get { return Path.Combine(DataDir, "device.dat"); } }
        public static string WakeFile { get { return Path.Combine(DataDir, "wake.json"); } }
        public static string CollectorScript { get { return Path.Combine(DataDir, "NexusAgent.ps1"); } }
        public static string LogDir { get { return Path.Combine(DataDir, "logs"); } }
        public static string InstalledExe { get { return Path.Combine(MachineDir, "NexusAgent.exe"); } }

        // Estado de quem executa comandos: o servico grava na pasta da maquina
        // (so SYSTEM/Administradores alteram); a bandeja, no perfil do usuario.
        public static string StateFile(bool service)
        {
            return service
                ? Path.Combine(DataDir, "service-state.json")
                : Path.Combine(UserDir, "tray-state.json");
        }

        /// <summary>Instalada (ProgramData) ou portatil (perfil do usuario)?</summary>
        public static void Resolve()
        {
            if (_dataDir != null) return;
            if (File.Exists(Path.Combine(MachineDir, "device.dat")) || File.Exists(Path.Combine(MachineDir, "config.json"))) return;
            if (File.Exists(Path.Combine(UserDir, "device.dat"))) _dataDir = UserDir;
        }
    }

    internal static class AgentLog
    {
        private static readonly object Sync = new object();
        private static string _name = "agent";

        public static void Init(string name)
        {
            _name = name;
        }

        public static void Write(string format, params object[] args)
        {
            string message = args != null && args.Length > 0 ? string.Format(CultureInfo.InvariantCulture, format, args) : format;
            string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) + " " + message;
            lock (Sync)
            {
                foreach (string dir in new string[] { AgentPaths.LogDir, Path.Combine(AgentPaths.UserDir, "logs") })
                {
                    try
                    {
                        Directory.CreateDirectory(dir);
                        string file = Path.Combine(dir, _name + ".log");
                        FileInfo info = new FileInfo(file);
                        if (info.Exists && info.Length > 1024 * 1024)
                        {
                            File.Copy(file, file + ".old", true);
                            File.Delete(file);
                        }
                        File.AppendAllText(file, line + Environment.NewLine, Encoding.UTF8);
                        return;
                    }
                    catch { }
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // JSON e formato do Firestore REST
    // -------------------------------------------------------------------------
    internal static class Json
    {
        public static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer { MaxJsonLength = 32 * 1024 * 1024 };

        public static Dictionary<string, object> ParseObject(string json)
        {
            try
            {
                return Serializer.DeserializeObject(json) as Dictionary<string, object>;
            }
            catch
            {
                return null;
            }
        }

        public static string Str(Dictionary<string, object> d, string key)
        {
            object v;
            return d != null && d.TryGetValue(key, out v) && v != null ? Convert.ToString(v, CultureInfo.InvariantCulture) : "";
        }

        public static Dictionary<string, object> Map(Dictionary<string, object> d, string key)
        {
            object v;
            return d != null && d.TryGetValue(key, out v) ? v as Dictionary<string, object> : null;
        }

        public static long Long(Dictionary<string, object> d, string key, long fallback)
        {
            object v;
            if (d == null || !d.TryGetValue(key, out v) || v == null) return fallback;
            try { return Convert.ToInt64(v, CultureInfo.InvariantCulture); } catch { return fallback; }
        }

        public static double Double(Dictionary<string, object> d, string key, double fallback)
        {
            object v;
            if (d == null || !d.TryGetValue(key, out v) || v == null) return fallback;
            try { return Convert.ToDouble(v, CultureInfo.InvariantCulture); } catch { return fallback; }
        }

        public static bool Bool(Dictionary<string, object> d, string key, bool fallback)
        {
            object v;
            if (d == null || !d.TryGetValue(key, out v) || v == null) return fallback;
            if (v is bool) return (bool)v;
            return fallback;
        }

        /// <summary>Data do Firestore (RFC 3339, ate nanossegundos) em UTC.</summary>
        public static DateTime? Time(string value)
        {
            if (string.IsNullOrEmpty(value)) return null;
            string trimmed = Regex.Replace(value, @"(\.\d{7})\d+", "$1");
            DateTime parsed;
            if (DateTime.TryParse(trimmed, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out parsed)) return parsed;
            return null;
        }
    }

    internal class RemoteDoc
    {
        public Dictionary<string, object> Fields;
        public DateTime? UpdateTime;
    }

    internal static class FirestoreWire
    {
        public static Dictionary<string, object> ToValue(object val)
        {
            Dictionary<string, object> res = new Dictionary<string, object>();
            if (val == null) { res["nullValue"] = null; return res; }
            if (val is bool) { res["booleanValue"] = (bool)val; return res; }
            if (val is int || val is long || val is uint || val is short)
            {
                res["integerValue"] = Convert.ToInt64(val, CultureInfo.InvariantCulture).ToString(CultureInfo.InvariantCulture);
                return res;
            }
            if (val is float || val is double || val is decimal)
            {
                res["doubleValue"] = Convert.ToDouble(val, CultureInfo.InvariantCulture);
                return res;
            }
            if (val is DateTime)
            {
                res["timestampValue"] = ((DateTime)val).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
                return res;
            }
            string s = val as string;
            if (s != null) { res["stringValue"] = s; return res; }
            IDictionary<string, object> dict = val as IDictionary<string, object>;
            if (dict != null)
            {
                Dictionary<string, object> fields = new Dictionary<string, object>();
                foreach (KeyValuePair<string, object> kv in dict) fields[kv.Key] = ToValue(kv.Value);
                Dictionary<string, object> wrap = new Dictionary<string, object>();
                wrap["fields"] = fields;
                res["mapValue"] = wrap;
                return res;
            }
            System.Collections.IEnumerable list = val as System.Collections.IEnumerable;
            if (list != null)
            {
                List<object> values = new List<object>();
                foreach (object item in list) values.Add(ToValue(item));
                Dictionary<string, object> wrap = new Dictionary<string, object>();
                wrap["values"] = values;
                res["arrayValue"] = wrap;
                return res;
            }
            res["stringValue"] = Convert.ToString(val, CultureInfo.InvariantCulture);
            return res;
        }

        public static object FromValue(Dictionary<string, object> wire)
        {
            if (wire == null || wire.ContainsKey("nullValue")) return null;
            if (wire.ContainsKey("booleanValue")) return Convert.ToBoolean(wire["booleanValue"], CultureInfo.InvariantCulture);
            if (wire.ContainsKey("integerValue"))
            {
                long l;
                return long.TryParse(Convert.ToString(wire["integerValue"], CultureInfo.InvariantCulture), NumberStyles.Integer, CultureInfo.InvariantCulture, out l) ? l : 0L;
            }
            if (wire.ContainsKey("doubleValue")) return Convert.ToDouble(wire["doubleValue"], CultureInfo.InvariantCulture);
            if (wire.ContainsKey("timestampValue")) return Convert.ToString(wire["timestampValue"], CultureInfo.InvariantCulture);
            if (wire.ContainsKey("stringValue")) return Convert.ToString(wire["stringValue"], CultureInfo.InvariantCulture);
            if (wire.ContainsKey("mapValue"))
            {
                Dictionary<string, object> result = new Dictionary<string, object>();
                Dictionary<string, object> fields = Json.Map(wire["mapValue"] as Dictionary<string, object>, "fields");
                if (fields != null)
                {
                    foreach (KeyValuePair<string, object> kv in fields) result[kv.Key] = FromValue(kv.Value as Dictionary<string, object>);
                }
                return result;
            }
            if (wire.ContainsKey("arrayValue"))
            {
                List<object> result = new List<object>();
                Dictionary<string, object> av = wire["arrayValue"] as Dictionary<string, object>;
                object values;
                if (av != null && av.TryGetValue("values", out values))
                {
                    System.Collections.IEnumerable items = values as System.Collections.IEnumerable;
                    if (items != null)
                    {
                        foreach (object item in items) result.Add(FromValue(item as Dictionary<string, object>));
                    }
                }
                return result;
            }
            return null;
        }

        public static string BuildDocumentJson(Dictionary<string, object> docFields)
        {
            Dictionary<string, object> fields = new Dictionary<string, object>();
            foreach (KeyValuePair<string, object> kv in docFields) fields[kv.Key] = ToValue(kv.Value);
            Dictionary<string, object> root = new Dictionary<string, object>();
            root["fields"] = fields;
            return Json.Serializer.Serialize(root);
        }

        public static RemoteDoc ParseDocument(string json)
        {
            Dictionary<string, object> raw = Json.ParseObject(json);
            if (raw == null) return null;
            RemoteDoc doc = new RemoteDoc();
            doc.Fields = new Dictionary<string, object>();
            doc.UpdateTime = Json.Time(Json.Str(raw, "updateTime"));
            Dictionary<string, object> fields = Json.Map(raw, "fields");
            if (fields != null)
            {
                foreach (KeyValuePair<string, object> kv in fields) doc.Fields[kv.Key] = FromValue(kv.Value as Dictionary<string, object>);
            }
            return doc;
        }
    }

    // -------------------------------------------------------------------------
    // Configuracao, credencial da maquina e estado local
    // -------------------------------------------------------------------------
    public class AgentConfig
    {
        public string projectId = "";
        public string apiKey = "";
        public string tenantId = "";
        public string agentToken = "";
        public string patrimony = "";
        public string serverUrl = "https://itam-nexus.web.app";
        public string firestoreBase = "";
        public string authBase = "";
        public string tokenBase = "";

        [ScriptIgnore]
        public string LoadedFrom = "";

        public string ProjectId() { return AgentInfo.Filled(projectId, AgentInfo.Filled(AgentInfo.BuildProjectId, "itam-nexus")); }
        public string ApiKey() { return AgentInfo.Filled(apiKey, AgentInfo.Filled(AgentInfo.BuildApiKey, "")); }
        public string FirestoreBase() { return string.IsNullOrEmpty(firestoreBase) ? "https://firestore.googleapis.com/v1" : firestoreBase.TrimEnd('/'); }
        public string AuthBase() { return string.IsNullOrEmpty(authBase) ? "https://identitytoolkit.googleapis.com/v1" : authBase.TrimEnd('/'); }
        public string TokenBase() { return string.IsNullOrEmpty(tokenBase) ? "https://securetoken.googleapis.com/v1" : tokenBase.TrimEnd('/'); }

        public static AgentConfig Load(string explicitPath)
        {
            List<string> candidates = new List<string>();
            if (!string.IsNullOrEmpty(explicitPath)) candidates.Add(explicitPath);
            candidates.Add(AgentPaths.ConfigFile);
            candidates.Add(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "config.json"));
            candidates.Add(Path.Combine(AgentPaths.UserDir, "config.json"));
            foreach (string path in candidates)
            {
                try
                {
                    if (!File.Exists(path)) continue;
                    AgentConfig cfg = Json.Serializer.Deserialize<AgentConfig>(File.ReadAllText(path, Encoding.UTF8));
                    if (cfg == null) continue;
                    cfg.LoadedFrom = path;
                    return cfg;
                }
                catch (Exception ex)
                {
                    AgentLog.Write("config.json invalido em {0}: {1}", path, ex.Message);
                }
            }
            return new AgentConfig();
        }

        public bool SaveTo(string path)
        {
            try
            {
                string dir = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                File.WriteAllText(path, Json.Serializer.Serialize(this), new UTF8Encoding(false));
                return true;
            }
            catch
            {
                return false;
            }
        }
    }

    public class DeviceCredential
    {
        public string uid = "";
        public string refreshToken = "";
        public string tenantId = "";
        public string deviceKey = "";
        public string projectId = "";
        public string enrolledAt = "";

        private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("NexusITAM.device.v1");

        public bool IsValid()
        {
            return !string.IsNullOrEmpty(uid) && !string.IsNullOrEmpty(refreshToken) &&
                !string.IsNullOrEmpty(tenantId) && !string.IsNullOrEmpty(deviceKey);
        }

        public static DeviceCredential Load(string path)
        {
            try
            {
                if (!File.Exists(path)) return null;
                byte[] plain = ProtectedData.Unprotect(File.ReadAllBytes(path), Entropy, DataProtectionScope.LocalMachine);
                DeviceCredential cred = Json.Serializer.Deserialize<DeviceCredential>(Encoding.UTF8.GetString(plain));
                return cred != null && cred.IsValid() ? cred : null;
            }
            catch (Exception ex)
            {
                AgentLog.Write("Credencial ilegivel ({0}): {1}", path, ex.Message);
                return null;
            }
        }

        public bool Save(string path)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                byte[] plain = Encoding.UTF8.GetBytes(Json.Serializer.Serialize(this));
                File.WriteAllBytes(path, ProtectedData.Protect(plain, Entropy, DataProtectionScope.LocalMachine));
                return true;
            }
            catch (Exception ex)
            {
                AgentLog.Write("Nao foi possivel gravar a credencial em {0}: {1}", path, ex.Message);
                return false;
            }
        }
    }

    public class AgentState
    {
        public List<string> executed = new List<string>();
        public string lastInventoryUtc = "";

        [ScriptIgnore]
        public string Path = "";

        public static AgentState Load(string path)
        {
            AgentState state = null;
            try
            {
                if (File.Exists(path)) state = Json.Serializer.Deserialize<AgentState>(File.ReadAllText(path, Encoding.UTF8));
            }
            catch { }
            if (state == null) state = new AgentState();
            if (state.executed == null) state.executed = new List<string>();
            state.Path = path;
            return state;
        }

        public bool WasExecuted(string id)
        {
            lock (this) return executed.Contains(id);
        }

        public void MarkExecuted(string id)
        {
            lock (this)
            {
                executed.Add(id);
                while (executed.Count > 60) executed.RemoveAt(0);
                Save();
            }
        }

        public void Save()
        {
            lock (this)
            {
                try
                {
                    Directory.CreateDirectory(System.IO.Path.GetDirectoryName(Path));
                    File.WriteAllText(Path, Json.Serializer.Serialize(this), new UTF8Encoding(false));
                }
                catch { }
            }
        }
    }

    // -------------------------------------------------------------------------
    // HTTP, autenticacao e Firestore
    // -------------------------------------------------------------------------
    internal class HttpResult
    {
        public int Status;
        public string Body = "";
        public DateTime? ServerDateUtc;
    }

    internal static class Http
    {
        public static void Configure()
        {
            // Windows antigos negociam TLS 1.0; o Google exige 1.2.
            ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072;
            ServicePointManager.Expect100Continue = false;
            try { WebRequest.DefaultWebProxy.Credentials = CredentialCache.DefaultNetworkCredentials; } catch { }
        }

        public static HttpResult Send(string method, string url, string body, string contentType, string bearer, int timeoutMs)
        {
            HttpResult result = new HttpResult();
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                req.Method = method;
                req.Timeout = timeoutMs;
                req.ReadWriteTimeout = timeoutMs;
                req.UserAgent = "NexusITAM-Agent/" + AgentInfo.Version;
                if (!string.IsNullOrEmpty(bearer)) req.Headers["Authorization"] = "Bearer " + bearer;
                if (body != null)
                {
                    byte[] bytes = Encoding.UTF8.GetBytes(body);
                    req.ContentType = contentType;
                    req.ContentLength = bytes.Length;
                    using (Stream stream = req.GetRequestStream()) stream.Write(bytes, 0, bytes.Length);
                }
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse()) Read(resp, result);
            }
            catch (WebException wex)
            {
                HttpWebResponse resp = wex.Response as HttpWebResponse;
                if (resp != null)
                {
                    using (resp) Read(resp, result);
                }
                else
                {
                    result.Body = wex.Message;
                }
            }
            catch (Exception ex)
            {
                result.Body = ex.Message;
            }
            return result;
        }

        private static void Read(HttpWebResponse resp, HttpResult result)
        {
            result.Status = (int)resp.StatusCode;
            string date = resp.Headers["Date"];
            DateTime parsed;
            if (!string.IsNullOrEmpty(date) &&
                DateTime.TryParse(date, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal, out parsed))
            {
                result.ServerDateUtc = parsed;
            }
            using (StreamReader reader = new StreamReader(resp.GetResponseStream(), Encoding.UTF8)) result.Body = reader.ReadToEnd();
        }

        public static string Brief(string body)
        {
            if (string.IsNullOrEmpty(body)) return "";
            string flat = body.Replace("\r", " ").Replace("\n", " ");
            return flat.Length > 300 ? flat.Substring(0, 300) : flat;
        }
    }

    internal class CloudClient
    {
        private readonly AgentConfig _cfg;
        private readonly DeviceCredential _cred;
        private readonly object _tokenLock = new object();
        private string _idToken = "";
        private DateTime _idTokenExpiresUtc = DateTime.MinValue;
        private long _skewTicks;

        public string LastError = "";

        public CloudClient(AgentConfig cfg, DeviceCredential cred)
        {
            _cfg = cfg;
            _cred = cred;
        }

        public DeviceCredential Credential { get { return _cred; } }

        /// <summary>Hora do servidor (corrige relogio errado da maquina).</summary>
        public DateTime ServerNowUtc
        {
            get { return DateTime.UtcNow.AddTicks(Interlocked.Read(ref _skewTicks)); }
        }

        public DateTime ToLocalClock(DateTime serverUtc)
        {
            return serverUtc.AddTicks(-Interlocked.Read(ref _skewTicks));
        }

        private void NoteServerTime(DateTime serverUtc)
        {
            Interlocked.Exchange(ref _skewTicks, (serverUtc - DateTime.UtcNow).Ticks);
        }

        public bool EnsureToken()
        {
            lock (_tokenLock)
            {
                if (!string.IsNullOrEmpty(_idToken) && DateTime.UtcNow < _idTokenExpiresUtc) return true;
                string url = _cfg.TokenBase() + "/token?key=" + Uri.EscapeDataString(_cfg.ApiKey());
                string body = "grant_type=refresh_token&refresh_token=" + Uri.EscapeDataString(_cred.refreshToken);
                HttpResult r = Http.Send("POST", url, body, "application/x-www-form-urlencoded", null, 20000);
                if (r.Status != 200)
                {
                    LastError = "Renovacao da sessao falhou (" + r.Status + "): " + Http.Brief(r.Body);
                    return false;
                }
                Dictionary<string, object> d = Json.ParseObject(r.Body);
                _idToken = Json.Str(d, "id_token");
                long expires = Json.Long(d, "expires_in", 3600);
                if (expires <= 0)
                {
                    long.TryParse(Json.Str(d, "expires_in"), out expires);
                }
                _idTokenExpiresUtc = DateTime.UtcNow.AddSeconds(Math.Max(300, expires - 300));
                return !string.IsNullOrEmpty(_idToken);
            }
        }

        private void InvalidateToken()
        {
            lock (_tokenLock) _idToken = "";
        }

        private string DocUrl(string collection, string docId)
        {
            return _cfg.FirestoreBase() + "/projects/" + Uri.EscapeDataString(_cfg.ProjectId()) +
                "/databases/(default)/documents/" + collection + "/" + Uri.EscapeDataString(docId);
        }

        private HttpResult Authed(string method, string url, string body, int timeoutMs)
        {
            if (!EnsureToken()) return new HttpResult { Status = 0, Body = LastError };
            HttpResult r = Http.Send(method, url, body, "application/json; charset=utf-8", _idToken, timeoutMs);
            if (r.Status == 401)
            {
                InvalidateToken();
                if (EnsureToken()) r = Http.Send(method, url, body, "application/json; charset=utf-8", _idToken, timeoutMs);
            }
            if (r.ServerDateUtc.HasValue) NoteServerTime(r.ServerDateUtc.Value);
            if (r.Status < 200 || r.Status >= 300) LastError = method + " " + r.Status + ": " + Http.Brief(r.Body);
            return r;
        }

        public RemoteDoc Get(string collection, string docId, out int status)
        {
            HttpResult r = Authed("GET", DocUrl(collection, docId), null, 15000);
            status = r.Status;
            return r.Status == 200 ? FirestoreWire.ParseDocument(r.Body) : null;
        }

        /// <summary>
        /// Grava so os campos da mascara (campo da mascara ausente em `fields` e
        /// apagado). `returnFields` limita o que volta na resposta.
        /// </summary>
        public RemoteDoc Patch(string collection, string docId, Dictionary<string, object> fields,
            ICollection<string> updateMask, ICollection<string> returnFields, int timeoutMs, out int status)
        {
            StringBuilder url = new StringBuilder(DocUrl(collection, docId));
            char sep = '?';
            if (updateMask != null)
            {
                foreach (string f in updateMask)
                {
                    url.Append(sep).Append("updateMask.fieldPaths=").Append(Uri.EscapeDataString(f));
                    sep = '&';
                }
            }
            if (returnFields != null)
            {
                foreach (string f in returnFields)
                {
                    url.Append(sep).Append("mask.fieldPaths=").Append(Uri.EscapeDataString(f));
                    sep = '&';
                }
            }
            HttpResult r = Authed("PATCH", url.ToString(), FirestoreWire.BuildDocumentJson(fields), timeoutMs);
            status = r.Status;
            if (r.Status != 200) return null;
            RemoteDoc doc = FirestoreWire.ParseDocument(r.Body);
            if (doc != null && doc.UpdateTime.HasValue) NoteServerTime(doc.UpdateTime.Value);
            return doc;
        }

        public bool Delete(string collection, string docId, out int status)
        {
            HttpResult r = Authed("DELETE", DocUrl(collection, docId), null, 15000);
            status = r.Status;
            return r.Status == 200;
        }
    }

    internal static class Crypto
    {
        public static string Sha256Hex(string text)
        {
            using (SHA256 sha = SHA256.Create())
            {
                byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes(text));
                StringBuilder sb = new StringBuilder();
                foreach (byte b in hash) sb.Append(b.ToString("x2", CultureInfo.InvariantCulture));
                return sb.ToString();
            }
        }
    }

    internal static class Enrollment
    {
        /// <summary>
        /// Cria a identidade da maquina (login anonimo) e a matricula na empresa,
        /// provando o token sem grava-lo: sha256(token:uid).
        /// </summary>
        public static DeviceCredential Enroll(AgentConfig cfg, string deviceKey, out string error)
        {
            error = null;
            if (string.IsNullOrEmpty(cfg.tenantId) || string.IsNullOrEmpty(cfg.agentToken))
            {
                error = "Informe o ID da empresa e o token do agente (Agente ITAM > Instalar, no painel web).";
                return null;
            }
            if (string.IsNullOrEmpty(cfg.ApiKey()))
            {
                error = "Chave de API ausente no config.json. Baixe o instalador novamente no painel.";
                return null;
            }

            HttpResult signUp = Http.Send("POST",
                cfg.AuthBase() + "/accounts:signUp?key=" + Uri.EscapeDataString(cfg.ApiKey()),
                "{\"returnSecureToken\":true}", "application/json", null, 20000);
            if (signUp.Status != 200)
            {
                error = signUp.Body.Contains("OPERATION_NOT_ALLOWED") || signUp.Body.Contains("ADMIN_ONLY_OPERATION")
                    ? "O login anonimo esta desativado no Firebase (Authentication > Metodo de login > Anonimo)."
                    : "Falha ao criar a identidade da maquina (" + signUp.Status + "): " + Http.Brief(signUp.Body);
                return null;
            }
            Dictionary<string, object> account = Json.ParseObject(signUp.Body);
            string uid = Json.Str(account, "localId");
            string idToken = Json.Str(account, "idToken");
            string refresh = Json.Str(account, "refreshToken");

            Dictionary<string, object> fields = new Dictionary<string, object>();
            fields["tenantId"] = cfg.tenantId;
            fields["deviceKey"] = deviceKey;
            fields["tokenProof"] = Crypto.Sha256Hex(cfg.agentToken + ":" + uid);
            fields["hostname"] = Environment.MachineName;
            fields["agentVersion"] = AgentInfo.Version;
            fields["createdAt"] = DateTime.UtcNow;

            string url = cfg.FirestoreBase() + "/projects/" + Uri.EscapeDataString(cfg.ProjectId()) +
                "/databases/(default)/documents/agentEnrollments/" + Uri.EscapeDataString(uid) + "?currentDocument.exists=false";
            HttpResult write = Http.Send("PATCH", url, FirestoreWire.BuildDocumentJson(fields), "application/json; charset=utf-8", idToken, 20000);
            if (write.Status != 200)
            {
                error = write.Status == 403
                    ? "A empresa recusou a matricula: token do agente invalido (gere outro no painel), ID da empresa incorreto ou empresa suspensa."
                    : "Falha ao matricular a maquina (" + write.Status + "): " + Http.Brief(write.Body);
                return null;
            }

            DeviceCredential cred = new DeviceCredential();
            cred.uid = uid;
            cred.refreshToken = refresh;
            cred.tenantId = cfg.tenantId;
            cred.deviceKey = deviceKey;
            cred.projectId = cfg.ProjectId();
            cred.enrolledAt = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
            return cred;
        }
    }

    internal class AgentPolicy
    {
        public string RemoteAccess = "consent";
        public bool CommandsEnabled = true;
        public int HeartbeatSeconds = 120;

        public static AgentPolicy From(Dictionary<string, object> fields)
        {
            AgentPolicy p = new AgentPolicy();
            if (fields == null) return p;
            string mode = Json.Str(fields, "remoteAccess");
            if (mode == "disabled" || mode == "consent" || mode == "unattended") p.RemoteAccess = mode;
            p.CommandsEnabled = Json.Bool(fields, "commandsEnabled", true);
            p.HeartbeatSeconds = (int)Math.Max(30, Math.Min(900, Json.Long(fields, "heartbeatSeconds", 120)));
            return p;
        }
    }

    // -------------------------------------------------------------------------
    // Identidade e telemetria da maquina
    // -------------------------------------------------------------------------
    internal static class MachineIdentity
    {
        private static string _deviceKey;
        private static string _serial;
        private static string _uuid;
        private static string _machineGuid;
        private static string _osCaption;

        public static string Wmi(string wmiClass, string property)
        {
            try
            {
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher("root\\cimv2", "SELECT " + property + " FROM " + wmiClass))
                using (ManagementObjectCollection items = searcher.Get())
                {
                    foreach (ManagementBaseObject item in items)
                    {
                        object value = item[property];
                        if (value != null) return Convert.ToString(value, CultureInfo.InvariantCulture).Trim();
                    }
                }
            }
            catch { }
            return "";
        }

        public static string MachineGuid
        {
            get
            {
                if (_machineGuid != null) return _machineGuid;
                _machineGuid = "";
                try
                {
                    using (RegistryKey hklm = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
                    using (RegistryKey key = hklm.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography"))
                    {
                        object v = key != null ? key.GetValue("MachineGuid") : null;
                        if (v != null) _machineGuid = v.ToString().Trim();
                    }
                }
                catch { }
                return _machineGuid;
            }
        }

        public static string SerialNumber
        {
            get { return _serial ?? (_serial = Wmi("Win32_BIOS", "SerialNumber")); }
        }

        public static string SmbiosUuid
        {
            get { return _uuid ?? (_uuid = Wmi("Win32_ComputerSystemProduct", "UUID")); }
        }

        public static string DeviceId
        {
            get { return string.IsNullOrEmpty(MachineGuid) ? SmbiosUuid : MachineGuid; }
        }

        /// <summary>
        /// Mesma chave do coletor nexus-agent.ps1: sha256(MachineGuid|serial|UUID),
        /// 16 bytes em hex. Clones sem sysprep repetem o MachineGuid, nao o serial/UUID.
        /// </summary>
        public static string DeviceKey
        {
            get
            {
                if (_deviceKey != null) return _deviceKey;
                string raw = string.Format("{0}|{1}|{2}", DeviceId, SerialNumber, SmbiosUuid).ToUpperInvariant();
                _deviceKey = Crypto.Sha256Hex(raw).Substring(0, 32);
                return _deviceKey;
            }
        }

        public static string AccessIdFor(string deviceKey)
        {
            using (SHA256 sha = SHA256.Create())
            {
                byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes("NEXUS-ID-" + deviceKey));
                uint val = BitConverter.ToUInt32(hash, 0) % 900000000U + 100000000U;
                string s = val.ToString("000000000", CultureInfo.InvariantCulture);
                return string.Format("{0} {1} {2}", s.Substring(0, 3), s.Substring(3, 3), s.Substring(6, 3));
            }
        }

        public static string OsCaption
        {
            get
            {
                if (_osCaption != null) return _osCaption;
                try
                {
                    using (RegistryKey hklm = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
                    using (RegistryKey key = hklm.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion"))
                    {
                        object product = key != null ? key.GetValue("ProductName") : null;
                        object build = key != null ? key.GetValue("CurrentBuild") : null;
                        if (product != null)
                        {
                            string name = product.ToString();
                            int buildNo;
                            // O registro ainda diz "Windows 10" no Windows 11.
                            if (build != null && int.TryParse(build.ToString(), out buildNo) && buildNo >= 22000) name = name.Replace("Windows 10", "Windows 11");
                            _osCaption = name + (build != null ? " (Build " + build + ")" : "");
                        }
                    }
                }
                catch { }
                if (string.IsNullOrEmpty(_osCaption)) _osCaption = Environment.OSVersion.VersionString;
                return _osCaption;
            }
        }

        /// <summary>Quem esta na console (servico) ou o proprio usuario (bandeja).</summary>
        public static string LoggedUser(bool service)
        {
            if (!service) return Environment.UserDomainName + "\\" + Environment.UserName;
            return Wmi("Win32_ComputerSystem", "UserName");
        }

        public static void PrimaryNetwork(out string ip, out string mac)
        {
            ip = "";
            mac = "";
            try
            {
                foreach (NetworkInterface ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up || ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                    IPInterfaceProperties props = ni.GetIPProperties();
                    if (props.GatewayAddresses == null || props.GatewayAddresses.Count == 0) continue;
                    foreach (UnicastIPAddressInformation addr in props.UnicastAddresses)
                    {
                        if (addr.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                        ip = addr.Address.ToString();
                        byte[] bytes = ni.GetPhysicalAddress().GetAddressBytes();
                        if (bytes.Length == 6)
                        {
                            mac = string.Format("{0:X2}:{1:X2}:{2:X2}:{3:X2}:{4:X2}:{5:X2}", bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
                        }
                        return;
                    }
                }
            }
            catch { }
        }

        public static DateTime BootTimeUtc
        {
            get
            {
                try { return DateTime.UtcNow.AddMilliseconds(-(double)NativeMethods.GetTickCount64()); }
                catch { return DateTime.UtcNow.AddMilliseconds(-(double)(Environment.TickCount & int.MaxValue)); }
            }
        }
    }

    internal static class Telemetry
    {
        private static long _lastIdle;
        private static long _lastTotal;
        private static int _cpu = 1;

        public static int CpuPercent()
        {
            try
            {
                long idle, kernel, user;
                if (NativeMethods.GetSystemTimes(out idle, out kernel, out user))
                {
                    long total = kernel + user;
                    long dTotal = total - _lastTotal;
                    long dIdle = idle - _lastIdle;
                    if (_lastTotal > 0 && dTotal > 0) _cpu = (int)Math.Round((1.0 - dIdle / (double)dTotal) * 100.0);
                    _lastIdle = idle;
                    _lastTotal = total;
                }
            }
            catch { }
            return Math.Max(0, Math.Min(100, _cpu));
        }

        public static void Memory(out int percent, out double usedGb, out double totalGb)
        {
            percent = 0;
            usedGb = 0;
            totalGb = 0;
            try
            {
                NativeMethods.MEMORYSTATUSEX mem = new NativeMethods.MEMORYSTATUSEX();
                if (NativeMethods.GlobalMemoryStatusEx(mem) && mem.ullTotalPhys > 0)
                {
                    percent = (int)mem.dwMemoryLoad;
                    totalGb = Math.Round(mem.ullTotalPhys / 1073741824.0, 1);
                    usedGb = Math.Round((mem.ullTotalPhys - mem.ullAvailPhys) / 1073741824.0, 1);
                }
            }
            catch { }
        }

        public static void SystemDrive(out int percent, out double freeGb, out double totalGb)
        {
            percent = 0;
            freeGb = 0;
            totalGb = 0;
            try
            {
                DriveInfo drive = new DriveInfo(Path.GetPathRoot(Environment.SystemDirectory));
                if (drive.IsReady && drive.TotalSize > 0)
                {
                    totalGb = Math.Round(drive.TotalSize / 1073741824.0, 1);
                    freeGb = Math.Round(drive.AvailableFreeSpace / 1073741824.0, 1);
                    percent = (int)Math.Round((drive.TotalSize - drive.AvailableFreeSpace) * 100.0 / drive.TotalSize);
                }
            }
            catch { }
        }

        public static double UptimeHours()
        {
            return Math.Round((DateTime.UtcNow - MachineIdentity.BootTimeUtc).TotalHours, 1);
        }

        public static List<object> TopProcesses(int max)
        {
            List<Dictionary<string, object>> list = new List<Dictionary<string, object>>();
            foreach (Process p in Process.GetProcesses())
            {
                try
                {
                    if (p.Id <= 4) continue;
                    long memMb = p.WorkingSet64 / (1024 * 1024);
                    if (memMb < 5) continue;
                    Dictionary<string, object> item = new Dictionary<string, object>();
                    item["pid"] = p.Id;
                    item["name"] = p.ProcessName;
                    item["memoryMb"] = memMb;
                    item["session"] = p.SessionId;
                    list.Add(item);
                }
                catch { }
                finally
                {
                    p.Dispose();
                }
            }
            list.Sort(delegate(Dictionary<string, object> a, Dictionary<string, object> b)
            {
                return Convert.ToInt64(b["memoryMb"]).CompareTo(Convert.ToInt64(a["memoryMb"]));
            });
            List<object> top = new List<object>();
            for (int i = 0; i < list.Count && i < max; i++) top.Add(list[i]);
            return top;
        }

        public static Dictionary<string, object> Metrics()
        {
            int ramPct, diskPct;
            double ramUsed, ramTotal, diskFree, diskTotal;
            Memory(out ramPct, out ramUsed, out ramTotal);
            SystemDrive(out diskPct, out diskFree, out diskTotal);
            Dictionary<string, object> m = new Dictionary<string, object>();
            m["cpuPercent"] = CpuPercent();
            m["ramPercent"] = ramPct;
            m["ramUsedGb"] = ramUsed;
            m["ramTotalGb"] = ramTotal;
            m["diskPercent"] = diskPct;
            m["diskFreeGb"] = diskFree;
            m["diskTotalGb"] = diskTotal;
            m["uptimeHours"] = UptimeHours();
            return m;
        }
    }

    // -------------------------------------------------------------------------
    // Tela e entrada remota (somente na sessao do colaborador)
    // -------------------------------------------------------------------------
    internal static class RemoteDesktop
    {
        private static int _seq;

        public static Dictionary<string, object> Capture(string quality, out string signature)
        {
            signature = "";
            try
            {
                Rectangle bounds = Screen.PrimaryScreen.Bounds;
                int width = 1152;
                long jpeg = 50L;
                if (quality == "high") { width = 1366; jpeg = 62L; }
                else if (quality == "low") { width = 860; jpeg = 36L; }
                if (width > bounds.Width) width = bounds.Width;
                int height = (int)Math.Round(bounds.Height * (width / (double)bounds.Width));

                using (Bitmap full = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb))
                {
                    using (Graphics g = Graphics.FromImage(full))
                    {
                        g.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);
                        NativeMethods.POINT pt;
                        if (NativeMethods.GetCursorPos(out pt))
                        {
                            int cx = pt.X - bounds.Left;
                            int cy = pt.Y - bounds.Top;
                            using (Pen outline = new Pen(Color.FromArgb(220, 15, 23, 42), 2f))
                            using (SolidBrush fill = new SolidBrush(Color.FromArgb(210, 56, 189, 248)))
                            {
                                Point[] arrow = { new Point(cx, cy), new Point(cx, cy + 16), new Point(cx + 5, cy + 12), new Point(cx + 11, cy + 11) };
                                g.SmoothingMode = SmoothingMode.AntiAlias;
                                g.FillPolygon(fill, arrow);
                                g.DrawPolygon(outline, arrow);
                            }
                        }
                    }
                    using (Bitmap scaled = new Bitmap(width, height, PixelFormat.Format24bppRgb))
                    {
                        using (Graphics gs = Graphics.FromImage(scaled))
                        {
                            gs.InterpolationMode = InterpolationMode.Bilinear;
                            gs.CompositingQuality = CompositingQuality.HighSpeed;
                            gs.DrawImage(full, 0, 0, width, height);
                        }
                        using (MemoryStream ms = new MemoryStream())
                        {
                            ImageCodecInfo codec = JpegCodec();
                            if (codec != null)
                            {
                                using (EncoderParameters ep = new EncoderParameters(1))
                                {
                                    ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, jpeg);
                                    scaled.Save(ms, codec, ep);
                                }
                            }
                            else
                            {
                                scaled.Save(ms, ImageFormat.Jpeg);
                            }
                            byte[] bytes = ms.ToArray();
                            using (MD5 md5 = MD5.Create()) signature = Convert.ToBase64String(md5.ComputeHash(bytes));
                            _seq++;
                            Dictionary<string, object> frame = new Dictionary<string, object>();
                            frame["data"] = Convert.ToBase64String(bytes);
                            frame["width"] = width;
                            frame["height"] = height;
                            frame["screenWidth"] = bounds.Width;
                            frame["screenHeight"] = bounds.Height;
                            frame["seq"] = _seq;
                            frame["capturedAt"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
                            return frame;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                AgentLog.Write("Captura de tela falhou: {0}", ex.Message);
                return null;
            }
        }

        private static ImageCodecInfo JpegCodec()
        {
            foreach (ImageCodecInfo codec in ImageCodecInfo.GetImageEncoders())
            {
                if (codec.FormatID == ImageFormat.Jpeg.Guid) return codec;
            }
            return null;
        }

        public static void Input(Dictionary<string, object> ev)
        {
            string type = Json.Str(ev, "type");
            Rectangle bounds = Screen.PrimaryScreen.Bounds;
            double nx = Math.Max(0.0, Math.Min(1.0, Json.Double(ev, "x", 0.5)));
            double ny = Math.Max(0.0, Math.Min(1.0, Json.Double(ev, "y", 0.5)));
            int px = bounds.Left + (int)Math.Round(nx * bounds.Width);
            int py = bounds.Top + (int)Math.Round(ny * bounds.Height);
            try
            {
                switch (type)
                {
                    case "mousemove":
                        NativeMethods.SetCursorPos(px, py);
                        break;
                    case "click":
                        Click(px, py, NativeMethods.MOUSEEVENTF_LEFTDOWN | NativeMethods.MOUSEEVENTF_LEFTUP);
                        break;
                    case "dblclick":
                        Click(px, py, NativeMethods.MOUSEEVENTF_LEFTDOWN | NativeMethods.MOUSEEVENTF_LEFTUP);
                        Thread.Sleep(45);
                        NativeMethods.mouse_event(NativeMethods.MOUSEEVENTF_LEFTDOWN | NativeMethods.MOUSEEVENTF_LEFTUP, px, py, 0, UIntPtr.Zero);
                        break;
                    case "rightclick":
                        Click(px, py, NativeMethods.MOUSEEVENTF_RIGHTDOWN | NativeMethods.MOUSEEVENTF_RIGHTUP);
                        break;
                    case "mousedown":
                        Click(px, py, NativeMethods.MOUSEEVENTF_LEFTDOWN);
                        break;
                    case "mouseup":
                        Click(px, py, NativeMethods.MOUSEEVENTF_LEFTUP);
                        break;
                    case "wheel":
                        NativeMethods.SetCursorPos(px, py);
                        NativeMethods.mouse_event(NativeMethods.MOUSEEVENTF_WHEEL, px, py, (int)Json.Long(ev, "deltaY", -120), UIntPtr.Zero);
                        break;
                    case "key":
                        Key(Json.Str(ev, "key"));
                        break;
                    case "text":
                        TypeText(Json.Str(ev, "text"));
                        break;
                }
            }
            catch (Exception ex)
            {
                AgentLog.Write("Evento remoto {0} falhou: {1}", type, ex.Message);
            }
        }

        private static void Click(int x, int y, uint flags)
        {
            NativeMethods.SetCursorPos(x, y);
            Thread.Sleep(10);
            NativeMethods.mouse_event(flags, x, y, 0, UIntPtr.Zero);
        }

        private static void Combo(params byte[] keys)
        {
            foreach (byte k in keys) NativeMethods.keybd_event(k, 0, 0, UIntPtr.Zero);
            for (int i = keys.Length - 1; i >= 0; i--) NativeMethods.keybd_event(keys[i], 0, NativeMethods.KEYEVENTF_KEYUP, UIntPtr.Zero);
        }

        private static void Key(string key)
        {
            const byte VK_WIN = 0x5B, VK_CTRL = 0x11, VK_SHIFT = 0x10, VK_ALT = 0x12;
            switch (key)
            {
                case "Enter": Combo(0x0D); return;
                case "Backspace": Combo(0x08); return;
                case "Tab": Combo(0x09); return;
                case "Escape": Combo(0x1B); return;
                case "Delete": Combo(0x2E); return;
                case "ArrowUp": Combo(0x26); return;
                case "ArrowDown": Combo(0x28); return;
                case "ArrowLeft": Combo(0x25); return;
                case "ArrowRight": Combo(0x27); return;
                case "Home": Combo(0x24); return;
                case "End": Combo(0x23); return;
                case "PageUp": Combo(0x21); return;
                case "PageDown": Combo(0x22); return;
                case "Win": Combo(VK_WIN); return;
                case "Win+D": Combo(VK_WIN, 0x44); return;
                case "Win+R": Combo(VK_WIN, 0x52); return;
                case "Alt+Tab": Combo(VK_ALT, 0x09); return;
                // Ctrl+Alt+Del e reservado ao Windows (SAS): abre o Gerenciador de Tarefas.
                case "Ctrl+Alt+Del":
                case "Ctrl+Shift+Esc": Combo(VK_CTRL, VK_SHIFT, 0x1B); return;
            }
            if (!string.IsNullOrEmpty(key) && key.Length == 1) TypeText(key);
        }

        /// <summary>Digita qualquer caractere (acentos inclusive) via SendInput Unicode.</summary>
        private static void TypeText(string text)
        {
            if (string.IsNullOrEmpty(text)) return;
            if (text.Length > 2000) text = text.Substring(0, 2000);
            List<NativeMethods.INPUT> inputs = new List<NativeMethods.INPUT>();
            foreach (char c in text)
            {
                if (c == '\n')
                {
                    Combo(0x0D);
                    continue;
                }
                if (c == '\r') continue;
                NativeMethods.INPUT down = new NativeMethods.INPUT();
                down.type = NativeMethods.INPUT_KEYBOARD;
                down.u.ki.wScan = c;
                down.u.ki.dwFlags = NativeMethods.KEYEVENTF_UNICODE;
                NativeMethods.INPUT up = down;
                up.u.ki.dwFlags = NativeMethods.KEYEVENTF_UNICODE | NativeMethods.KEYEVENTF_KEYUP;
                inputs.Add(down);
                inputs.Add(up);
                NativeMethods.SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf(typeof(NativeMethods.INPUT)));
                inputs.Clear();
            }
        }
    }

    // -------------------------------------------------------------------------
    // Comandos remotos
    // -------------------------------------------------------------------------
    internal static class PowerShell
    {
        public static string Exe
        {
            get { return Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe"); }
        }

        /// <summary>Roda o script com tempo limite, lendo saida e erro sem travar.</summary>
        public static string Run(string script, int timeoutMs, out int exitCode)
        {
            string prelude = "$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; ";
            string encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(prelude + script));
            return RunArgs("-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand " + encoded, timeoutMs, out exitCode);
        }

        public static string RunArgs(string arguments, int timeoutMs, out int exitCode)
        {
            StringBuilder output = new StringBuilder();
            object sync = new object();
            exitCode = -1;
            ProcessStartInfo psi = new ProcessStartInfo(Exe, arguments);
            psi.CreateNoWindow = true;
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            using (Process p = new Process())
            {
                p.StartInfo = psi;
                DataReceivedEventHandler collect = delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data == null) return;
                    lock (sync)
                    {
                        if (output.Length < 64000) output.AppendLine(e.Data);
                    }
                };
                p.OutputDataReceived += collect;
                p.ErrorDataReceived += collect;
                p.Start();
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                if (!p.WaitForExit(timeoutMs))
                {
                    try { p.Kill(); } catch { }
                    exitCode = 124;
                    lock (sync) output.AppendLine("[Tempo limite de " + (timeoutMs / 1000) + " s excedido: processo encerrado]");
                }
                else
                {
                    p.WaitForExit();
                    exitCode = p.ExitCode;
                }
            }
            lock (sync) return output.ToString().TrimEnd();
        }

        public static string Quote(string value)
        {
            return "'" + (value ?? "").Replace("'", "''") + "'";
        }
    }

    internal static class Commands
    {
        public const int MaxCommandLength = 8000;
        private static readonly Regex WingetId = new Regex(@"^[A-Za-z0-9][A-Za-z0-9._+-]{1,127}$");

        public static bool NeedsUserSession(string type)
        {
            return type == "msgbox" || type == "lock_screen";
        }

        // winget nao esta no PATH do SYSTEM: resolve o executavel do App Installer.
        private const string WingetResolver =
            "$w = (Get-Command winget.exe -ErrorAction SilentlyContinue).Source; " +
            "if (-not $w) { $w = (Resolve-Path \"$env:ProgramFiles\\WindowsApps\\Microsoft.DesktopAppInstaller_*_x64__8wekyb3d8bbwe\\winget.exe\" -ErrorAction SilentlyContinue | Select-Object -Last 1).Path } " +
            "if (-not $w) { throw 'winget nao encontrado nesta maquina.' } ";

        /// <summary>Executa um comando que nao depende da sessao do colaborador.</summary>
        public static string Run(string type, string command, out int exitCode, out bool needsInventory)
        {
            exitCode = 0;
            needsInventory = false;
            switch (type)
            {
                case "powershell":
                    {
                        string output = PowerShell.Run(command, 120000, out exitCode);
                        return string.IsNullOrEmpty(output) ? "(Comando concluido sem saida no console)" : output;
                    }
                case "kill_process":
                    {
                        int pid;
                        if (int.TryParse(command, out pid))
                        {
                            using (Process p = Process.GetProcessById(pid))
                            {
                                string name = p.ProcessName;
                                p.Kill();
                                return string.Format("Processo {0} (PID {1}) finalizado.", name, pid);
                            }
                        }
                        int killed = 0;
                        foreach (Process p in Process.GetProcessesByName(command.Replace(".exe", "")))
                        {
                            try { p.Kill(); killed++; } catch { }
                            finally { p.Dispose(); }
                        }
                        return string.Format("{0} instancia(s) de '{1}' finalizada(s).", killed, command);
                    }
                case "restart":
                    Process.Start(new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "shutdown.exe"), "/r /t 30 /c \"Reinicio solicitado pela equipe de TI (Nexus ITAM)\"") { CreateNoWindow = true, UseShellExecute = false });
                    return "Reinicio agendado para 30 segundos.";
                case "shutdown":
                    Process.Start(new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "shutdown.exe"), "/s /t 30 /c \"Desligamento solicitado pela equipe de TI (Nexus ITAM)\"") { CreateNoWindow = true, UseShellExecute = false });
                    return "Desligamento agendado para 30 segundos.";
                case "force_inventory":
                    needsInventory = true;
                    return "Coleta completa de inventario disparada.";
                case "install_winget":
                    if (!WingetId.IsMatch(command ?? ""))
                    {
                        exitCode = 2;
                        return "ID de pacote winget invalido: use o ID exato (ex.: Google.Chrome).";
                    }
                    return PowerShell.Run(WingetResolver + "& $w install --id " + PowerShell.Quote(command) +
                        " --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity 2>&1", 600000, out exitCode);
                case "uninstall_software":
                    return PowerShell.Run(WingetResolver + "& $w uninstall --name " + PowerShell.Quote(command) +
                        " --silent --accept-source-agreements --disable-interactivity 2>&1", 600000, out exitCode);
                default:
                    exitCode = 1;
                    return "Tipo de comando desconhecido: " + type;
            }
        }
    }

    // -------------------------------------------------------------------------
    // Motor do agente (servico e bandeja)
    // -------------------------------------------------------------------------
    internal interface IAgentUi
    {
        void SetStatus(string text, Color color);
        void SetSyncText(string text);
        bool AskConsent(string operatorName);
        void ShowSession(bool active, string operatorName);
        void ShowMessage(string title, string text);
        void LockScreen();
    }

    internal class RemoteSessionState
    {
        public string Id = "";
        public string State = "idle";
        public string Operator = "";
        public string Mode = "attended";
        public string Quality = "balanced";
        public long LastSeq;
        public DateTime StartedUtc = DateTime.MinValue;
        public DateTime ViewerSeenUtc = DateTime.MinValue;
        public string LastFrameSig = "";
        public DateTime LastFrameAt = DateTime.MinValue;
        public bool Dirty;
        public bool FrameVisible;
        public readonly HashSet<string> Decided = new HashSet<string>();

        public bool Active { get { return State == "active"; } }
    }

    internal class AgentEngine
    {
        private const int WakeWindowSeconds = 180;
        private const int AwakeHeartbeatSeconds = 10;
        private const int AwakePollMs = 2000;
        private const int SessionPollMs = 700;
        private const int FallbackPollMinutes = 10;
        private const int CommandMaxAgeMinutes = 15;
        private const int InventoryHours = 12;

        private readonly bool _isService;
        private readonly IAgentUi _ui;
        private readonly AgentConfig _cfg;
        private DeviceCredential _cred;
        private CloudClient _cloud;
        private AgentPolicy _policy = new AgentPolicy();
        private DateTime _policyAt = DateTime.MinValue;
        private AgentState _state;
        private Thread _thread;
        private volatile bool _running;
        private readonly AutoResetEvent _kick = new AutoResetEvent(false);
        private EventWaitHandle _syncEvent;

        private DateTime _lastHeartbeat = DateTime.MinValue;
        private DateTime _lastControlPoll = DateTime.MinValue;
        private DateTime _awakeUntil = DateTime.MinValue;
        private DateTime _localAwakeUntil = DateTime.MinValue;
        private DateTime _retryAt = DateTime.MinValue;
        private DateTime _inventoryDueAt = DateTime.MinValue;
        private int _failures;
        private volatile bool _forceHeartbeat = true;
        private volatile bool _forceInventory;
        private volatile bool _inventoryRunning;
        private volatile bool _commandRunning;
        private volatile bool _revoked;
        private bool _verified;
        private Dictionary<string, object> _lastCommandResult;
        private Dictionary<string, object> _pendingSupport;
        private readonly object _sync = new object();
        private readonly RemoteSessionState _session = new RemoteSessionState();

        public string StatusText = "Iniciando...";
        public string AccessId = "--- --- ---";

        public AgentEngine(bool isService, AgentConfig cfg, IAgentUi ui)
        {
            _isService = isService;
            _cfg = cfg;
            _ui = ui;
            _state = AgentState.Load(AgentPaths.StateFile(isService));
            _cred = DeviceCredential.Load(AgentPaths.CredentialFile);
            if (_cred != null)
            {
                _cloud = new CloudClient(cfg, _cred);
                AccessId = MachineIdentity.AccessIdFor(_cred.deviceKey);
            }
            else
            {
                AccessId = MachineIdentity.AccessIdFor(MachineIdentity.DeviceKey);
            }
            Telemetry.CpuPercent();   // primeira amostra: o uso sai da diferenca entre duas
            DateTime last;
            _inventoryDueAt = DateTime.TryParse(_state.lastInventoryUtc, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out last)
                ? last.AddHours(InventoryHours)
                : DateTime.UtcNow.AddMinutes(2 + new Random().Next(0, 4));
        }

        public bool Enrolled { get { return _cred != null; } }
        public bool Revoked { get { return _revoked; } }
        public string TenantId { get { return _cred != null ? _cred.tenantId : _cfg.tenantId; } }
        public bool SessionActive { get { return _session.Active; } }

        // ---- ciclo de vida -------------------------------------------------

        public void Start()
        {
            _running = true;
            if (_isService)
            {
                try
                {
                    EventWaitHandleSecurity security = new EventWaitHandleSecurity();
                    security.AddAccessRule(new EventWaitHandleAccessRule(new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid, null),
                        EventWaitHandleRights.Synchronize | EventWaitHandleRights.Modify, AccessControlType.Allow));
                    security.AddAccessRule(new EventWaitHandleAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
                        EventWaitHandleRights.FullControl, AccessControlType.Allow));
                    bool created;
                    _syncEvent = new EventWaitHandle(false, EventResetMode.AutoReset, AgentInfo.SyncEventName, out created, security);
                }
                catch (Exception ex)
                {
                    AgentLog.Write("Sinal de sincronizacao indisponivel: {0}", ex.Message);
                }
            }
            _thread = new Thread(Loop);
            _thread.IsBackground = true;
            _thread.Name = "NexusAgentEngine";
            _thread.Start();
        }

        public void Stop()
        {
            _running = false;
            _kick.Set();
            if (_thread != null) _thread.Join(5000);
            if (_cloud != null && !_revoked && DoesTelemetry())
            {
                // Melhor esforco: o console mostra "offline" na hora, sem esperar o limite.
                Dictionary<string, object> f = Identity();
                f["status"] = "offline";
                f["updatedAt"] = _cloud.ServerNowUtc;
                int status;
                _cloud.Patch("agentDevices", DocId(), f, new string[] { "tenantId", "deviceKey", "status", "updatedAt" }, new string[] { "status" }, 4000, out status);
            }
            if (_syncEvent != null) _syncEvent.Close();
        }

        /// <summary>Uma rodada completa e sai (diagnostico e testes).</summary>
        public int RunOnce(bool withInventory)
        {
            if (_cloud == null) return 3;
            VerifyEnrollment();
            if (_revoked) return 4;
            RefreshPolicy(true);
            Heartbeat();
            PollControl();
            WaitForCommand();
            FlushOwnFields();
            if (withInventory) RunInventory();
            return _failures == 0 ? 0 : 5;
        }

        private void WaitForCommand()
        {
            for (int i = 0; i < 600 && _commandRunning; i++) Thread.Sleep(250);
        }

        public void Kick()
        {
            _forceHeartbeat = true;
            _kick.Set();
        }

        public void RequestInventory()
        {
            if (!DoesTelemetry())
            {
                try
                {
                    using (EventWaitHandle ev = EventWaitHandle.OpenExisting(AgentInfo.SyncEventName, EventWaitHandleRights.Modify | EventWaitHandleRights.Synchronize)) ev.Set();
                    return;
                }
                catch { }
            }
            _forceInventory = true;
            Kick();
        }

        public void RequestSupport(string message, string priority)
        {
            Dictionary<string, object> req = new Dictionary<string, object>();
            req["id"] = "sup-" + DateTime.UtcNow.Ticks.ToString(CultureInfo.InvariantCulture);
            req["status"] = "open";
            req["message"] = message.Length > 1000 ? message.Substring(0, 1000) : message;
            req["priority"] = priority;
            req["user"] = MachineIdentity.LoggedUser(false);
            req["createdAt"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
            lock (_sync) _pendingSupport = req;
            // Quem pediu ajuda espera atendimento rapido: fica acordado 15 min.
            _localAwakeUntil = DateTime.UtcNow.AddMinutes(15);
            Kick();
        }

        public void EndSessionByUser()
        {
            lock (_sync)
            {
                if (!_session.Active) return;
                _session.Decided.Add(_session.Id);
                _session.State = "ended_by_user";
                _session.Dirty = true;
            }
            if (_ui != null) _ui.ShowSession(false, "");
            Kick();
        }

        // ---- papeis --------------------------------------------------------

        private static bool _serviceSeen;
        private static DateTime _serviceCheckedAt = DateTime.MinValue;

        /// <summary>O servico cria o sinal global de sincronizacao: se ele existe, o servico esta de pe.</summary>
        public static bool ServiceRunning()
        {
            if ((DateTime.UtcNow - _serviceCheckedAt).TotalSeconds < 5) return _serviceSeen;
            bool seen;
            try
            {
                using (EventWaitHandle.OpenExisting(AgentInfo.SyncEventName, EventWaitHandleRights.Synchronize)) seen = true;
            }
            catch
            {
                seen = false;
            }
            _serviceSeen = seen;
            _serviceCheckedAt = DateTime.UtcNow;
            return seen;
        }

        // Telemetria, inventario e comandos de sistema: servico; sem ele, a bandeja.
        private bool DoesTelemetry()
        {
            return _isService || !ServiceRunning();
        }

        private string DocId()
        {
            return _cred.tenantId + "_" + _cred.deviceKey;
        }

        private Dictionary<string, object> Identity()
        {
            Dictionary<string, object> f = new Dictionary<string, object>();
            f["tenantId"] = _cred.tenantId;
            f["deviceKey"] = _cred.deviceKey;
            return f;
        }

        // ---- laco principal ------------------------------------------------

        private void Loop()
        {
            AgentLog.Write("Agente {0} iniciado ({1}).", AgentInfo.Version, _isService ? "servico" : "bandeja");
            while (_running)
            {
                int waitMs = 500;
                try
                {
                    waitMs = Tick();
                }
                catch (Exception ex)
                {
                    AgentLog.Write("Erro no laco: {0}", ex);
                    waitMs = 5000;
                }
                if (_syncEvent != null)
                {
                    if (WaitHandle.WaitAny(new WaitHandle[] { _kick, _syncEvent }, waitMs) == 1)
                    {
                        _forceInventory = true;
                    }
                }
                else
                {
                    _kick.WaitOne(waitMs);
                }
            }
        }

        private int Tick()
        {
            if (_cred == null)
            {
                SetStatus("NAO CONECTADO", Color.FromArgb(251, 191, 36), "Computador ainda nao conectado a empresa.");
                return 5000;
            }
            if (_revoked)
            {
                SetStatus("ACESSO REVOGADO", Color.FromArgb(248, 113, 113), "A empresa revogou este agente. Reinstale para reconectar.");
                return 60000;
            }

            DateTime now = DateTime.UtcNow;
            if (now < _retryAt) return (int)Math.Min(5000, (_retryAt - now).TotalMilliseconds + 10);

            if (!_verified) VerifyEnrollment();
            if (_revoked) return 1000;
            RefreshPolicy(false);

            bool telemetry = DoesTelemetry();
            if (!telemetry) ReadWakeFile();
            bool awake = now < _awakeUntil || now < _localAwakeUntil || _session.Active;

            if (telemetry)
            {
                int interval = awake ? AwakeHeartbeatSeconds : _policy.HeartbeatSeconds;
                if (_forceHeartbeat || (now - _lastHeartbeat).TotalSeconds >= interval) Heartbeat();
            }

            int pollMs = _session.Active ? SessionPollMs : AwakePollMs;
            bool fallback = (now - _lastControlPoll).TotalMinutes >= FallbackPollMinutes;
            if ((awake && (now - _lastControlPoll).TotalMilliseconds >= pollMs) || fallback) PollControl();

            if (!_isService) StreamSession();
            FlushOwnFields();

            if (telemetry && (_forceInventory || now >= _inventoryDueAt) && !_inventoryRunning)
            {
                _forceInventory = false;
                _inventoryRunning = true;
                ThreadPool.QueueUserWorkItem(delegate { try { RunInventory(); } finally { _inventoryRunning = false; } });
            }

            if (_session.Active) return 150;
            return awake ? 400 : 1000;
        }

        private void SetStatus(string badge, Color color, string text)
        {
            StatusText = text;
            if (_ui != null) _ui.SetStatus(badge, color);
        }

        private void NoteFailure(int status)
        {
            _failures++;
            int seconds = (int)Math.Min(300, 5 * Math.Pow(2, Math.Min(6, _failures - 1)));
            _retryAt = DateTime.UtcNow.AddSeconds(seconds);
            SetStatus("SEM CONEXAO", Color.FromArgb(248, 113, 113),
                "Sem comunicacao com a nuvem (" + (status == 0 ? "rede" : status.ToString(CultureInfo.InvariantCulture)) + "). Nova tentativa em " + seconds + " s.");
            AgentLog.Write("Falha {0} ({1}); nova tentativa em {2} s. {3}", _failures, status, seconds, _cloud.LastError);
        }

        private void NoteSuccess()
        {
            if (_failures > 0) AgentLog.Write("Conexao restabelecida.");
            _failures = 0;
            if (_session.Active) SetStatus("EM ACESSO REMOTO", Color.FromArgb(216, 180, 254), "Sessao remota em andamento.");
            else SetStatus("CONECTADO", Color.FromArgb(52, 211, 153), "Conectado a nuvem do Nexus ITAM.");
        }

        private void VerifyEnrollment()
        {
            int status;
            _cloud.Get("agentEnrollments", _cred.uid, out status);
            if (status == 200)
            {
                _verified = true;
                return;
            }
            if (status == 404)
            {
                MarkRevoked();
                return;
            }
            if (status == 403) AgentLog.Write("Leitura da propria matricula negada: as regras do Firestore 3.1 foram publicadas?");
            if (_cloud.LastError.Contains("TOKEN_EXPIRED") || _cloud.LastError.Contains("USER_NOT_FOUND") || _cloud.LastError.Contains("USER_DISABLED"))
            {
                MarkRevoked();
                return;
            }
            NoteFailure(status);
        }

        private void MarkRevoked()
        {
            if (!_revoked) AgentLog.Write("Matricula revogada ou inexistente: o agente para de enviar dados.");
            _revoked = true;
            lock (_sync)
            {
                if (_session.Active) _session.State = "ended";
            }
            if (_ui != null) _ui.ShowSession(false, "");
        }

        private void RefreshPolicy(bool force)
        {
            if (!force && (DateTime.UtcNow - _policyAt).TotalMinutes < 30) return;
            int status;
            RemoteDoc doc = _cloud.Get("agentPolicies", _cred.tenantId, out status);
            if (status == 200 || status == 404)
            {
                _policy = AgentPolicy.From(doc != null ? doc.Fields : null);
                _policyAt = DateTime.UtcNow;
            }
            else if (status == 403)
            {
                _policyAt = DateTime.UtcNow;
                _verified = false;
            }
        }

        // ---- sinal de vida e "campainha" do console -------------------------

        private static readonly string[] TelemetryFields =
        {
            "tenantId", "deviceKey", "accessId", "hostname", "serialNumber", "deviceId", "internalId",
            "ipAddress", "macAddress", "osCaption", "loggedUser", "agentVersion", "status", "lastSeenAt",
            "updatedAt", "heartbeatSeconds", "capabilities", "metrics", "topProcesses",
            // Agentes 3.0 gravavam o token aqui: listado sem valor, o campo e apagado.
            "agentToken"
        };

        private void Heartbeat()
        {
            _forceHeartbeat = false;
            string ip, mac;
            MachineIdentity.PrimaryNetwork(out ip, out mac);
            Dictionary<string, object> f = Identity();
            f["accessId"] = MachineIdentity.AccessIdFor(_cred.deviceKey);
            f["hostname"] = Environment.MachineName;
            f["serialNumber"] = MachineIdentity.SerialNumber;
            f["deviceId"] = MachineIdentity.DeviceId;
            f["internalId"] = string.IsNullOrEmpty(_cfg.patrimony) ? Environment.MachineName : _cfg.patrimony;
            f["ipAddress"] = ip;
            f["macAddress"] = mac;
            f["osCaption"] = MachineIdentity.OsCaption;
            f["loggedUser"] = MachineIdentity.LoggedUser(_isService);
            f["agentVersion"] = AgentInfo.Version;
            f["status"] = "online";
            f["lastSeenAt"] = _cloud.ServerNowUtc;
            f["updatedAt"] = _cloud.ServerNowUtc;
            f["heartbeatSeconds"] = _policy.HeartbeatSeconds;
            Dictionary<string, object> caps = new Dictionary<string, object>();
            caps["service"] = _isService || ServiceRunning();
            caps["remoteAccess"] = _policy.RemoteAccess;
            caps["commands"] = _policy.CommandsEnabled;
            f["capabilities"] = caps;
            f["metrics"] = Telemetry.Metrics();
            f["topProcesses"] = Telemetry.TopProcesses(15);

            int status;
            RemoteDoc doc = _cloud.Patch("agentDevices", DocId(), f, TelemetryFields, new string[] { "consoleWakeAt" }, 20000, out status);
            _lastHeartbeat = DateTime.UtcNow;
            if (doc == null)
            {
                if (status == 403) _verified = false;
                NoteFailure(status);
                return;
            }
            NoteSuccess();
            ApplyWake(Json.Time(Json.Str(doc.Fields, "consoleWakeAt")));
        }

        /// <summary>O console pediu atencao nos ultimos 3 min: consulta o canal a cada 2 s.</summary>
        private void ApplyWake(DateTime? wakeAtServer)
        {
            if (!wakeAtServer.HasValue) return;
            DateTime until = _cloud.ToLocalClock(wakeAtServer.Value).AddSeconds(WakeWindowSeconds);
            if (until <= DateTime.UtcNow || until <= _awakeUntil) return;
            bool wasAwake = DateTime.UtcNow < _awakeUntil;
            _awakeUntil = until;
            if (!wasAwake) AgentLog.Write("Console pediu atencao: canal de controle ativo ate {0:HH:mm:ss}.", _awakeUntil.ToLocalTime());
            if (_isService)
            {
                try { File.WriteAllText(AgentPaths.WakeFile, _awakeUntil.ToString("o", CultureInfo.InvariantCulture)); } catch { }
            }
            _forceHeartbeat = true;
        }

        private void ReadWakeFile()
        {
            try
            {
                if (!File.Exists(AgentPaths.WakeFile)) return;
                DateTime until;
                if (DateTime.TryParse(File.ReadAllText(AgentPaths.WakeFile), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out until))
                {
                    until = until.ToUniversalTime();
                    if (until > _awakeUntil) _awakeUntil = until;
                }
            }
            catch { }
        }

        // ---- canal de controle ----------------------------------------------

        private void PollControl()
        {
            _lastControlPoll = DateTime.UtcNow;
            int status;
            RemoteDoc doc = _cloud.Get("agentControl", DocId(), out status);
            if (status == 404) return;
            if (doc == null)
            {
                if (status == 403) _verified = false;
                else if (status == 0) NoteFailure(status);
                return;
            }
            HandleCommand(Json.Map(doc.Fields, "pendingCommand"));
            if (!_isService) HandleSession(Json.Map(doc.Fields, "remoteSession"), Json.Time(Json.Str(doc.Fields, "viewerSeenAt")));
        }

        private void HandleCommand(Dictionary<string, object> cmd)
        {
            if (cmd == null || _commandRunning) return;
            string id = Json.Str(cmd, "id");
            string type = Json.Str(cmd, "type");
            if (string.IsNullOrEmpty(id) || _state.WasExecuted(id)) return;

            bool uiCommand = Commands.NeedsUserSession(type);
            bool telemetry = DoesTelemetry();
            if (uiCommand && _isService && TrayRunning()) return;     // a bandeja executa
            if (!uiCommand && !telemetry) return;                      // o servico executa

            _state.MarkExecuted(id);
            string command = Json.Str(cmd, "command");
            DateTime? issued = Json.Time(Json.Str(cmd, "issuedAt"));
            string refusal = null;
            if (!_policy.CommandsEnabled) refusal = "Comandos remotos desativados pela politica da empresa.";
            else if (!issued.HasValue) refusal = "Comando sem hora de emissao do servidor: ignorado.";
            else if ((_cloud.ServerNowUtc - issued.Value).TotalMinutes > CommandMaxAgeMinutes)
                refusal = string.Format(CultureInfo.InvariantCulture, "Comando expirado: emitido ha {0:0} min (limite {1} min).", (_cloud.ServerNowUtc - issued.Value).TotalMinutes, CommandMaxAgeMinutes);
            else if (_cloud.ToLocalClock(issued.Value) < MachineIdentity.BootTimeUtc.AddSeconds(-60))
                refusal = "Comando emitido antes do ultimo reinicio desta maquina: ignorado.";
            else if (command.Length > Commands.MaxCommandLength) refusal = "Comando longo demais.";
            else if (uiCommand && _isService) refusal = "Nenhum colaborador conectado nesta maquina para exibir a mensagem ou bloquear a tela.";

            if (refusal != null)
            {
                AgentLog.Write("Comando {0} ({1}) recusado: {2}", id, type, refusal);
                PublishResult(id, type, command, refusal, 2);
                return;
            }

            AgentLog.Write("Executando comando {0} ({1}) solicitado por {2}.", id, type, Json.Str(cmd, "requestedBy"));
            _commandRunning = true;
            ThreadPool.QueueUserWorkItem(delegate
            {
                string output;
                int exit = 0;
                try
                {
                    if (type == "msgbox")
                    {
                        string title = Json.Str(cmd, "title");
                        _ui.ShowMessage(string.IsNullOrEmpty(title) ? "Mensagem da TI - Nexus ITAM" : title, command);
                        output = "Mensagem exibida na tela do colaborador.";
                    }
                    else if (type == "lock_screen")
                    {
                        _ui.LockScreen();
                        output = "Estacao de trabalho bloqueada.";
                    }
                    else
                    {
                        bool inventory;
                        output = Commands.Run(type, command, out exit, out inventory);
                        if (inventory) _forceInventory = true;
                    }
                }
                catch (Exception ex)
                {
                    output = "Erro ao executar: " + ex.Message;
                    exit = 1;
                }
                PublishResult(id, type, command, output, exit);
                _commandRunning = false;
                _kick.Set();
            });
        }

        private bool TrayRunning()
        {
            try
            {
                foreach (Process p in Process.GetProcessesByName("NexusAgent"))
                {
                    using (p)
                    {
                        if (p.SessionId != 0 && p.Id != Process.GetCurrentProcess().Id) return true;
                    }
                }
            }
            catch { }
            return false;
        }

        private void PublishResult(string id, string type, string command, string output, int exitCode)
        {
            if (output != null && output.Length > 12000) output = output.Substring(0, 12000) + "\r\n... [saida truncada]";
            Dictionary<string, object> res = new Dictionary<string, object>();
            res["commandId"] = id;
            res["type"] = type;
            res["command"] = command.Length > 500 ? command.Substring(0, 500) : command;
            res["output"] = output ?? "";
            res["exitCode"] = exitCode;
            res["executedAs"] = WindowsIdentity.GetCurrent().Name;
            res["completedAt"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
            lock (_sync) _lastCommandResult = res;
            _kick.Set();
        }

        // ---- campos que a bandeja e o servico gravam fora do sinal de vida --

        private void FlushOwnFields()
        {
            Dictionary<string, object> result;
            Dictionary<string, object> support;
            lock (_sync)
            {
                result = _lastCommandResult;
                support = _pendingSupport;
            }
            if (result == null && support == null && !_session.Dirty) return;

            Dictionary<string, object> f = Identity();
            List<string> mask = new List<string> { "tenantId", "deviceKey" };
            if (result != null) { f["lastCommandResult"] = result; mask.Add("lastCommandResult"); }
            if (support != null) { f["supportRequest"] = support; mask.Add("supportRequest"); }
            bool sessionDirty = _session.Dirty;
            if (sessionDirty)
            {
                f["remoteState"] = SessionStateFields();
                mask.Add("remoteState");
                if (!_session.Active)
                {
                    mask.Add("screenFrame");   // sem valor: apaga o ultimo frame
                    _session.FrameVisible = false;
                }
            }
            int status;
            RemoteDoc doc = _cloud.Patch("agentDevices", DocId(), f, mask, new string[] { "consoleWakeAt" }, 20000, out status);
            if (doc == null)
            {
                NoteFailure(status);
                return;
            }
            lock (_sync)
            {
                if (ReferenceEquals(_lastCommandResult, result)) _lastCommandResult = null;
                if (ReferenceEquals(_pendingSupport, support)) _pendingSupport = null;
                if (sessionDirty) _session.Dirty = false;
            }
            if (support != null) AgentLog.Write("Pedido de suporte enviado.");
            ApplyWake(Json.Time(Json.Str(doc.Fields, "consoleWakeAt")));
        }

        // ---- acesso remoto (bandeja) ----------------------------------------

        private Dictionary<string, object> SessionStateFields()
        {
            Dictionary<string, object> rs = new Dictionary<string, object>();
            rs["sessionId"] = _session.Id;
            rs["state"] = _session.State;
            rs["operatorName"] = _session.Operator;
            rs["mode"] = _session.Mode;
            rs["lastInputSeq"] = _session.LastSeq;
            rs["policy"] = _policy.RemoteAccess;
            rs["updatedAt"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
            return rs;
        }

        private void HandleSession(Dictionary<string, object> rs, DateTime? viewerSeen)
        {
            if (viewerSeen.HasValue) _session.ViewerSeenUtc = viewerSeen.Value;
            if (rs == null) return;
            string status = Json.Str(rs, "status");
            string sessionId = Json.Str(rs, "sessionId");

            if (status == "closed" || status == "ended" || string.IsNullOrEmpty(sessionId))
            {
                if (_session.Active) EndSession("ended", "Sessao encerrada pelo tecnico.");
                return;
            }
            if (status != "requesting" && status != "active") return;
            if (_session.Decided.Contains(sessionId) && sessionId != _session.Id) return;

            if (sessionId != _session.Id)
            {
                if (_session.Active) EndSession("ended", "Substituida por nova sessao.");
                _session.Id = sessionId;
                _session.Operator = Json.Str(rs, "requestedBy");
                if (string.IsNullOrEmpty(_session.Operator)) _session.Operator = "Equipe de TI";
                _session.Mode = Json.Str(rs, "mode") == "unattended" ? "unattended" : "attended";
                _session.LastSeq = 0;
                _session.ViewerSeenUtc = viewerSeen.HasValue ? viewerSeen.Value : DateTime.MinValue;
                _session.Decided.Add(sessionId);

                string decision;
                if (_policy.RemoteAccess == "disabled") decision = "refused_policy";
                else if (_session.Mode == "unattended" && _policy.RemoteAccess == "unattended") decision = "active";
                else
                {
                    // O console mostra "aguardando o colaborador" enquanto o dialogo esta aberto.
                    lock (_sync)
                    {
                        _session.State = "awaiting_consent";
                        _session.Dirty = true;
                    }
                    FlushOwnFields();
                    decision = _ui != null && _ui.AskConsent(_session.Operator) ? "active" : "rejected";
                }

                lock (_sync)
                {
                    _session.State = decision;
                    _session.StartedUtc = DateTime.UtcNow;
                    _session.Dirty = true;
                }
                AgentLog.Write("Sessao remota {0} de {1} ({2}): {3}.", sessionId, _session.Operator, _session.Mode, decision);
                if (_ui != null) _ui.ShowSession(_session.Active, _session.Operator);
                _forceHeartbeat = true;
            }

            if (!_session.Active || sessionId != _session.Id) return;
            string quality = Json.Str(rs, "quality");
            if (quality == "low" || quality == "balanced" || quality == "high") _session.Quality = quality;

            object raw;
            if (!rs.TryGetValue("inputEvents", out raw)) return;
            List<object> events = raw as List<object>;
            if (events == null) return;
            foreach (object item in events)
            {
                Dictionary<string, object> ev = item as Dictionary<string, object>;
                long seq = Json.Long(ev, "seq", 0);
                if (ev == null || seq <= _session.LastSeq) continue;
                _session.LastSeq = seq;
                RemoteDesktop.Input(ev);
            }
        }

        private void EndSession(string state, string reason)
        {
            lock (_sync)
            {
                _session.State = state;
                _session.Dirty = true;
            }
            AgentLog.Write("Sessao remota {0} encerrada: {1}", _session.Id, reason);
            if (_ui != null) _ui.ShowSession(false, "");
        }

        /// <summary>Frames so com sessao ativa, alguem assistindo e tela mudando.</summary>
        private void StreamSession()
        {
            if (!_session.Active) return;
            DateTime now = DateTime.UtcNow;
            DateTime viewer = _session.StartedUtc;
            if (_session.ViewerSeenUtc != DateTime.MinValue)
            {
                DateTime seen = _cloud.ToLocalClock(_session.ViewerSeenUtc);
                if (seen > viewer) viewer = seen;
            }
            double idle = (now - viewer).TotalSeconds;
            if (idle > 180)
            {
                EndSession("timeout", "Ninguem assistindo ha mais de 3 min.");
                return;
            }
            if (idle > 45 || (now - _session.LastFrameAt).TotalMilliseconds < SessionPollMs) return;

            string signature;
            Dictionary<string, object> frame = RemoteDesktop.Capture(_session.Quality, out signature);
            if (frame == null) return;
            bool changed = signature != _session.LastFrameSig;
            if (!changed && (now - _session.LastFrameAt).TotalSeconds < 10 && _session.FrameVisible) return;

            Dictionary<string, object> f = Identity();
            f["screenFrame"] = frame;
            f["remoteState"] = SessionStateFields();
            int status;
            RemoteDoc doc = _cloud.Patch("agentDevices", DocId(), f, new string[] { "tenantId", "deviceKey", "screenFrame", "remoteState" }, new string[] { "consoleWakeAt" }, 15000, out status);
            _session.LastFrameAt = DateTime.UtcNow;
            if (doc == null)
            {
                NoteFailure(status);
                return;
            }
            _session.LastFrameSig = signature;
            _session.FrameVisible = true;
            lock (_sync) _session.Dirty = false;
        }

        // ---- inventario ------------------------------------------------------

        private void RunInventory()
        {
            if (_ui != null) _ui.SetSyncText("Coletando inventario...");
            Dictionary<string, object> payload = null;
            string source;
            if (File.Exists(AgentPaths.CollectorScript))
            {
                payload = CollectWithScript();
                source = _isService ? "NexusAgent.exe (Windows, servico)" : "NexusAgent.exe (Windows)";
            }
            else
            {
                source = "NexusAgent.exe (Windows, coleta basica)";
            }
            if (payload == null) payload = BasicInventory();
            payload.Remove("deviceKey");
            payload["agentVersion"] = AgentInfo.Version;
            if (!string.IsNullOrEmpty(_cfg.patrimony)) payload["internalId"] = _cfg.patrimony;

            string ip, mac;
            MachineIdentity.PrimaryNetwork(out ip, out mac);
            Dictionary<string, object> doc = Identity();
            doc["status"] = "pending";
            doc["source"] = source;
            doc["agentVersion"] = AgentInfo.Version;
            doc["hostname"] = Environment.MachineName;
            doc["serialNumber"] = MachineIdentity.SerialNumber;
            doc["deviceId"] = MachineIdentity.DeviceId;
            doc["internalId"] = _cfg.patrimony ?? "";
            doc["ip_address"] = ip;
            doc["createdAt"] = _cloud.ServerNowUtc;
            doc["payload"] = payload;

            int status;
            RemoteDoc written = _cloud.Patch("agentInbox", DocId(), doc, null, new string[] { "status" }, 60000, out status);
            if (written != null)
            {
                _state.lastInventoryUtc = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
                _state.Save();
                _inventoryDueAt = DateTime.UtcNow.AddHours(InventoryHours);
                AgentLog.Write("Inventario enviado ({0}).", source);
                if (_ui != null) _ui.SetSyncText("Inventario enviado as " + DateTime.Now.ToString("HH:mm", CultureInfo.InvariantCulture));
            }
            else
            {
                _inventoryDueAt = DateTime.UtcNow.AddMinutes(30);
                AgentLog.Write("Falha ao enviar inventario ({0}): {1}", status, _cloud.LastError);
                if (_ui != null) _ui.SetSyncText("Falha ao enviar inventario; nova tentativa em 30 min.");
            }
        }

        private Dictionary<string, object> CollectWithScript()
        {
            string output = Path.Combine(Path.GetTempPath(), "nexus-inventory-" + Guid.NewGuid().ToString("N") + ".json");
            try
            {
                int exit;
                string log = PowerShell.RunArgs("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + AgentPaths.CollectorScript + "\" -OutFile \"" + output + "\"", 300000, out exit);
                if (exit != 0 || !File.Exists(output))
                {
                    AgentLog.Write("Coletor terminou com codigo {0}: {1}", exit, Http.Brief(log));
                    return null;
                }
                return Json.ParseObject(File.ReadAllText(output, Encoding.UTF8));
            }
            catch (Exception ex)
            {
                AgentLog.Write("Coletor falhou: {0}", ex.Message);
                return null;
            }
            finally
            {
                try { File.Delete(output); } catch { }
            }
        }

        private Dictionary<string, object> BasicInventory()
        {
            int ramPct, diskPct;
            double ramUsed, ramTotal, diskFree, diskTotal;
            Telemetry.Memory(out ramPct, out ramUsed, out ramTotal);
            Telemetry.SystemDrive(out diskPct, out diskFree, out diskTotal);
            string ip, mac;
            MachineIdentity.PrimaryNetwork(out ip, out mac);
            Dictionary<string, object> p = new Dictionary<string, object>();
            p["collectedAt"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
            p["hostname"] = Environment.MachineName;
            p["serialNumber"] = MachineIdentity.SerialNumber;
            p["deviceId"] = MachineIdentity.DeviceId;
            p["manufacturer"] = MachineIdentity.Wmi("Win32_ComputerSystem", "Manufacturer");
            p["model"] = MachineIdentity.Wmi("Win32_ComputerSystem", "Model");
            p["type"] = "Computador";
            p["os_caption"] = MachineIdentity.OsCaption;
            p["os_arch"] = Environment.Is64BitOperatingSystem ? "64-bit" : "32-bit";
            p["processor"] = MachineIdentity.Wmi("Win32_Processor", "Name");
            p["cpu_cores"] = Environment.ProcessorCount;
            p["ram_total_gb"] = ramTotal;
            p["ip_address"] = ip;
            p["mac_address"] = mac;
            p["logged_user"] = MachineIdentity.LoggedUser(_isService);
            p["uptime_hours"] = Telemetry.UptimeHours();
            return p;
        }
    }

    // -------------------------------------------------------------------------
    // Instalacao, matricula e remocao
    // -------------------------------------------------------------------------
    internal static class Installer
    {
        public static bool IsAdmin()
        {
            try { return new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator); }
            catch { return false; }
        }

        private static int Tool(string file, string args, out string output)
        {
            output = "";
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(file, args);
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                using (Process p = Process.Start(psi))
                {
                    output = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd();
                    p.WaitForExit(60000);
                    return p.ExitCode;
                }
            }
            catch (Exception ex)
            {
                output = ex.Message;
                return -1;
            }
        }

        private static int Tool(string file, string args)
        {
            string ignored;
            return Tool(file, args, out ignored);
        }

        private static string Sys(string exe)
        {
            return Path.Combine(Environment.SystemDirectory, exe);
        }

        /// <summary>Matricula esta maquina (ou reaproveita a matricula valida) e tira o token do disco.</summary>
        public static int Enroll(AgentConfig cfg, out string error)
        {
            error = null;
            DeviceCredential existing = DeviceCredential.Load(AgentPaths.CredentialFile);
            if (existing != null && (string.IsNullOrEmpty(cfg.tenantId) || existing.tenantId == cfg.tenantId))
            {
                // Matricula revogada (apagada) nao serve: com token em maos, matricula de novo.
                int status;
                new CloudClient(cfg, existing).Get("agentEnrollments", existing.uid, out status);
                if (status != 404 || string.IsNullOrEmpty(cfg.agentToken))
                {
                    AgentLog.Write("Maquina ja matriculada na empresa {0}; matricula mantida ({1}).", existing.tenantId, status);
                    StripToken(cfg);
                    return 0;
                }
                AgentLog.Write("Matricula anterior foi revogada; matriculando de novo.");
            }
            string deviceKey = MachineIdentity.DeviceKey;
            DeviceCredential cred = Enrollment.Enroll(cfg, deviceKey, out error);
            if (cred == null)
            {
                AgentLog.Write("Matricula falhou: {0}", error);
                return 3;
            }
            if (!cred.Save(AgentPaths.CredentialFile))
            {
                error = "Nao foi possivel gravar a credencial em " + AgentPaths.CredentialFile;
                return 4;
            }
            AgentLog.Write("Maquina matriculada na empresa {0} (chave {1}).", cred.tenantId, cred.deviceKey);
            StripToken(cfg);
            return 0;
        }

        // Depois da matricula o token da empresa nao fica em lugar nenhum da maquina.
        private static void StripToken(AgentConfig cfg)
        {
            string source = cfg.LoadedFrom;
            cfg.agentToken = "";
            cfg.SaveTo(AgentPaths.ConfigFile);
            if (!string.IsNullOrEmpty(source) && !string.Equals(Path.GetFullPath(source), Path.GetFullPath(AgentPaths.ConfigFile), StringComparison.OrdinalIgnoreCase))
            {
                cfg.SaveTo(source);
            }
        }

        public static int Install(AgentConfig cfg, bool launchTray, out string error)
        {
            error = null;
            if (!IsAdmin())
            {
                error = "A instalacao precisa ser executada como administrador.";
                return 2;
            }
            AgentPaths.DataDir = AgentPaths.MachineDir;
            Directory.CreateDirectory(AgentPaths.MachineDir);

            string current = Application.ExecutablePath;
            string target = AgentPaths.InstalledExe;
            if (!string.Equals(Path.GetFullPath(current), Path.GetFullPath(target), StringComparison.OrdinalIgnoreCase))
            {
                Tool(Sys("sc.exe"), "stop " + AgentInfo.ServiceName);
                KillOthers();
                Thread.Sleep(1500);
                try
                {
                    File.Copy(current, target, true);
                }
                catch (Exception ex)
                {
                    error = "Nao foi possivel copiar o executavel: " + ex.Message;
                    return 4;
                }
                string scriptBeside = Path.Combine(Path.GetDirectoryName(current), "NexusAgent.ps1");
                if (File.Exists(scriptBeside)) File.Copy(scriptBeside, AgentPaths.CollectorScript, true);
            }

            int enrolled = Enroll(cfg, out error);
            if (enrolled != 0) return enrolled;

            // Pasta da maquina: so SYSTEM/Administradores alteram; usuarios leem
            // (a bandeja usa a credencial). Logs: usuarios gravam.
            Tool(Sys("icacls.exe"), "\"" + AgentPaths.MachineDir + "\" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F *S-1-5-32-545:(OI)(CI)RX");
            Directory.CreateDirectory(Path.Combine(AgentPaths.MachineDir, "logs"));
            Tool(Sys("icacls.exe"), "\"" + Path.Combine(AgentPaths.MachineDir, "logs") + "\" /grant *S-1-5-32-545:(OI)(CI)M");

            string binPath = "\"\\\"" + target + "\\\" --service\"";
            string output;
            int exists = Tool(Sys("sc.exe"), "query " + AgentInfo.ServiceName);
            if (exists == 0) Tool(Sys("sc.exe"), "config " + AgentInfo.ServiceName + " binPath= " + binPath + " start= auto", out output);
            else Tool(Sys("sc.exe"), "create " + AgentInfo.ServiceName + " binPath= " + binPath + " start= auto DisplayName= \"" + AgentInfo.ServiceDisplayName + "\"", out output);
            Tool(Sys("sc.exe"), "description " + AgentInfo.ServiceName + " \"Inventario, monitoramento e suporte remoto do Nexus ITAM.\"");
            Tool(Sys("sc.exe"), "failure " + AgentInfo.ServiceName + " reset= 86400 actions= restart/60000/restart/60000/restart/300000");
            int started = Tool(Sys("sc.exe"), "start " + AgentInfo.ServiceName, out output);
            AgentLog.Write("Servico {0}: {1}", AgentInfo.ServiceName, started == 0 ? "iniciado" : Http.Brief(output));

            // Coleta agendada antiga (2.x): o servico assume.
            Tool(Sys("schtasks.exe"), "/Delete /TN " + AgentInfo.LegacyTaskName + " /F");

            try
            {
                using (RegistryKey run = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Run", true))
                {
                    if (run != null) run.SetValue(AgentInfo.RunValueName, "\"" + target + "\" --tray");
                }
            }
            catch (Exception ex)
            {
                AgentLog.Write("Inicializacao automatica da bandeja falhou: {0}", ex.Message);
            }

            CreateShortcut(target);

            // Abre a bandeja SEM privilegios de administrador na sessao atual.
            if (launchTray && Environment.UserInteractive && !WindowsIdentity.GetCurrent().IsSystem)
            {
                try { Process.Start(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe"), "\"" + target + "\""); } catch { }
            }
            AgentLog.Write("Instalacao {0} concluida.", AgentInfo.Version);
            return 0;
        }

        private static void CreateShortcut(string target)
        {
            try
            {
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory);
                if (string.IsNullOrEmpty(desktop)) return;
                try { File.Delete(Path.Combine(desktop, AgentInfo.LegacyShortcutName)); } catch { }
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                object shell = Activator.CreateInstance(shellType);
                object link = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { Path.Combine(desktop, AgentInfo.ShortcutName) });
                Type linkType = link.GetType();
                linkType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link, new object[] { target });
                linkType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, link, new object[] { Path.GetDirectoryName(target) });
                linkType.InvokeMember("Description", BindingFlags.SetProperty, null, link, new object[] { "ID de acesso remoto e pedido de suporte a TI" });
                linkType.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
            }
            catch (Exception ex)
            {
                AgentLog.Write("Atalho nao criado: {0}", ex.Message);
            }
        }

        private static void KillOthers()
        {
            int self = Process.GetCurrentProcess().Id;
            foreach (Process p in Process.GetProcessesByName("NexusAgent"))
            {
                using (p)
                {
                    if (p.Id == self) continue;
                    try { p.Kill(); } catch { }
                }
            }
        }

        public static int Uninstall(AgentConfig cfg)
        {
            if (!IsAdmin()) return 2;
            AgentPaths.DataDir = AgentPaths.MachineDir;
            DeviceCredential cred = DeviceCredential.Load(AgentPaths.CredentialFile);
            if (cred != null)
            {
                // A maquina sai da empresa: some do console como "removido" e perde o acesso.
                CloudClient cloud = new CloudClient(cfg, cred);
                Dictionary<string, object> f = new Dictionary<string, object>();
                f["tenantId"] = cred.tenantId;
                f["deviceKey"] = cred.deviceKey;
                f["status"] = "uninstalled";
                f["updatedAt"] = cloud.ServerNowUtc;
                int status;
                cloud.Patch("agentDevices", cred.tenantId + "_" + cred.deviceKey, f, new string[] { "tenantId", "deviceKey", "status", "updatedAt", "screenFrame" }, new string[] { "status" }, 10000, out status);
                cloud.Delete("agentEnrollments", cred.uid, out status);
                AgentLog.Write("Matricula removida ({0}).", status);
            }
            Tool(Sys("sc.exe"), "stop " + AgentInfo.ServiceName);
            Thread.Sleep(2000);
            Tool(Sys("sc.exe"), "delete " + AgentInfo.ServiceName);
            Tool(Sys("schtasks.exe"), "/Delete /TN " + AgentInfo.LegacyTaskName + " /F");
            try
            {
                using (RegistryKey run = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Run", true))
                {
                    if (run != null) run.DeleteValue(AgentInfo.RunValueName, false);
                }
            }
            catch { }
            string desktop = Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory);
            foreach (string name in new string[] { AgentInfo.ShortcutName, AgentInfo.LegacyShortcutName })
            {
                try { File.Delete(Path.Combine(desktop, name)); } catch { }
            }
            KillOthers();
            // O executavel em uso so sai depois que este processo termina.
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(Sys("cmd.exe"), "/c ping 127.0.0.1 -n 4 > nul & rd /s /q \"" + AgentPaths.MachineDir + "\"");
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                Process.Start(psi);
            }
            catch { }
            return 0;
        }
    }

    // -------------------------------------------------------------------------
    // Servico do Windows
    // -------------------------------------------------------------------------
    internal class AgentService : ServiceBase
    {
        private AgentEngine _engine;

        public AgentService()
        {
            ServiceName = AgentInfo.ServiceName;
            CanStop = true;
            CanShutdown = true;
        }

        protected override void OnStart(string[] args)
        {
            AgentPaths.DataDir = AgentPaths.MachineDir;
            _engine = new AgentEngine(true, AgentConfig.Load(null), null);
            _engine.Start();
        }

        protected override void OnStop()
        {
            if (_engine != null) _engine.Stop();
        }

        protected override void OnShutdown()
        {
            OnStop();
        }
    }

    // -------------------------------------------------------------------------
    // Interface (bandeja)
    // -------------------------------------------------------------------------
    internal static class Ui
    {
        public static readonly Color Ink = Color.FromArgb(15, 23, 42);
        public static readonly Color Muted = Color.FromArgb(100, 116, 139);
        public static readonly Color Brand = Color.FromArgb(37, 99, 235);
        public static readonly Color Line = Color.FromArgb(203, 213, 225);

        public static Button Flat(string text, Color back, Color fore, int x, int y, int w, int h, bool bold)
        {
            Button b = new Button();
            b.Text = text;
            b.Font = new Font("Segoe UI", 9f, bold ? FontStyle.Bold : FontStyle.Regular);
            b.BackColor = back;
            b.ForeColor = fore;
            b.FlatStyle = FlatStyle.Flat;
            b.FlatAppearance.BorderColor = Line;
            b.FlatAppearance.BorderSize = back == Color.White ? 1 : 0;
            b.Location = new Point(x, y);
            b.Size = new Size(w, h);
            b.Cursor = Cursors.Hand;
            return b;
        }

        public static Label Text(string text, float size, bool bold, Color color, int x, int y)
        {
            Label l = new Label();
            l.Text = text;
            l.Font = new Font("Segoe UI", size, bold ? FontStyle.Bold : FontStyle.Regular);
            l.ForeColor = color;
            l.Location = new Point(x, y);
            l.AutoSize = true;
            return l;
        }

        public const string PrivacyText =
            "O que o Agente Nexus ITAM coleta neste computador:\r\n\r\n" +
            "- Inventario do equipamento: fabricante, modelo, numero de serie, processador, memoria, discos, " +
            "monitores, rede, sistema operacional, programas instalados, antivirus, firewall e criptografia.\r\n" +
            "- Uso de recursos: CPU, memoria, disco e os processos que mais consomem memoria.\r\n" +
            "- O nome do usuario conectado, para vincular o equipamento ao responsavel.\r\n\r\n" +
            "O que ele NAO faz:\r\n" +
            "- Nao le seus arquivos, e-mails, conversas ou historico de navegacao.\r\n" +
            "- Nao grava sua tela. A tela so e transmitida durante uma sessao de suporte remoto, " +
            "com aviso fixo no topo da tela; voce pode encerrar a sessao a qualquer momento.\r\n\r\n" +
            "Os dados pertencem a empresa onde voce trabalha, que define quem da equipe de TI pode acessa-los. " +
            "Duvidas sobre seus dados: fale com a TI ou com o encarregado de dados (DPO) da empresa.";
    }

    public class ConsentDialog : Form
    {
        private readonly Label _timer;
        private int _seconds = 30;

        public ConsentDialog(string operatorName)
        {
            Text = "Nexus ITAM - Pedido de acesso remoto";
            Size = new Size(480, 270);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterScreen;
            MaximizeBox = false;
            MinimizeBox = false;
            TopMost = true;
            ShowInTaskbar = true;
            BackColor = Ui.Ink;
            ForeColor = Color.White;

            Label title = Ui.Text("A equipe de TI pede acesso a esta tela", 13f, true, Color.FromArgb(56, 189, 248), 24, 18);
            Label body = new Label();
            body.Text = string.Format("{0} quer ver e controlar sua tela para prestar suporte. Enquanto a sessao durar, " +
                "um aviso fica no topo da tela e voce pode encerrar a qualquer momento.", operatorName);
            body.Font = new Font("Segoe UI", 9.5f);
            body.ForeColor = Color.FromArgb(203, 213, 225);
            body.Location = new Point(24, 54);
            body.Size = new Size(420, 60);

            _timer = Ui.Text("Recusa automatica em 30 s", 9f, true, Color.FromArgb(251, 191, 36), 24, 122);

            Button allow = Ui.Flat("Permitir acesso", Color.FromArgb(16, 185, 129), Color.White, 24, 162, 200, 40, true);
            allow.Click += delegate { DialogResult = DialogResult.OK; Close(); };
            Button deny = Ui.Flat("Recusar", Color.FromArgb(239, 68, 68), Color.White, 244, 162, 200, 40, true);
            deny.Click += delegate { DialogResult = DialogResult.Cancel; Close(); };

            Controls.AddRange(new Control[] { title, body, _timer, allow, deny });
            AcceptButton = deny;
            CancelButton = deny;
            ActiveControl = deny;

            System.Windows.Forms.Timer countdown = new System.Windows.Forms.Timer();
            countdown.Interval = 1000;
            countdown.Tick += delegate
            {
                _seconds--;
                if (_seconds <= 0)
                {
                    countdown.Stop();
                    DialogResult = DialogResult.Cancel;
                    Close();
                }
                else
                {
                    _timer.Text = string.Format("Recusa automatica em {0} s", _seconds);
                }
            };
            countdown.Start();
        }
    }

    /// <summary>Faixa fixa no topo da tela durante a sessao remota.</summary>
    public class SessionIndicator : Form
    {
        private readonly Label _label;

        public SessionIndicator(Action onEnd)
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            BackColor = Color.FromArgb(126, 34, 206);
            Size = new Size(520, 40);
            Rectangle area = Screen.PrimaryScreen.WorkingArea;
            Location = new Point(area.Left + (area.Width - Width) / 2, area.Top);

            _label = Ui.Text("", 9.5f, true, Color.White, 12, 11);
            Button end = Ui.Flat("Encerrar acesso", Color.FromArgb(239, 68, 68), Color.White, 384, 5, 128, 30, true);
            end.Click += delegate { onEnd(); };
            Controls.Add(_label);
            Controls.Add(end);
        }

        public void SetOperator(string name)
        {
            _label.Text = "Sessao remota ativa: " + name;
        }

        protected override bool ShowWithoutActivation { get { return true; } }
    }

    public class SupportDialog : Form
    {
        public string Issue { get; private set; }
        public string Priority { get; private set; }

        public SupportDialog()
        {
            Text = "Pedir suporte a TI - Nexus ITAM";
            Size = new Size(460, 320);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterScreen;
            MaximizeBox = false;
            MinimizeBox = false;
            BackColor = Color.White;

            Label title = Ui.Text("Como a TI pode ajudar?", 11.5f, true, Ui.Ink, 20, 18);
            Label prioLabel = Ui.Text("Urgencia:", 9f, true, Ui.Ink, 20, 54);
            ComboBox prio = new ComboBox();
            prio.DropDownStyle = ComboBoxStyle.DropDownList;
            prio.Font = new Font("Segoe UI", 9.5f);
            prio.Items.AddRange(new object[] { "Normal", "Alta - Trabalho impactado", "Critica - Computador parado" });
            prio.SelectedIndex = 0;
            prio.Location = new Point(20, 76);
            prio.Size = new Size(400, 28);
            Label msgLabel = Ui.Text("Descreva o problema:", 9f, true, Ui.Ink, 20, 114);
            TextBox msg = new TextBox();
            msg.Multiline = true;
            msg.MaxLength = 1000;
            msg.Font = new Font("Segoe UI", 9.5f);
            msg.Location = new Point(20, 136);
            msg.Size = new Size(400, 80);

            Button send = Ui.Flat("Enviar para a TI", Ui.Brand, Color.White, 20, 228, 260, 38, true);
            send.Click += delegate
            {
                if (msg.Text.Trim().Length == 0)
                {
                    MessageBox.Show(this, "Descreva o problema para a equipe de TI.", "Nexus ITAM", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                Issue = msg.Text.Trim();
                Priority = Convert.ToString(prio.SelectedItem, CultureInfo.InvariantCulture);
                DialogResult = DialogResult.OK;
                Close();
            };
            Button cancel = Ui.Flat("Cancelar", Color.White, Ui.Ink, 290, 228, 130, 38, false);
            cancel.Click += delegate { DialogResult = DialogResult.Cancel; Close(); };
            Controls.AddRange(new Control[] { title, prioLabel, prio, msgLabel, msg, send, cancel });
        }
    }

    /// <summary>Primeiro uso do executavel avulso: dados da empresa para instalar.</summary>
    public class SetupDialog : Form
    {
        public string TenantId { get; private set; }
        public string Token { get; private set; }

        public SetupDialog(AgentConfig current)
        {
            Text = "Conectar este computador - Nexus ITAM";
            Size = new Size(480, 300);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterScreen;
            MaximizeBox = false;
            MinimizeBox = false;
            BackColor = Color.White;

            Label intro = new Label();
            intro.Text = "Copie o ID da empresa e o token em Agente ITAM > Instalar, no painel web. " +
                "A instalacao pede permissao de administrador.";
            intro.Font = new Font("Segoe UI", 9f);
            intro.ForeColor = Ui.Muted;
            intro.Location = new Point(20, 14);
            intro.Size = new Size(420, 36);
            Label l1 = Ui.Text("ID da empresa", 9f, true, Ui.Ink, 20, 56);
            TextBox tenant = new TextBox { Text = current.tenantId, Font = new Font("Consolas", 10f), Location = new Point(20, 78), Size = new Size(420, 26) };
            Label l2 = Ui.Text("Token do agente", 9f, true, Ui.Ink, 20, 114);
            TextBox token = new TextBox { Text = current.agentToken, Font = new Font("Consolas", 10f), Location = new Point(20, 136), Size = new Size(420, 26), UseSystemPasswordChar = true };

            Button ok = Ui.Flat("Instalar e conectar", Color.FromArgb(16, 185, 129), Color.White, 20, 190, 270, 38, true);
            ok.Click += delegate
            {
                if (tenant.Text.Trim().Length == 0 || token.Text.Trim().Length == 0)
                {
                    MessageBox.Show(this, "Informe o ID da empresa e o token do agente.", "Nexus ITAM", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                TenantId = tenant.Text.Trim();
                Token = token.Text.Trim();
                DialogResult = DialogResult.OK;
                Close();
            };
            Button cancel = Ui.Flat("Cancelar", Color.White, Ui.Ink, 300, 190, 140, 38, false);
            cancel.Click += delegate { DialogResult = DialogResult.Cancel; Close(); };
            Controls.AddRange(new Control[] { intro, l1, tenant, l2, token, ok, cancel });
        }
    }

    public class MainAgentForm : Form, IAgentUi
    {
        private readonly AgentConfig _config;
        private readonly AgentEngine _engine;
        private readonly bool _startHidden;
        private NotifyIcon _tray;
        private Label _badge;
        private Label _info;
        private Label _cpu;
        private Label _ram;
        private Label _disk;
        private Panel _cpuBar;
        private Panel _ramBar;
        private Panel _diskBar;
        private Label _sync;
        private Label _statusLine;
        private Button _connect;
        private SessionIndicator _indicator;
        private MenuItem _endSessionItem;
        private bool _started;

        public MainAgentForm(AgentConfig config, bool startHidden)
        {
            _config = config;
            _startHidden = startHidden;
            _engine = new AgentEngine(false, config, this);
            BuildUi();
            BuildTray();
        }

        // O motor conversa com a tela via BeginInvoke: so depois que a janela existe.
        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            if (_started) return;
            _started = true;
            _engine.Start();
        }

        protected override void SetVisibleCore(bool value)
        {
            if (_startHidden && !IsHandleCreated)
            {
                CreateHandle();
                value = false;
            }
            base.SetVisibleCore(value);
        }

        private static Icon MakeIcon(bool remote)
        {
            using (Bitmap bmp = new Bitmap(32, 32))
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
                using (SolidBrush bg = new SolidBrush(remote ? Color.FromArgb(147, 51, 234) : Ui.Ink))
                using (SolidBrush dot = new SolidBrush(remote ? Color.FromArgb(250, 204, 21) : Color.FromArgb(16, 185, 129)))
                using (Font f = new Font("Segoe UI", 13f, FontStyle.Bold, GraphicsUnit.Pixel))
                {
                    g.FillEllipse(bg, 1, 1, 30, 30);
                    g.DrawString("NX", f, Brushes.White, new PointF(4f, 7f));
                    g.FillEllipse(dot, 21, 21, 9, 9);
                }
                return Icon.FromHandle(bmp.GetHicon());
            }
        }

        private void BuildUi()
        {
            Text = "Nexus ITAM - Agente e Suporte Remoto";
            Size = new Size(720, 480);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(241, 245, 249);
            Icon = MakeIcon(false);

            Panel header = new Panel { Dock = DockStyle.Top, Height = 64, BackColor = Ui.Ink };
            header.Controls.Add(Ui.Text("NEXUS ITAM", 14f, true, Color.White, 22, 12));
            header.Controls.Add(Ui.Text("Agente de inventario e suporte remoto  v" + AgentInfo.Version, 8.5f, false, Color.FromArgb(148, 163, 184), 24, 37));
            _badge = new Label
            {
                Text = "INICIANDO",
                Font = new Font("Segoe UI", 9f, FontStyle.Bold),
                ForeColor = Color.FromArgb(52, 211, 153),
                BackColor = Color.FromArgb(30, 41, 59),
                TextAlign = ContentAlignment.MiddleCenter,
                Location = new Point(505, 17),
                Size = new Size(185, 30)
            };
            header.Controls.Add(_badge);

            Panel left = new Panel { Location = new Point(20, 80), Size = new Size(340, 260), BackColor = Color.White };
            left.Controls.Add(Ui.Text("SEU ID DE ACESSO REMOTO", 8.5f, true, Ui.Muted, 18, 16));
            Label id = new Label { Text = _engine.AccessId, Font = new Font("Consolas", 23f, FontStyle.Bold), ForeColor = Ui.Brand, Location = new Point(14, 38), AutoSize = true };
            left.Controls.Add(id);
            Button copy = Ui.Flat("Copiar ID", Color.FromArgb(239, 246, 255), Ui.Brand, 242, 43, 80, 30, true);
            copy.Click += delegate
            {
                try { Clipboard.SetText(_engine.AccessId); copy.Text = "Copiado!"; } catch { }
            };
            left.Controls.Add(copy);
            _info = new Label { Font = new Font("Segoe UI", 9f), ForeColor = Color.FromArgb(51, 65, 85), Location = new Point(18, 92), Size = new Size(310, 120) };
            left.Controls.Add(_info);
            _connect = Ui.Flat("Conectar este computador...", Ui.Brand, Color.White, 18, 214, 304, 34, true);
            _connect.Visible = !_engine.Enrolled;
            _connect.Click += delegate { StartSetup(); };
            left.Controls.Add(_connect);
            RefreshInfo();

            Panel right = new Panel { Location = new Point(374, 80), Size = new Size(310, 260), BackColor = Color.White };
            right.Controls.Add(Ui.Text("RECURSOS EM TEMPO REAL", 8.5f, true, Ui.Muted, 18, 16));
            AddMeter(right, "Processador", 46, Color.FromArgb(59, 130, 246), out _cpu, out _cpuBar);
            AddMeter(right, "Memoria", 92, Color.FromArgb(16, 185, 129), out _ram, out _ramBar);
            AddMeter(right, "Disco do sistema", 138, Color.FromArgb(245, 158, 11), out _disk, out _diskBar);
            _sync = new Label { Text = "Inventario automatico ativo", Font = new Font("Segoe UI", 8f), ForeColor = Ui.Muted, Location = new Point(18, 192), Size = new Size(170, 30) };
            Button syncNow = Ui.Flat("Sincronizar", Color.White, Color.FromArgb(51, 65, 85), 196, 188, 96, 30, true);
            syncNow.Click += delegate
            {
                _sync.Text = "Sincronizando...";
                _engine.RequestInventory();
            };
            right.Controls.Add(_sync);
            right.Controls.Add(syncNow);
            _statusLine = new Label { Font = new Font("Segoe UI", 8f), ForeColor = Ui.Muted, Location = new Point(18, 228), Size = new Size(280, 28) };
            right.Controls.Add(_statusLine);

            Button support = Ui.Flat("Pedir suporte a TI", Ui.Brand, Color.White, 20, 356, 340, 42, true);
            support.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
            support.Click += delegate { OpenSupport(); };
            Button privacy = Ui.Flat("Privacidade", Color.White, Color.FromArgb(51, 65, 85), 374, 356, 150, 42, true);
            privacy.Click += delegate { ShowPrivacy(); };
            Button hide = Ui.Flat("Minimizar", Color.White, Ui.Muted, 534, 356, 150, 42, false);
            hide.Click += delegate { Hide(); };

            Controls.AddRange(new Control[] { header, left, right, support, privacy, hide });

            System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
            timer.Interval = 2000;
            timer.Tick += delegate { RefreshMeters(); };
            timer.Start();
            RefreshMeters();
        }

        private static void AddMeter(Panel parent, string title, int y, Color color, out Label value, out Panel bar)
        {
            parent.Controls.Add(Ui.Text(title, 9f, true, Ui.Ink, 18, y));
            value = new Label { Font = new Font("Segoe UI", 9f, FontStyle.Bold), ForeColor = color, Location = new Point(150, y), Size = new Size(142, 18), TextAlign = ContentAlignment.MiddleRight };
            Panel back = new Panel { Location = new Point(18, y + 22), Size = new Size(274, 10), BackColor = Color.FromArgb(226, 232, 240) };
            bar = new Panel { Location = new Point(0, 0), Size = new Size(4, 10), BackColor = color };
            back.Controls.Add(bar);
            parent.Controls.Add(value);
            parent.Controls.Add(back);
        }

        private void RefreshInfo()
        {
            string ip, mac;
            MachineIdentity.PrimaryNetwork(out ip, out mac);
            _info.Text = string.Format(
                "Patrimonio:   {0}\r\nComputador:   {1}\r\nUsuario:        {2}\r\nIPv4:              {3}\r\nSerie:             {4}\r\nEmpresa:        {5}",
                string.IsNullOrEmpty(_config.patrimony) ? "-" : _config.patrimony,
                Environment.MachineName,
                Environment.UserName,
                string.IsNullOrEmpty(ip) ? "-" : ip,
                MachineIdentity.SerialNumber,
                string.IsNullOrEmpty(_engine.TenantId) ? "nao conectado" : _engine.TenantId);
        }

        private void RefreshMeters()
        {
            int cpu = Telemetry.CpuPercent();
            int ramPct, diskPct;
            double ramUsed, ramTotal, diskFree, diskTotal;
            Telemetry.Memory(out ramPct, out ramUsed, out ramTotal);
            Telemetry.SystemDrive(out diskPct, out diskFree, out diskTotal);
            _cpu.Text = cpu + "%";
            _cpuBar.Width = Math.Max(4, 274 * cpu / 100);
            _ram.Text = string.Format(CultureInfo.CurrentCulture, "{0}% ({1}/{2} GB)", ramPct, ramUsed, ramTotal);
            _ramBar.Width = Math.Max(4, 274 * ramPct / 100);
            _disk.Text = string.Format(CultureInfo.CurrentCulture, "{0}% ({1} GB livres)", diskPct, diskFree);
            _diskBar.Width = Math.Max(4, 274 * diskPct / 100);
            _statusLine.Text = _engine.StatusText;
        }

        private void BuildTray()
        {
            ContextMenu menu = new ContextMenu();
            menu.MenuItems.Add("Abrir Nexus ITAM", delegate { ShowWindow(); });
            menu.MenuItems.Add("Copiar ID de acesso (" + _engine.AccessId + ")", delegate { try { Clipboard.SetText(_engine.AccessId); } catch { } });
            menu.MenuItems.Add("-");
            menu.MenuItems.Add("Pedir suporte a TI...", delegate { OpenSupport(); });
            menu.MenuItems.Add("Sincronizar inventario", delegate { _engine.RequestInventory(); });
            _endSessionItem = new MenuItem("Encerrar acesso remoto", delegate { _engine.EndSessionByUser(); });
            _endSessionItem.Visible = false;
            menu.MenuItems.Add(_endSessionItem);
            menu.MenuItems.Add("Privacidade", delegate { ShowPrivacy(); });
            // Instalado, o servico segue rodando; a bandeja so sai no modo portatil.
            if (!AgentEngine.ServiceRunning())
            {
                menu.MenuItems.Add("-");
                menu.MenuItems.Add("Sair", delegate
                {
                    _tray.Visible = false;
                    _engine.Stop();
                    Application.Exit();
                });
            }

            _tray = new NotifyIcon();
            _tray.Icon = Icon;
            _tray.Text = "Nexus ITAM - ID " + _engine.AccessId;
            _tray.ContextMenu = menu;
            _tray.Visible = true;
            _tray.DoubleClick += delegate { ShowWindow(); };
        }

        private void ShowWindow()
        {
            RefreshInfo();
            Show();
            WindowState = FormWindowState.Normal;
            Activate();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                Hide();
                return;
            }
            if (_tray != null) _tray.Visible = false;
            base.OnFormClosing(e);
        }

        private void OpenSupport()
        {
            if (!_engine.Enrolled)
            {
                MessageBox.Show(this, "Este computador ainda nao esta conectado a empresa.", "Nexus ITAM", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            using (SupportDialog dlg = new SupportDialog())
            {
                if (dlg.ShowDialog() != DialogResult.OK) return;
                _engine.RequestSupport(dlg.Issue, dlg.Priority);
                _tray.ShowBalloonTip(4000, "Nexus ITAM", "Pedido enviado. A TI foi avisada e pode pedir acesso a sua tela.", ToolTipIcon.Info);
            }
        }

        private void ShowPrivacy()
        {
            MessageBox.Show(this, Ui.PrivacyText, "Nexus ITAM - Privacidade", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        private void StartSetup()
        {
            using (SetupDialog dlg = new SetupDialog(_config))
            {
                if (dlg.ShowDialog(this) != DialogResult.OK) return;
                AgentConfig cfg = AgentConfig.Load(null);
                cfg.tenantId = dlg.TenantId;
                cfg.agentToken = dlg.Token;
                // Arquivo temporario no perfil do usuario: o token nao vai para a linha de comando.
                string temp = Path.Combine(AgentPaths.UserDir, "setup-" + Guid.NewGuid().ToString("N") + ".json");
                if (!cfg.SaveTo(temp))
                {
                    MessageBox.Show(this, "Nao foi possivel preparar a instalacao.", "Nexus ITAM", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo(Application.ExecutablePath, "--install --no-tray --quiet --config=\"" + temp + "\"");
                    psi.UseShellExecute = true;
                    psi.Verb = "runas";
                    using (Process p = Process.Start(psi))
                    {
                        p.WaitForExit();
                        if (p.ExitCode == 0)
                        {
                            MessageBox.Show(this, "Computador conectado. O agente instalado ja esta em execucao.", "Nexus ITAM", MessageBoxButtons.OK, MessageBoxIcon.Information);
                            _tray.Visible = false;
                            _engine.Stop();
                            // Esta bandeja (portatil) da lugar a instalada, sem privilegios elevados.
                            Program.ReleaseTrayLock();
                            try { Process.Start(AgentPaths.InstalledExe, "--tray"); } catch { }
                            Application.Exit();
                        }
                        else
                        {
                            MessageBox.Show(this, "A instalacao falhou (codigo " + p.ExitCode + "). Detalhes em " +
                                Path.Combine(AgentPaths.MachineDir, "logs", "install.log"), "Nexus ITAM", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        }
                    }
                }
                catch (Win32Exception)
                {
                    MessageBox.Show(this, "A instalacao precisa de permissao de administrador.", "Nexus ITAM", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
                finally
                {
                    try { File.Delete(temp); } catch { }
                }
            }
        }

        // ---- IAgentUi -------------------------------------------------------

        private void OnUi(MethodInvoker action)
        {
            if (IsDisposed) return;
            try { BeginInvoke(action); } catch { }
        }

        public void SetStatus(string text, Color color)
        {
            OnUi(delegate
            {
                _badge.Text = text;
                _badge.ForeColor = color;
                _connect.Visible = !_engine.Enrolled;
            });
        }

        public void SetSyncText(string text)
        {
            OnUi(delegate { _sync.Text = text; });
        }

        public bool AskConsent(string operatorName)
        {
            bool accepted = false;
            try
            {
                Invoke((MethodInvoker)delegate
                {
                    using (ConsentDialog dlg = new ConsentDialog(operatorName)) accepted = dlg.ShowDialog() == DialogResult.OK;
                });
            }
            catch { }
            return accepted;
        }

        public void ShowSession(bool active, string operatorName)
        {
            OnUi(delegate
            {
                _tray.Icon = MakeIcon(active);
                _endSessionItem.Visible = active;
                if (active)
                {
                    if (_indicator == null || _indicator.IsDisposed) _indicator = new SessionIndicator(delegate { _engine.EndSessionByUser(); });
                    _indicator.SetOperator(operatorName);
                    _indicator.Show();
                    _tray.ShowBalloonTip(4000, "Nexus ITAM - Acesso remoto", operatorName + " esta conectado a este computador.", ToolTipIcon.Info);
                }
                else if (_indicator != null && !_indicator.IsDisposed)
                {
                    _indicator.Hide();
                }
            });
        }

        public void ShowMessage(string title, string text)
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                MessageBox.Show(text, title, MessageBoxButtons.OK, MessageBoxIcon.Information, MessageBoxDefaultButton.Button1, MessageBoxOptions.DefaultDesktopOnly);
            });
        }

        public void LockScreen()
        {
            NativeMethods.LockWorkStation();
        }
    }

    // -------------------------------------------------------------------------
    // Entrada
    // -------------------------------------------------------------------------
    internal static class Program
    {
        private static Mutex _trayLock;

        public static void ReleaseTrayLock()
        {
            if (_trayLock == null) return;
            try { _trayLock.ReleaseMutex(); } catch { }
            _trayLock.Close();
            _trayLock = null;
        }

        private static string Arg(string[] args, string name)
        {
            foreach (string a in args)
            {
                if (a.StartsWith(name + "=", StringComparison.OrdinalIgnoreCase)) return a.Substring(name.Length + 1).Trim('"', ' ');
            }
            return null;
        }

        private static bool Has(string[] args, string name)
        {
            foreach (string a in args)
            {
                if (string.Equals(a, name, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        private static void Override(string[] args, AgentConfig cfg)
        {
            string v;
            if ((v = Arg(args, "--tenantId")) != null) cfg.tenantId = v;
            if ((v = Arg(args, "--agentToken")) != null) cfg.agentToken = v;
            if ((v = Arg(args, "--projectId")) != null) cfg.projectId = v;
            if ((v = Arg(args, "--apiKey")) != null) cfg.apiKey = v;
            if ((v = Arg(args, "--patrimony")) != null) cfg.patrimony = v;
            if ((v = Arg(args, "--firestoreBase")) != null) cfg.firestoreBase = v;
            if ((v = Arg(args, "--authBase")) != null) cfg.authBase = v;
            if ((v = Arg(args, "--tokenBase")) != null) cfg.tokenBase = v;
        }

        [STAThread]
        private static int Main(string[] args)
        {
            args = args ?? new string[0];
            Http.Configure();
            string dataDir = Arg(args, "--dataDir");
            if (!string.IsNullOrEmpty(dataDir)) AgentPaths.DataDir = Path.GetFullPath(dataDir);

            if (Has(args, "--service"))
            {
                AgentLog.Init("service");
                if (!Environment.UserInteractive)
                {
                    ServiceBase.Run(new AgentService());
                    return 0;
                }
                // Diagnostico em primeiro plano (sem SCM).
                AgentPaths.Resolve();
                AgentConfig cfg = AgentConfig.Load(null);
                Override(args, cfg);
                AgentEngine engine = new AgentEngine(true, cfg, null);
                if (Has(args, "--once")) return engine.RunOnce(Has(args, "--inventory"));
                engine.Start();
                Thread.Sleep(Timeout.Infinite);
                return 0;
            }

            if (Has(args, "--install") || Has(args, "--enroll"))
            {
                AgentLog.Init("install");
                if (Has(args, "--install")) AgentPaths.DataDir = AgentPaths.MachineDir;
                AgentConfig cfg = AgentConfig.Load(Arg(args, "--config"));
                Override(args, cfg);
                string temp = Arg(args, "--config");
                string error;
                int code = Has(args, "--install") ? Installer.Install(cfg, !Has(args, "--no-tray"), out error) : Installer.Enroll(cfg, out error);
                if (!string.IsNullOrEmpty(temp)) { try { File.Delete(temp); } catch { } }
                if (code != 0) AgentLog.Write("Falha ({0}): {1}", code, error);
                if (code != 0 && Environment.UserInteractive && !Has(args, "--quiet"))
                {
                    MessageBox.Show(error ?? ("Falha " + code), "Nexus ITAM", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                return code;
            }

            if (Has(args, "--uninstall"))
            {
                AgentLog.Init("install");
                return Installer.Uninstall(AgentConfig.Load(null));
            }

            // Bandeja: uma por sessao de usuario.
            AgentLog.Init("tray-" + Environment.UserName);
            AgentPaths.Resolve();
            try { NativeMethods.SetProcessDPIAware(); } catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            bool createdNew;
            _trayLock = new Mutex(true, "Local\\NexusITAMAgentTray", out createdNew);
            if (!createdNew) return 0;
            AgentConfig trayCfg = AgentConfig.Load(null);
            Override(args, trayCfg);
            bool hidden = Has(args, "--tray") || Has(args, "--silent");
            Application.Run(new MainAgentForm(trayCfg, hidden));
            ReleaseTrayLock();
            return 0;
        }
    }
}
