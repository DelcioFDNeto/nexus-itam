// =============================================================================
// Nexus ITAM - Agente Nativo Windows (RMM, Telemetria, Inventario e Acesso Remoto)
// Compilavel com .NET Framework 4.x nativo do Windows (csc.exe - C# 5)
// =============================================================================

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace NexusITAM
{
    internal static class NativeMethods
    {
        [DllImport("user32.dll")]
        public static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll")]
        public static extern bool GetCursorPos(out POINT lpPoint);

        [DllImport("user32.dll")]
        public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);

        [DllImport("user32.dll")]
        public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        [DllImport("user32.dll")]
        public static extern bool LockWorkStation();

        [DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GlobalMemoryStatusEx([In, Out] MEMORYSTATUSEX lpBuffer);

        public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        public const uint MOUSEEVENTF_LEFTUP = 0x0004;
        public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
        public const uint MOUSEEVENTF_WHEEL = 0x0800;
        public const uint KEYEVENTF_KEYUP = 0x0002;

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT
        {
            public int X;
            public int Y;
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
                this.dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX));
            }
        }
    }

    public class AgentConfig
    {
        public string projectId = "itam-nexus";
        public string tenantId = "";
        public string agentToken = "";
        public string patrimony = "";
        public string serverUrl = "https://itam-nexus.web.app";
        public bool unattendedEnabled = true;

        public static string DefaultDir
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "NexusITAM"); }
        }

        public static string DefaultPath
        {
            get { return Path.Combine(DefaultDir, "config.json"); }
        }

        public static AgentConfig Load()
        {
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            string[] candidates = new string[]
            {
                DefaultPath,
                Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "config.json"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NexusITAM", "config.json")
            };

            foreach (string path in candidates)
            {
                try
                {
                    if (File.Exists(path))
                    {
                        string raw = File.ReadAllText(path, Encoding.UTF8);
                        AgentConfig cfg = serializer.Deserialize<AgentConfig>(raw);
                        if (cfg != null)
                        {
                            if (string.IsNullOrEmpty(cfg.projectId)) cfg.projectId = "itam-nexus";
                            if (string.IsNullOrEmpty(cfg.serverUrl)) cfg.serverUrl = "https://itam-nexus.web.app";
                            return cfg;
                        }
                    }
                }
                catch { }
            }
            return new AgentConfig();
        }

        public void Save()
        {
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            string json = serializer.Serialize(this);
            try
            {
                if (!Directory.Exists(DefaultDir)) Directory.CreateDirectory(DefaultDir);
                File.WriteAllText(DefaultPath, json, Encoding.UTF8);
                return;
            }
            catch { }

            try
            {
                string localDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NexusITAM");
                if (!Directory.Exists(localDir)) Directory.CreateDirectory(localDir);
                File.WriteAllText(Path.Combine(localDir, "config.json"), json, Encoding.UTF8);
            }
            catch { }
        }
    }

    public static class MachineIdentity
    {
        private static string _deviceKey;
        private static string _accessId;
        private static string _serialNumber;
        private static string _machineGuid;
        private static string _osCaption;

        public static string GetMachineGuid()
        {
            if (_machineGuid != null) return _machineGuid;
            try
            {
                using (RegistryKey rk = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
                using (RegistryKey sub = rk.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography"))
                {
                    if (sub != null)
                    {
                        object v = sub.GetValue("MachineGuid");
                        if (v != null) _machineGuid = v.ToString().Trim();
                    }
                }
            }
            catch { }
            if (string.IsNullOrEmpty(_machineGuid)) _machineGuid = Environment.MachineName;
            return _machineGuid;
        }

        public static string GetSerialNumber()
        {
            if (_serialNumber != null) return _serialNumber;
            try
            {
                string outText = RunQuickPowerShell("(Get-CimInstance Win32_BIOS -ErrorAction SilentlyContinue).SerialNumber");
                if (!string.IsNullOrEmpty(outText)) _serialNumber = outText.Trim();
            }
            catch { }
            if (string.IsNullOrEmpty(_serialNumber)) _serialNumber = "SN-" + Environment.MachineName;
            return _serialNumber;
        }

        public static string GetOsCaption()
        {
            if (_osCaption != null) return _osCaption;
            try
            {
                using (RegistryKey rk = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
                using (RegistryKey sub = rk.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion"))
                {
                    if (sub != null)
                    {
                        object prod = sub.GetValue("ProductName");
                        object build = sub.GetValue("CurrentBuild");
                        if (prod != null)
                        {
                            _osCaption = prod.ToString() + (build != null ? " (Build " + build.ToString() + ")" : "");
                        }
                    }
                }
            }
            catch { }
            if (string.IsNullOrEmpty(_osCaption)) _osCaption = Environment.OSVersion.VersionString;
            return _osCaption;
        }

        public static string GetDeviceKey()
        {
            if (_deviceKey != null) return _deviceKey;
            string raw = string.Format("{0}|{1}|{2}", GetSerialNumber(), GetMachineGuid(), Environment.MachineName).ToUpperInvariant();
            using (SHA256 sha = SHA256.Create())
            {
                byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes(raw));
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < 12; i++)
                {
                    sb.Append(hash[i].ToString("x2"));
                }
                _deviceKey = sb.ToString();
            }
            return _deviceKey;
        }

        public static string GetAccessId()
        {
            if (_accessId != null) return _accessId;
            string key = GetDeviceKey();
            using (SHA256 sha = SHA256.Create())
            {
                byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes("NEXUS-ID-" + key));
                uint val = BitConverter.ToUInt32(hash, 0) % 900000000U + 100000000U;
                string s = val.ToString("000000000", CultureInfo.InvariantCulture);
                _accessId = string.Format("{0} {1} {2}", s.Substring(0, 3), s.Substring(3, 3), s.Substring(6, 3));
            }
            return _accessId;
        }

        public static string GetLocalIPv4()
        {
            try
            {
                foreach (NetworkInterface ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up) continue;
                    if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                    IPInterfaceProperties props = ni.GetIPProperties();
                    if (props.GatewayAddresses == null || props.GatewayAddresses.Count == 0) continue;
                    foreach (UnicastIPAddressInformation ip in props.UnicastAddresses)
                    {
                        if (ip.Address.AddressFamily == AddressFamily.InterNetwork)
                        {
                            return ip.Address.ToString();
                        }
                    }
                }
                foreach (IPAddress ip in Dns.GetHostAddresses(Dns.GetHostName()))
                {
                    if (ip.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(ip))
                    {
                        return ip.ToString();
                    }
                }
            }
            catch { }
            return "127.0.0.1";
        }

        public static string GetMacAddress()
        {
            try
            {
                foreach (NetworkInterface ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up) continue;
                    if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                    byte[] bytes = ni.GetPhysicalAddress().GetAddressBytes();
                    if (bytes != null && bytes.Length == 6)
                    {
                        return string.Format("{0:X2}:{1:X2}:{2:X2}:{3:X2}:{4:X2}:{5:X2}",
                            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
                    }
                }
            }
            catch { }
            return "00:00:00:00:00:00";
        }

        public static string RunQuickPowerShell(string command)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("powershell.exe",
                    "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"" + command.Replace("\"", "\\\"") + "\"");
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                psi.StandardOutputEncoding = Encoding.UTF8;
                using (Process p = Process.Start(psi))
                {
                    string output = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(8000);
                    return output != null ? output.Trim() : "";
                }
            }
            catch
            {
                return "";
            }
        }
    }

    public static class FirestoreWire
    {
        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };

        public static Dictionary<string, object> ToValue(object val)
        {
            Dictionary<string, object> res = new Dictionary<string, object>();
            if (val == null)
            {
                res["nullValue"] = null;
                return res;
            }
            if (val is bool)
            {
                res["booleanValue"] = (bool)val;
                return res;
            }
            if (val is int || val is long || val is uint)
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
                DateTime dt = ((DateTime)val).ToUniversalTime();
                res["timestampValue"] = dt.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
                return res;
            }
            if (val is string)
            {
                res["stringValue"] = (string)val;
                return res;
            }
            IDictionary<string, object> dict = val as IDictionary<string, object>;
            if (dict != null)
            {
                Dictionary<string, object> fields = new Dictionary<string, object>();
                foreach (KeyValuePair<string, object> kv in dict)
                {
                    fields[kv.Key] = ToValue(kv.Value);
                }
                Dictionary<string, object> mapWrap = new Dictionary<string, object>();
                mapWrap["fields"] = fields;
                res["mapValue"] = mapWrap;
                return res;
            }
            System.Collections.IEnumerable list = val as System.Collections.IEnumerable;
            if (list != null)
            {
                List<object> values = new List<object>();
                foreach (object item in list)
                {
                    values.Add(ToValue(item));
                }
                Dictionary<string, object> arrWrap = new Dictionary<string, object>();
                arrWrap["values"] = values;
                res["arrayValue"] = arrWrap;
                return res;
            }
            res["stringValue"] = val.ToString();
            return res;
        }

        public static object FromValue(Dictionary<string, object> wire)
        {
            if (wire == null) return null;
            if (wire.ContainsKey("nullValue")) return null;
            if (wire.ContainsKey("booleanValue")) return Convert.ToBoolean(wire["booleanValue"]);
            if (wire.ContainsKey("integerValue"))
            {
                long l;
                if (long.TryParse( Convert.ToString(wire["integerValue"], CultureInfo.InvariantCulture), out l)) return l;
                return 0L;
            }
            if (wire.ContainsKey("doubleValue")) return Convert.ToDouble(wire["doubleValue"], CultureInfo.InvariantCulture);
            if (wire.ContainsKey("timestampValue")) return Convert.ToString(wire["timestampValue"]);
            if (wire.ContainsKey("stringValue")) return Convert.ToString(wire["stringValue"]);
            if (wire.ContainsKey("mapValue"))
            {
                Dictionary<string, object> mv = wire["mapValue"] as Dictionary<string, object>;
                Dictionary<string, object> result = new Dictionary<string, object>();
                if (mv != null && mv.ContainsKey("fields"))
                {
                    Dictionary<string, object> fields = mv["fields"] as Dictionary<string, object>;
                    if (fields != null)
                    {
                        foreach (KeyValuePair<string, object> kv in fields)
                        {
                            result[kv.Key] = FromValue(kv.Value as Dictionary<string, object>);
                        }
                    }
                }
                return result;
            }
            if (wire.ContainsKey("arrayValue"))
            {
                Dictionary<string, object> av = wire["arrayValue"] as Dictionary<string, object>;
                List<object> result = new List<object>();
                if (av != null && av.ContainsKey("values"))
                {
                    System.Collections.IEnumerable vals = av["values"] as System.Collections.IEnumerable;
                    if (vals != null)
                    {
                        foreach (object item in vals)
                        {
                            result.Add(FromValue(item as Dictionary<string, object>));
                        }
                    }
                }
                return result;
            }
            return null;
        }

        public static string BuildDocumentJson(Dictionary<string, object> docFields)
        {
            Dictionary<string, object> fields = new Dictionary<string, object>();
            foreach (KeyValuePair<string, object> kv in docFields)
            {
                fields[kv.Key] = ToValue(kv.Value);
            }
            Dictionary<string, object> root = new Dictionary<string, object>();
            root["fields"] = fields;
            return Serializer.Serialize(root);
        }

        public static Dictionary<string, object> ParseDocumentJson(string json)
        {
            if (string.IsNullOrEmpty(json)) return null;
            Dictionary<string, object> raw = Serializer.Deserialize<Dictionary<string, object>>(json);
            if (raw == null || !raw.ContainsKey("fields")) return null;
            Dictionary<string, object> fields = raw["fields"] as Dictionary<string, object>;
            if (fields == null) return null;
            Dictionary<string, object> result = new Dictionary<string, object>();
            foreach (KeyValuePair<string, object> kv in fields)
            {
                result[kv.Key] = FromValue(kv.Value as Dictionary<string, object>);
            }
            return result;
        }

        public static bool PatchDocument(string projectId, string collection, string docId, Dictionary<string, object> docFields, out string errorMsg)
        {
            errorMsg = null;
            try
            {
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | SecurityProtocolType.Tls;
                string url = string.Format("https://firestore.googleapis.com/v1/projects/{0}/databases/(default)/documents/{1}/{2}",
                    Uri.EscapeDataString(projectId),
                    Uri.EscapeDataString(collection),
                    Uri.EscapeDataString(docId));

                string body = BuildDocumentJson(docFields);
                byte[] bytes = Encoding.UTF8.GetBytes(body);

                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                req.Method = "PATCH";
                req.ContentType = "application/json; charset=utf-8";
                req.ContentLength = bytes.Length;
                req.Timeout = 10000;

                using (Stream st = req.GetRequestStream())
                {
                    st.Write(bytes, 0, bytes.Length);
                }

                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    return (int)resp.StatusCode >= 200 && (int)resp.StatusCode < 300;
                }
            }
            catch (WebException wex)
            {
                try
                {
                    if (wex.Response != null)
                    {
                        using (StreamReader sr = new StreamReader(wex.Response.GetResponseStream()))
                        {
                            errorMsg = sr.ReadToEnd();
                        }
                    }
                    else
                    {
                        errorMsg = wex.Message;
                    }
                }
                catch
                {
                    errorMsg = wex.Message;
                }
                return false;
            }
            catch (Exception ex)
            {
                errorMsg = ex.Message;
                return false;
            }
        }

        public static Dictionary<string, object> GetDocument(string projectId, string collection, string docId)
        {
            try
            {
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | SecurityProtocolType.Tls;
                string url = string.Format("https://firestore.googleapis.com/v1/projects/{0}/databases/(default)/documents/{1}/{2}",
                    Uri.EscapeDataString(projectId),
                    Uri.EscapeDataString(collection),
                    Uri.EscapeDataString(docId));

                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                req.Method = "GET";
                req.Timeout = 7000;

                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                using (StreamReader sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                {
                    string json = sr.ReadToEnd();
                    return ParseDocumentJson(json);
                }
            }
            catch
            {
                return null;
            }
        }
    }

    public static class TelemetryCollector
    {
        private static TimeSpan _lastCpuTotal = TimeSpan.Zero;
        private static DateTime _lastCpuSampleAt = DateTime.MinValue;
        private static int _cachedCpuPercent = 8;

        public static int SampleCpuPercent()
        {
            try
            {
                TimeSpan total = TimeSpan.Zero;
                Process[] procs = Process.GetProcesses();
                foreach (Process p in procs)
                {
                    try
                    {
                        if (p.Id == 0) continue;
                        total += p.TotalProcessorTime;
                    }
                    catch { }
                    finally
                    {
                        p.Dispose();
                    }
                }

                DateTime now = DateTime.UtcNow;
                if (_lastCpuSampleAt != DateTime.MinValue)
                {
                    double elapsedMs = (now - _lastCpuSampleAt).TotalMilliseconds;
                    if (elapsedMs > 250)
                    {
                        double cpuMs = (total - _lastCpuTotal).TotalMilliseconds;
                        double usage = (cpuMs / (elapsedMs * Environment.ProcessorCount)) * 100.0;
                        if (usage >= 0 && usage <= 100)
                        {
                            _cachedCpuPercent = (int)Math.Round(usage);
                        }
                    }
                }
                _lastCpuTotal = total;
                _lastCpuSampleAt = now;
            }
            catch { }
            return Math.Max(1, Math.Min(100, _cachedCpuPercent));
        }

        public static void SampleMemory(out int ramPercent, out double usedGb, out double totalGb)
        {
            ramPercent = 40;
            usedGb = 3.2;
            totalGb = 8.0;
            try
            {
                NativeMethods.MEMORYSTATUSEX mem = new NativeMethods.MEMORYSTATUSEX();
                if (NativeMethods.GlobalMemoryStatusEx(mem) && mem.ullTotalPhys > 0)
                {
                    ramPercent = (int)mem.dwMemoryLoad;
                    totalGb = Math.Round(mem.ullTotalPhys / (1024.0 * 1024.0 * 1024.0), 1);
                    ulong used = mem.ullTotalPhys - mem.ullAvailPhys;
                    usedGb = Math.Round(used / (1024.0 * 1024.0 * 1024.0), 1);
                }
            }
            catch { }
        }

        public static void SampleSystemDrive(out int diskPercent, out double freeGb, out double totalGb)
        {
            diskPercent = 35;
            freeGb = 120;
            totalGb = 256;
            try
            {
                string root = Path.GetPathRoot(Environment.SystemDirectory);
                DriveInfo di = new DriveInfo(root);
                if (di.IsReady && di.TotalSize > 0)
                {
                    totalGb = Math.Round(di.TotalSize / (1024.0 * 1024.0 * 1024.0), 1);
                    freeGb = Math.Round(di.AvailableFreeSpace / (1024.0 * 1024.0 * 1024.0), 1);
                    double used = di.TotalSize - di.AvailableFreeSpace;
                    diskPercent = (int)Math.Round((used / di.TotalSize) * 100.0);
                }
            }
            catch { }
        }

        public static List<object> GetTopProcesses(int maxCount)
        {
            List<Dictionary<string, object>> list = new List<Dictionary<string, object>>();
            try
            {
                Process[] procs = Process.GetProcesses();
                foreach (Process p in procs)
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
                        item["responding"] = p.Responding;
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
                    long ma = Convert.ToInt64(a["memoryMb"]);
                    long mb = Convert.ToInt64(b["memoryMb"]);
                    return mb.CompareTo(ma);
                });
            }
            catch { }

            List<object> top = new List<object>();
            for (int i = 0; i < list.Count && i < maxCount; i++)
            {
                top.Add(list[i]);
            }
            return top;
        }
    }

    public static class RemoteDesktopEngine
    {
        private static int _frameSeq = 0;

        public static Dictionary<string, object> CaptureCompressedFrame(string quality)
        {
            try
            {
                Rectangle bounds = Screen.PrimaryScreen.Bounds;
                int targetWidth = 1152;
                long jpegQuality = 50L;

                if (string.Equals(quality, "high", StringComparison.OrdinalIgnoreCase))
                {
                    targetWidth = 1366;
                    jpegQuality = 62L;
                }
                else if (string.Equals(quality, "low", StringComparison.OrdinalIgnoreCase))
                {
                    targetWidth = 860;
                    jpegQuality = 36L;
                }

                if (targetWidth > bounds.Width) targetWidth = bounds.Width;
                int targetHeight = (int)Math.Round(bounds.Height * (targetWidth / (double)bounds.Width));

                using (Bitmap fullBmp = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb))
                {
                    using (Graphics g = Graphics.FromImage(fullBmp))
                    {
                        g.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);

                        // Desenha indicador do cursor na imagem para o tecnico enxergar a posicao exata
                        NativeMethods.POINT pt;
                        if (NativeMethods.GetCursorPos(out pt))
                        {
                            int cx = pt.X - bounds.Left;
                            int cy = pt.Y - bounds.Top;
                            using (Pen outline = new Pen(Color.FromArgb(220, 15, 23, 42), 2f))
                            using (SolidBrush fill = new SolidBrush(Color.FromArgb(210, 56, 189, 248)))
                            {
                                Point[] arrow = new Point[]
                                {
                                    new Point(cx, cy),
                                    new Point(cx, cy + 16),
                                    new Point(cx + 5, cy + 12),
                                    new Point(cx + 11, cy + 11)
                                };
                                g.SmoothingMode = SmoothingMode.AntiAlias;
                                g.FillPolygon(fill, arrow);
                                g.DrawPolygon(outline, arrow);
                            }
                        }
                    }

                    using (Bitmap scaled = new Bitmap(targetWidth, targetHeight, PixelFormat.Format24bppRgb))
                    {
                        using (Graphics gs = Graphics.FromImage(scaled))
                        {
                            gs.InterpolationMode = InterpolationMode.Bilinear;
                            gs.CompositingQuality = CompositingQuality.HighSpeed;
                            gs.SmoothingMode = SmoothingMode.HighSpeed;
                            gs.DrawImage(fullBmp, 0, 0, targetWidth, targetHeight);
                        }

                        using (MemoryStream ms = new MemoryStream())
                        {
                            ImageCodecInfo jpegCodec = GetJpegCodec();
                            if (jpegCodec != null)
                            {
                                EncoderParameters ep = new EncoderParameters(1);
                                ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, jpegQuality);
                                scaled.Save(ms, jpegCodec, ep);
                            }
                            else
                            {
                                scaled.Save(ms, ImageFormat.Jpeg);
                            }

                            _frameSeq++;
                            Dictionary<string, object> frame = new Dictionary<string, object>();
                            frame["data"] = Convert.ToBase64String(ms.ToArray());
                            frame["width"] = targetWidth;
                            frame["height"] = targetHeight;
                            frame["screenWidth"] = bounds.Width;
                            frame["screenHeight"] = bounds.Height;
                            frame["seq"] = _frameSeq;
                            frame["capturedAt"] = DateTime.UtcNow.ToString("o");
                            return frame;
                        }
                    }
                }
            }
            catch
            {
                return null;
            }
        }

        private static ImageCodecInfo GetJpegCodec()
        {
            ImageCodecInfo[] codecs = ImageCodecInfo.GetImageEncoders();
            foreach (ImageCodecInfo ici in codecs)
            {
                if (ici.FormatID == ImageFormat.Jpeg.Guid) return ici;
            }
            return null;
        }

        public static void ExecuteInputEvent(Dictionary<string, object> ev)
        {
            if (ev == null || !ev.ContainsKey("type")) return;
            string type = Convert.ToString(ev["type"]);
            Rectangle bounds = Screen.PrimaryScreen.Bounds;

            double nx = ev.ContainsKey("x") ? Convert.ToDouble(ev["x"], CultureInfo.InvariantCulture) : 0.5;
            double ny = ev.ContainsKey("y") ? Convert.ToDouble(ev["y"], CultureInfo.InvariantCulture) : 0.5;
            int px = bounds.Left + (int)Math.Round(Math.Max(0.0, Math.Min(1.0, nx)) * bounds.Width);
            int py = bounds.Top + (int)Math.Round(Math.Max(0.0, Math.Min(1.0, ny)) * bounds.Height);

            try
            {
                if (type == "mousemove")
                {
                    NativeMethods.SetCursorPos(px, py);
                }
                else if (type == "click")
                {
                    NativeMethods.SetCursorPos(px, py);
                    Thread.Sleep(10);
                    NativeMethods.mouse_event(NativeMethods.MOUSEEVENTF_LEFTDOWN | NativeMethods.MOUSEEVENTF_LEFTUP, px, py, 0, UIntPtr.Zero);
                }
                else if (type == "dblclick")
                {
                    NativeMethods.SetCursorPos(px, py);
                    Thread.Sleep(10);
                    NativeMethods.mouse_event(NativeMethods.MOUSEEVENTF_LEFTDOWN | NativeMethods.MOUSEEVENTF_LEFTUP, px, py, 0, UIntPtr.Zero);
                    Thread.Sleep(45);
                    NativeMethods.mouse_event(NativeMethods.MOUSEEVENTF_LEFTDOWN | NativeMethods.MOUSEEVENTF_LEFTUP, px, py, 0, UIntPtr.Zero);
                }
                else if (type == "rightclick")
                {
                    NativeMethods.SetCursorPos(px, py);
                    Thread.Sleep(10);
                    NativeMethods.mouse_event(NativeMethods.MOUSEEVENTF_RIGHTDOWN | NativeMethods.MOUSEEVENTF_RIGHTUP, px, py, 0, UIntPtr.Zero);
                }
                else if (type == "mousedown")
                {
                    NativeMethods.SetCursorPos(px, py);
                    NativeMethods.mouse_event(NativeMethods.MOUSEEVENTF_LEFTDOWN, px, py, 0, UIntPtr.Zero);
                }
                else if (type == "mouseup")
                {
                    NativeMethods.SetCursorPos(px, py);
                    NativeMethods.mouse_event(NativeMethods.MOUSEEVENTF_LEFTUP, px, py, 0, UIntPtr.Zero);
                }
                else if (type == "wheel")
                {
                    int delta = ev.ContainsKey("deltaY") ? Convert.ToInt32(ev["deltaY"]) : -120;
                    NativeMethods.SetCursorPos(px, py);
                    NativeMethods.mouse_event(NativeMethods.MOUSEEVENTF_WHEEL, px, py, delta, UIntPtr.Zero);
                }
                else if (type == "key")
                {
                    string key = ev.ContainsKey("key") ? Convert.ToString(ev["key"]) : "";
                    SendSpecialOrCharKey(key);
                }
                else if (type == "text")
                {
                    string text = ev.ContainsKey("text") ? Convert.ToString(ev["text"]) : "";
                    if (!string.IsNullOrEmpty(text))
                    {
                        SendKeys.SendWait(EscapeSendKeys(text));
                    }
                }
            }
            catch { }
        }

        private static void SendSpecialOrCharKey(string key)
        {
            if (string.IsNullOrEmpty(key)) return;
            switch (key)
            {
                case "Enter": SendKeys.SendWait("{ENTER}"); break;
                case "Backspace": SendKeys.SendWait("{BACKSPACE}"); break;
                case "Tab": SendKeys.SendWait("{TAB}"); break;
                case "Escape": SendKeys.SendWait("{ESC}"); break;
                case "Delete": SendKeys.SendWait("{DEL}"); break;
                case "ArrowUp": SendKeys.SendWait("{UP}"); break;
                case "ArrowDown": SendKeys.SendWait("{DOWN}"); break;
                case "ArrowLeft": SendKeys.SendWait("{LEFT}"); break;
                case "ArrowRight": SendKeys.SendWait("{RIGHT}"); break;
                case "Home": SendKeys.SendWait("{HOME}"); break;
                case "End": SendKeys.SendWait("{END}"); break;
                case "PageUp": SendKeys.SendWait("{PGUP}"); break;
                case "PageDown": SendKeys.SendWait("{PGDN}"); break;
                case " ": SendKeys.SendWait(" "); break;
                case "Win":
                    NativeMethods.keybd_event(0x5B, 0, 0, UIntPtr.Zero);
                    NativeMethods.keybd_event(0x5B, 0, NativeMethods.KEYEVENTF_KEYUP, UIntPtr.Zero);
                    break;
                case "Alt+Tab":
                    SendKeys.SendWait("%{TAB}");
                    break;
                case "Ctrl+Shift+Esc":
                    SendKeys.SendWait("^+{ESC}");
                    break;
                case "Ctrl+Alt+Del":
                    SendKeys.SendWait("^+{ESC}");
                    break;
                case "Win+D":
                    NativeMethods.keybd_event(0x5B, 0, 0, UIntPtr.Zero);
                    NativeMethods.keybd_event(0x44, 0, 0, UIntPtr.Zero);
                    NativeMethods.keybd_event(0x44, 0, NativeMethods.KEYEVENTF_KEYUP, UIntPtr.Zero);
                    NativeMethods.keybd_event(0x5B, 0, NativeMethods.KEYEVENTF_KEYUP, UIntPtr.Zero);
                    break;
                case "Win+R":
                    NativeMethods.keybd_event(0x5B, 0, 0, UIntPtr.Zero);
                    NativeMethods.keybd_event(0x52, 0, 0, UIntPtr.Zero);
                    NativeMethods.keybd_event(0x52, 0, NativeMethods.KEYEVENTF_KEYUP, UIntPtr.Zero);
                    NativeMethods.keybd_event(0x5B, 0, NativeMethods.KEYEVENTF_KEYUP, UIntPtr.Zero);
                    break;
                default:
                    if (key.Length == 1)
                    {
                        SendKeys.SendWait(EscapeSendKeys(key));
                    }
                    break;
            }
        }

        private static string EscapeSendKeys(string input)
        {
            StringBuilder sb = new StringBuilder();
            foreach (char c in input)
            {
                if (c == '+' || c == '^' || c == '%' || c == '~' || c == '(' || c == ')' || c == '{' || c == '}' || c == '[' || c == ']')
                {
                    sb.Append("{").Append(c).Append("}");
                }
                else
                {
                    sb.Append(c);
                }
            }
            return sb.ToString();
        }
    }

    public class ConsentDialog : Form
    {
        private Label _lblTimer;
        private System.Windows.Forms.Timer _countdownTimer;
        private int _secondsLeft = 30;

        public ConsentDialog(string requestedBy)
        {
            this.Text = "Nexus ITAM - Solicitação de Acesso Remoto";
            this.Size = new Size(460, 250);
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.MaximizeBox = false;
            this.MinimizeBox = false;
            this.TopMost = true;
            this.BackColor = Color.FromArgb(15, 23, 42);
            this.ForeColor = Color.White;

            Label lblTitle = new Label();
            lblTitle.Text = "A equipe de TI solicita acesso remoto";
            lblTitle.Font = new Font("Segoe UI", 13f, FontStyle.Bold);
            lblTitle.ForeColor = Color.FromArgb(56, 189, 248);
            lblTitle.Location = new Point(24, 20);
            lblTitle.AutoSize = true;

            Label lblDesc = new Label();
            lblDesc.Text = string.Format("O técnico {0} deseja visualizar e controlar sua tela para prestar suporte técnico neste equipamento.",
                string.IsNullOrEmpty(requestedBy) ? "Suporte TI" : requestedBy);
            lblDesc.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
            lblDesc.ForeColor = Color.FromArgb(203, 213, 225);
            lblDesc.Location = new Point(24, 56);
            lblDesc.Size = new Size(400, 48);

            _lblTimer = new Label();
            _lblTimer.Text = "Tempo restante para responder: 30s";
            _lblTimer.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
            _lblTimer.ForeColor = Color.FromArgb(251, 191, 36);
            _lblTimer.Location = new Point(24, 114);
            _lblTimer.AutoSize = true;

            Button btnAllow = new Button();
            btnAllow.Text = "Permitir Acesso";
            btnAllow.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            btnAllow.BackColor = Color.FromArgb(16, 185, 129);
            btnAllow.ForeColor = Color.White;
            btnAllow.FlatStyle = FlatStyle.Flat;
            btnAllow.FlatAppearance.BorderSize = 0;
            btnAllow.Location = new Point(24, 152);
            btnAllow.Size = new Size(190, 40);
            btnAllow.Click += delegate
            {
                this.DialogResult = DialogResult.OK;
                this.Close();
            };

            Button btnDeny = new Button();
            btnDeny.Text = "Recusar";
            btnDeny.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            btnDeny.BackColor = Color.FromArgb(239, 68, 68);
            btnDeny.ForeColor = Color.White;
            btnDeny.FlatStyle = FlatStyle.Flat;
            btnDeny.FlatAppearance.BorderSize = 0;
            btnDeny.Location = new Point(230, 152);
            btnDeny.Size = new Size(190, 40);
            btnDeny.Click += delegate
            {
                this.DialogResult = DialogResult.Cancel;
                this.Close();
            };

            this.Controls.Add(lblTitle);
            this.Controls.Add(lblDesc);
            this.Controls.Add(_lblTimer);
            this.Controls.Add(btnAllow);
            this.Controls.Add(btnDeny);

            _countdownTimer = new System.Windows.Forms.Timer();
            _countdownTimer.Interval = 1000;
            _countdownTimer.Tick += delegate
            {
                _secondsLeft--;
                if (_secondsLeft <= 0)
                {
                    _countdownTimer.Stop();
                    this.DialogResult = DialogResult.Cancel;
                    this.Close();
                }
                else
                {
                    _lblTimer.Text = string.Format("Tempo restante para responder: {0}s", _secondsLeft);
                }
            };
            _countdownTimer.Start();
        }
    }

    public class SupportTicketDialog : Form
    {
        public string IssueDescription { get; private set; }
        public string Priority { get; private set; }

        public SupportTicketDialog()
        {
            this.Text = "Solicitar Suporte à TI - Nexus ITAM";
            this.Size = new Size(460, 320);
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.StartPosition = FormStartPosition.CenterParent;
            this.MaximizeBox = false;
            this.MinimizeBox = false;
            this.BackColor = Color.White;

            Label lblTitle = new Label();
            lblTitle.Text = "Como a TI pode ajudar você agora?";
            lblTitle.Font = new Font("Segoe UI", 11.5f, FontStyle.Bold);
            lblTitle.ForeColor = Color.FromArgb(15, 23, 42);
            lblTitle.Location = new Point(20, 18);
            lblTitle.AutoSize = true;

            Label lblPrio = new Label();
            lblPrio.Text = "Urgência:";
            lblPrio.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
            lblPrio.Location = new Point(20, 54);
            lblPrio.AutoSize = true;

            ComboBox cmbPrio = new ComboBox();
            cmbPrio.DropDownStyle = ComboBoxStyle.DropDownList;
            cmbPrio.Font = new Font("Segoe UI", 9.5f);
            cmbPrio.Items.AddRange(new object[] { "Normal", "Alta - Trabalho impactado", "Crítica - Computador parado" });
            cmbPrio.SelectedIndex = 0;
            cmbPrio.Location = new Point(20, 76);
            cmbPrio.Size = new Size(400, 28);

            Label lblMsg = new Label();
            lblMsg.Text = "Descreva brevemente o problema:";
            lblMsg.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
            lblMsg.Location = new Point(20, 114);
            lblMsg.AutoSize = true;

            TextBox txtMsg = new TextBox();
            txtMsg.Multiline = true;
            txtMsg.Font = new Font("Segoe UI", 9.5f);
            txtMsg.Location = new Point(20, 136);
            txtMsg.Size = new Size(400, 80);

            Button btnSend = new Button();
            btnSend.Text = "Enviar Chamado para a TI";
            btnSend.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            btnSend.BackColor = Color.FromArgb(37, 99, 235);
            btnSend.ForeColor = Color.White;
            btnSend.FlatStyle = FlatStyle.Flat;
            btnSend.FlatAppearance.BorderSize = 0;
            btnSend.Location = new Point(20, 228);
            btnSend.Size = new Size(260, 38);
            btnSend.Click += delegate
            {
                if (string.IsNullOrEmpty(txtMsg.Text.Trim()))
                {
                    MessageBox.Show("Por favor, descreva o problema para a equipe de TI.", "Atenção", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                this.IssueDescription = txtMsg.Text.Trim();
                this.Priority = cmbPrio.SelectedItem.ToString();
                this.DialogResult = DialogResult.OK;
                this.Close();
            };

            Button btnCancel = new Button();
            btnCancel.Text = "Cancelar";
            btnCancel.Font = new Font("Segoe UI", 9f);
            btnCancel.Location = new Point(290, 228);
            btnCancel.Size = new Size(130, 38);
            btnCancel.Click += delegate
            {
                this.DialogResult = DialogResult.Cancel;
                this.Close();
            };

            this.Controls.Add(lblTitle);
            this.Controls.Add(lblPrio);
            this.Controls.Add(cmbPrio);
            this.Controls.Add(lblMsg);
            this.Controls.Add(txtMsg);
            this.Controls.Add(btnSend);
            this.Controls.Add(btnCancel);
        }
    }

    public class ConfigDialog : Form
    {
        public AgentConfig ResultConfig { get; private set; }

        public ConfigDialog(AgentConfig current)
        {
            this.Text = "Configurar Agente Nexus ITAM";
            this.Size = new Size(470, 340);
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.StartPosition = FormStartPosition.CenterParent;
            this.MaximizeBox = false;
            this.MinimizeBox = false;
            this.BackColor = Color.White;

            Label l1 = new Label { Text = "Tenant ID da Empresa:", Font = new Font("Segoe UI", 9f, FontStyle.Bold), Location = new Point(20, 18), AutoSize = true };
            TextBox tTenant = new TextBox { Text = current.tenantId, Font = new Font("Consolas", 10f), Location = new Point(20, 40), Size = new Size(410, 26) };

            Label l2 = new Label { Text = "Token Secreto do Agente (Agent Token):", Font = new Font("Segoe UI", 9f, FontStyle.Bold), Location = new Point(20, 76), AutoSize = true };
            TextBox tToken = new TextBox { Text = current.agentToken, Font = new Font("Consolas", 10f), Location = new Point(20, 98), Size = new Size(410, 26) };

            Label l3 = new Label { Text = "Patrimônio da Máquina (opcional, ex: SHL-BEL-NTB-001):", Font = new Font("Segoe UI", 9f, FontStyle.Bold), Location = new Point(20, 134), AutoSize = true };
            TextBox tPat = new TextBox { Text = current.patrimony, Font = new Font("Consolas", 10f), Location = new Point(20, 156), Size = new Size(410, 26) };

            CheckBox chkUnattended = new CheckBox
            {
                Text = "Permitir acesso remoto não supervisionado da equipe de TI",
                Checked = current.unattendedEnabled,
                Font = new Font("Segoe UI", 9f),
                Location = new Point(20, 196),
                AutoSize = true
            };

            Button btnSave = new Button
            {
                Text = "Salvar e Conectar",
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                BackColor = Color.FromArgb(16, 185, 129),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Location = new Point(20, 240),
                Size = new Size(270, 38)
            };
            btnSave.FlatAppearance.BorderSize = 0;
            btnSave.Click += delegate
            {
                if (string.IsNullOrEmpty(tTenant.Text.Trim()) || string.IsNullOrEmpty(tToken.Text.Trim()))
                {
                    MessageBox.Show("Informe o Tenant ID e o Token do Agente (disponíveis em Agente ITAM -> Instalar no painel web).",
                        "Campos obrigatórios", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                AgentConfig cfg = new AgentConfig();
                cfg.projectId = string.IsNullOrEmpty(current.projectId) ? "itam-nexus" : current.projectId;
                cfg.serverUrl = string.IsNullOrEmpty(current.serverUrl) ? "https://itam-nexus.web.app" : current.serverUrl;
                cfg.tenantId = tTenant.Text.Trim();
                cfg.agentToken = tToken.Text.Trim();
                cfg.patrimony = tPat.Text.Trim();
                cfg.unattendedEnabled = chkUnattended.Checked;
                cfg.Save();
                this.ResultConfig = cfg;
                this.DialogResult = DialogResult.OK;
                this.Close();
            };

            Button btnCancel = new Button
            {
                Text = "Cancelar",
                Font = new Font("Segoe UI", 9f),
                Location = new Point(300, 240),
                Size = new Size(130, 38)
            };
            btnCancel.Click += delegate
            {
                this.DialogResult = DialogResult.Cancel;
                this.Close();
            };

            this.Controls.AddRange(new Control[] { l1, tTenant, l2, tToken, l3, tPat, chkUnattended, btnSave, btnCancel });
        }
    }

    public class MainAgentForm : Form
    {
        private AgentConfig _config;
        private NotifyIcon _trayIcon;
        private Label _lblStatusBadge;
        private Label _lblAccessId;
        private Label _lblMachineInfo;
        private Label _lblCpuVal;
        private Label _lblRamVal;
        private Label _lblDiskVal;
        private Panel _barCpuFill;
        private Panel _barRamFill;
        private Panel _barDiskFill;
        private Label _lblLastSync;
        private Panel _remoteBanner;
        private Label _lblRemoteBannerText;

        private Thread _workerThread;
        private volatile bool _running = true;
        private volatile bool _forceClose = false;
        private volatile bool _forceHeartbeatNow = false;
        private volatile bool _forceInventoryNow = false;

        private string _activeSessionId = "";
        private string _activeSessionState = "idle"; // idle | active | rejected | ended
        private string _activeSessionOperator = "";
        private string _activeSessionQuality = "balanced";
        private long _lastProcessedInputSeq = 0;
        private string _lastExecutedCommandId = "";
        private Dictionary<string, object> _lastCommandResult = null;
        private Dictionary<string, object> _pendingSupportRequest = null;
        private DateTime _lastInventorySyncAt = DateTime.MinValue;

        public MainAgentForm(AgentConfig config)
        {
            _config = config;
            InitializeUi();
            InitializeTray();
            StartBackgroundWorker();
        }

        private Icon CreateDynamicIcon(bool remoteActive)
        {
            using (Bitmap bmp = new Bitmap(32, 32))
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                Color bg = remoteActive ? Color.FromArgb(147, 51, 234) : Color.FromArgb(15, 23, 42);
                Color accent = remoteActive ? Color.FromArgb(250, 204, 21) : Color.FromArgb(16, 185, 129);
                using (SolidBrush bBg = new SolidBrush(bg))
                using (SolidBrush bAc = new SolidBrush(accent))
                using (Font f = new Font("Segoe UI", 13f, FontStyle.Bold, GraphicsUnit.Pixel))
                {
                    g.FillEllipse(bBg, 1, 1, 30, 30);
                    g.DrawString("NX", f, Brushes.White, new PointF(4f, 7f));
                    g.FillEllipse(bAc, 21, 21, 9, 9);
                }
                return Icon.FromHandle(bmp.GetHicon());
            }
        }

        private void InitializeUi()
        {
            this.Text = "Nexus ITAM • Agente Corporativo & Acesso Remoto";
            this.Size = new Size(720, 470);
            this.FormBorderStyle = FormBorderStyle.FixedSingle;
            this.MaximizeBox = false;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(241, 245, 249);
            this.Icon = CreateDynamicIcon(false);

            // Top Header
            Panel header = new Panel
            {
                Dock = DockStyle.Top,
                Height = 64,
                BackColor = Color.FromArgb(15, 23, 42)
            };

            Label title = new Label
            {
                Text = "NEXUS ITAM",
                Font = new Font("Segoe UI", 14f, FontStyle.Bold),
                ForeColor = Color.White,
                Location = new Point(22, 12),
                AutoSize = true
            };

            Label subTitle = new Label
            {
                Text = "Agente de Monitoramento, Inventário & Suporte Remoto v3.0",
                Font = new Font("Segoe UI", 8.5f),
                ForeColor = Color.FromArgb(148, 163, 184),
                Location = new Point(24, 37),
                AutoSize = true
            };

            _lblStatusBadge = new Label
            {
                Text = "● CONECTANDO...",
                Font = new Font("Segoe UI", 9f, FontStyle.Bold),
                ForeColor = Color.FromArgb(52, 211, 153),
                BackColor = Color.FromArgb(30, 41, 59),
                TextAlign = ContentAlignment.MiddleCenter,
                Location = new Point(515, 17),
                Size = new Size(175, 30)
            };

            header.Controls.Add(title);
            header.Controls.Add(subTitle);
            header.Controls.Add(_lblStatusBadge);

            // Active Remote Session Banner
            _remoteBanner = new Panel
            {
                Location = new Point(20, 74),
                Size = new Size(664, 42),
                BackColor = Color.FromArgb(126, 34, 206),
                Visible = false
            };

            _lblRemoteBannerText = new Label
            {
                Text = "SESSÃO REMOTA ATIVA: Técnico conectado a este computador",
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                ForeColor = Color.White,
                Location = new Point(14, 11),
                AutoSize = true
            };

            Button btnStopRemote = new Button
            {
                Text = "Encerrar Acesso",
                Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
                BackColor = Color.FromArgb(239, 68, 68),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Location = new Point(525, 6),
                Size = new Size(128, 30)
            };
            btnStopRemote.FlatAppearance.BorderSize = 0;
            btnStopRemote.Click += delegate
            {
                _activeSessionState = "ended";
                _activeSessionId = "";
                _remoteBanner.Visible = false;
                _trayIcon.Icon = CreateDynamicIcon(false);
                _forceHeartbeatNow = true;
            };

            _remoteBanner.Controls.Add(_lblRemoteBannerText);
            _remoteBanner.Controls.Add(btnStopRemote);

            // Left Card - Access ID & Machine Info
            Panel leftCard = new Panel
            {
                Location = new Point(20, 124),
                Size = new Size(340, 235),
                BackColor = Color.White
            };

            Label lblIdHeader = new Label
            {
                Text = "SEU ID DE ACESSO REMOTO NEXUS",
                Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
                ForeColor = Color.FromArgb(100, 116, 139),
                Location = new Point(18, 16),
                AutoSize = true
            };

            _lblAccessId = new Label
            {
                Text = MachineIdentity.GetAccessId(),
                Font = new Font("Consolas", 23f, FontStyle.Bold),
                ForeColor = Color.FromArgb(37, 99, 235),
                Location = new Point(14, 38),
                AutoSize = true
            };

            Button btnCopyId = new Button
            {
                Text = "Copiar ID",
                Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
                BackColor = Color.FromArgb(239, 246, 255),
                ForeColor = Color.FromArgb(37, 99, 235),
                FlatStyle = FlatStyle.Flat,
                Location = new Point(242, 43),
                Size = new Size(80, 30)
            };
            btnCopyId.FlatAppearance.BorderSize = 1;
            btnCopyId.FlatAppearance.BorderColor = Color.FromArgb(191, 219, 254);
            btnCopyId.Click += delegate
            {
                try
                {
                    Clipboard.SetText(MachineIdentity.GetAccessId());
                    btnCopyId.Text = "Copiado!";
                }
                catch { }
            };

            _lblMachineInfo = new Label
            {
                Font = new Font("Segoe UI", 9f),
                ForeColor = Color.FromArgb(51, 65, 85),
                Location = new Point(18, 92),
                Size = new Size(305, 130)
            };
            RefreshMachineInfoText();

            leftCard.Controls.Add(lblIdHeader);
            leftCard.Controls.Add(_lblAccessId);
            leftCard.Controls.Add(btnCopyId);
            leftCard.Controls.Add(_lblMachineInfo);

            // Right Card - Live Telemetry
            Panel rightCard = new Panel
            {
                Location = new Point(374, 124),
                Size = new Size(310, 235),
                BackColor = Color.White
            };

            Label lblTelHeader = new Label
            {
                Text = "SAÚDE E RECURSOS EM TEMPO REAL",
                Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
                ForeColor = Color.FromArgb(100, 116, 139),
                Location = new Point(18, 16),
                AutoSize = true
            };

            // CPU Bar
            Label lCpu = new Label { Text = "Processador (CPU)", Font = new Font("Segoe UI", 9f, FontStyle.Bold), Location = new Point(18, 46), AutoSize = true };
            _lblCpuVal = new Label { Text = "10%", Font = new Font("Segoe UI", 9f, FontStyle.Bold), ForeColor = Color.FromArgb(37, 99, 235), Location = new Point(240, 46), Size = new Size(52, 18), TextAlign = ContentAlignment.MiddleRight };
            Panel barCpuBg = new Panel { Location = new Point(18, 68), Size = new Size(274, 10), BackColor = Color.FromArgb(226, 232, 240) };
            _barCpuFill = new Panel { Location = new Point(0, 0), Size = new Size(40, 10), BackColor = Color.FromArgb(59, 130, 246) };
            barCpuBg.Controls.Add(_barCpuFill);

            // RAM Bar
            Label lRam = new Label { Text = "Memória RAM", Font = new Font("Segoe UI", 9f, FontStyle.Bold), Location = new Point(18, 92), AutoSize = true };
            _lblRamVal = new Label { Text = "45%", Font = new Font("Segoe UI", 9f, FontStyle.Bold), ForeColor = Color.FromArgb(16, 185, 129), Location = new Point(180, 92), Size = new Size(112, 18), TextAlign = ContentAlignment.MiddleRight };
            Panel barRamBg = new Panel { Location = new Point(18, 114), Size = new Size(274, 10), BackColor = Color.FromArgb(226, 232, 240) };
            _barRamFill = new Panel { Location = new Point(0, 0), Size = new Size(110, 10), BackColor = Color.FromArgb(16, 185, 129) };
            barRamBg.Controls.Add(_barRamFill);

            // Disk Bar
            Label lDisk = new Label { Text = "Disco Principal (C:)", Font = new Font("Segoe UI", 9f, FontStyle.Bold), Location = new Point(18, 138), AutoSize = true };
            _lblDiskVal = new Label { Text = "38%", Font = new Font("Segoe UI", 9f, FontStyle.Bold), ForeColor = Color.FromArgb(245, 158, 11), Location = new Point(180, 138), Size = new Size(112, 18), TextAlign = ContentAlignment.MiddleRight };
            Panel barDiskBg = new Panel { Location = new Point(18, 160), Size = new Size(274, 10), BackColor = Color.FromArgb(226, 232, 240) };
            _barDiskFill = new Panel { Location = new Point(0, 0), Size = new Size(90, 10), BackColor = Color.FromArgb(245, 158, 11) };
            barDiskBg.Controls.Add(_barDiskFill);

            _lblLastSync = new Label
            {
                Text = "Inventário automático ativo",
                Font = new Font("Segoe UI", 8f),
                ForeColor = Color.FromArgb(100, 116, 139),
                Location = new Point(18, 192),
                Size = new Size(175, 28)
            };

            Button btnSyncNow = new Button
            {
                Text = "Sincronizar",
                Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
                BackColor = Color.FromArgb(241, 245, 249),
                ForeColor = Color.FromArgb(51, 65, 85),
                FlatStyle = FlatStyle.Flat,
                Location = new Point(196, 188),
                Size = new Size(96, 30)
            };
            btnSyncNow.FlatAppearance.BorderColor = Color.FromArgb(203, 213, 225);
            btnSyncNow.Click += delegate
            {
                _lblLastSync.Text = "Sincronizando inventário...";
                _forceInventoryNow = true;
                _forceHeartbeatNow = true;
            };

            rightCard.Controls.AddRange(new Control[]
            {
                lblTelHeader,
                lCpu, _lblCpuVal, barCpuBg,
                lRam, _lblRamVal, barRamBg,
                lDisk, _lblDiskVal, barDiskBg,
                _lblLastSync, btnSyncNow
            });

            // Bottom Action Buttons
            Button btnSupport = new Button
            {
                Text = "Pedir Suporte à Equipe de TI",
                Font = new Font("Segoe UI", 10f, FontStyle.Bold),
                BackColor = Color.FromArgb(37, 99, 235),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Location = new Point(20, 374),
                Size = new Size(340, 42)
            };
            btnSupport.FlatAppearance.BorderSize = 0;
            btnSupport.Click += delegate { OpenSupportDialog(); };

            Button btnConfig = new Button
            {
                Text = "Configurar Token / Empresa",
                Font = new Font("Segoe UI", 9f, FontStyle.Bold),
                BackColor = Color.White,
                ForeColor = Color.FromArgb(51, 65, 85),
                FlatStyle = FlatStyle.Flat,
                Location = new Point(374, 374),
                Size = new Size(195, 42)
            };
            btnConfig.FlatAppearance.BorderColor = Color.FromArgb(203, 213, 225);
            btnConfig.Click += delegate { OpenConfigModal(); };

            Button btnHide = new Button
            {
                Text = "Minimizar",
                Font = new Font("Segoe UI", 9f),
                BackColor = Color.White,
                ForeColor = Color.FromArgb(100, 116, 139),
                FlatStyle = FlatStyle.Flat,
                Location = new Point(579, 374),
                Size = new Size(105, 42)
            };
            btnHide.FlatAppearance.BorderColor = Color.FromArgb(203, 213, 225);
            btnHide.Click += delegate { this.Hide(); };

            this.Controls.Add(header);
            this.Controls.Add(_remoteBanner);
            this.Controls.Add(leftCard);
            this.Controls.Add(rightCard);
            this.Controls.Add(btnSupport);
            this.Controls.Add(btnConfig);
            this.Controls.Add(btnHide);

            System.Windows.Forms.Timer uiTimer = new System.Windows.Forms.Timer();
            uiTimer.Interval = 2000;
            uiTimer.Tick += delegate { RefreshTelemetryUi(); };
            uiTimer.Start();
            RefreshTelemetryUi();
        }

        private void RefreshMachineInfoText()
        {
            string pat = string.IsNullOrEmpty(_config.patrimony) ? Environment.MachineName : _config.patrimony;
            string info = string.Format(
                "Patrimônio / Host:  {0}\r\n" +
                "Computador:          {1}\r\n" +
                "Usuário Logado:      {2}\r\n" +
                "Endereço IPv4:       {3}\r\n" +
                "Número de Série:     {4}\r\n" +
                "Sistema:             {5}",
                pat,
                Environment.MachineName,
                Environment.UserName,
                MachineIdentity.GetLocalIPv4(),
                MachineIdentity.GetSerialNumber(),
                MachineIdentity.GetOsCaption());
            if (_lblMachineInfo != null) _lblMachineInfo.Text = info;
        }

        private void RefreshTelemetryUi()
        {
            int cpu = TelemetryCollector.SampleCpuPercent();
            int ramPct;
            double ramUsed, ramTotal;
            TelemetryCollector.SampleMemory(out ramPct, out ramUsed, out ramTotal);

            int diskPct;
            double diskFree, diskTotal;
            TelemetryCollector.SampleSystemDrive(out diskPct, out diskFree, out diskTotal);

            _lblCpuVal.Text = cpu.ToString() + "%";
            _barCpuFill.Width = Math.Max(4, (int)Math.Round(274 * (cpu / 100.0)));

            _lblRamVal.Text = string.Format("{0}% ({1}/{2} GB)", ramPct, ramUsed, ramTotal);
            _barRamFill.Width = Math.Max(4, (int)Math.Round(274 * (ramPct / 100.0)));

            _lblDiskVal.Text = string.Format("{0}% ({1} GB livres)", diskPct, diskFree);
            _barDiskFill.Width = Math.Max(4, (int)Math.Round(274 * (diskPct / 100.0)));
        }

        private void InitializeTray()
        {
            ContextMenu menu = new ContextMenu();
            menu.MenuItems.Add("Abrir Painel Nexus ITAM", delegate { ShowMainWindow(); });
            menu.MenuItems.Add("Copiar ID de Acesso (" + MachineIdentity.GetAccessId() + ")", delegate
            {
                try { Clipboard.SetText(MachineIdentity.GetAccessId()); } catch { }
            });
            menu.MenuItems.Add("-");
            menu.MenuItems.Add("Pedir Suporte à TI...", delegate { ShowMainWindow(); OpenSupportDialog(); });
            menu.MenuItems.Add("Sincronizar Inventário Agora", delegate
            {
                _forceInventoryNow = true;
                _forceHeartbeatNow = true;
            });
            menu.MenuItems.Add("Configurar Token / Empresa...", delegate { ShowMainWindow(); OpenConfigModal(); });
            menu.MenuItems.Add("-");
            menu.MenuItems.Add("Sair do Agente", delegate
            {
                _forceClose = true;
                _running = false;
                _trayIcon.Visible = false;
                Application.Exit();
            });

            _trayIcon = new NotifyIcon();
            _trayIcon.Icon = this.Icon;
            _trayIcon.Text = "Nexus ITAM - ID: " + MachineIdentity.GetAccessId();
            _trayIcon.ContextMenu = menu;
            _trayIcon.Visible = true;
            _trayIcon.DoubleClick += delegate { ShowMainWindow(); };
        }

        private void ShowMainWindow()
        {
            this.Show();
            this.WindowState = FormWindowState.Normal;
            this.Activate();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!_forceClose && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                this.Hide();
                _trayIcon.ShowBalloonTip(2500, "Nexus ITAM continua ativo",
                    "ID de Acesso: " + MachineIdentity.GetAccessId() + ". Clique duas vezes no ícone para abrir.",
                    ToolTipIcon.Info);
                return;
            }
            _running = false;
            if (_trayIcon != null) _trayIcon.Visible = false;
            base.OnFormClosing(e);
        }

        private void OpenSupportDialog()
        {
            using (SupportTicketDialog dlg = new SupportTicketDialog())
            {
                if (dlg.ShowDialog(this) == DialogResult.OK)
                {
                    Dictionary<string, object> req = new Dictionary<string, object>();
                    req["id"] = "sup-" + DateTime.UtcNow.Ticks.ToString();
                    req["status"] = "open";
                    req["message"] = dlg.IssueDescription;
                    req["priority"] = dlg.Priority;
                    req["user"] = Environment.UserName;
                    req["createdAt"] = DateTime.UtcNow.ToString("o");
                    _pendingSupportRequest = req;
                    _forceHeartbeatNow = true;
                    MessageBox.Show("Chamado enviado com sucesso! A equipe de TI recebeu seu alerta em tempo real.",
                        "Nexus ITAM - Suporte", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
            }
        }

        private void OpenConfigModal()
        {
            using (ConfigDialog dlg = new ConfigDialog(_config))
            {
                if (dlg.ShowDialog(this) == DialogResult.OK && dlg.ResultConfig != null)
                {
                    _config = dlg.ResultConfig;
                    RefreshMachineInfoText();
                    _forceHeartbeatNow = true;
                    _forceInventoryNow = true;
                }
            }
        }

        private void StartBackgroundWorker()
        {
            _workerThread = new Thread(BackgroundLoop);
            _workerThread.IsBackground = true;
            _workerThread.Start();
        }

        private void BackgroundLoop()
        {
            DateTime lastHeartbeat = DateTime.MinValue;
            DateTime lastControlPoll = DateTime.MinValue;

            while (_running)
            {
                try
                {
                    if (string.IsNullOrEmpty(_config.tenantId) || string.IsNullOrEmpty(_config.agentToken))
                    {
                        UpdateStatusBadge("● AGUARDANDO TOKEN", Color.FromArgb(251, 191, 36));
                        Thread.Sleep(2000);
                        continue;
                    }

                    DateTime now = DateTime.UtcNow;
                    bool isStreaming = (_activeSessionState == "active");

                    // 1. Poll de controle e sessao remota
                    int pollIntervalMs = isStreaming ? 650 : 3000;
                    if ((now - lastControlPoll).TotalMilliseconds >= pollIntervalMs || _forceHeartbeatNow)
                    {
                        PollControlDocument();
                        lastControlPoll = DateTime.UtcNow;
                    }

                    // 2. Sincronizacao de inventario completo (a cada 4h ou sob demanda)
                    if (_forceInventoryNow || _lastInventorySyncAt == DateTime.MinValue || (now - _lastInventorySyncAt).TotalHours >= 4.0)
                    {
                        _forceInventoryNow = false;
                        SyncFullInventoryToInbox();
                        _lastInventorySyncAt = DateTime.UtcNow;
                    }

                    // 3. Heartbeat + Telemetria + Frame de Tela
                    isStreaming = (_activeSessionState == "active");
                    int hbIntervalMs = isStreaming ? 700 : 18000;
                    if (_forceHeartbeatNow || (now - lastHeartbeat).TotalMilliseconds >= hbIntervalMs)
                    {
                        _forceHeartbeatNow = false;
                        SendDeviceHeartbeat(isStreaming);
                        lastHeartbeat = DateTime.UtcNow;
                    }
                }
                catch { }

                Thread.Sleep(_activeSessionState == "active" ? 180 : 500);
            }
        }

        private void PollControlDocument()
        {
            string docId = _config.tenantId + "_" + MachineIdentity.GetDeviceKey();
            Dictionary<string, object> ctrl = FirestoreWire.GetDocument(_config.projectId, "agentControl", docId);
            if (ctrl == null) return;

            // Processa comandos pendentes
            if (ctrl.ContainsKey("pendingCommand") && ctrl["pendingCommand"] is Dictionary<string, object>)
            {
                Dictionary<string, object> cmd = (Dictionary<string, object>)ctrl["pendingCommand"];
                string cmdId = cmd.ContainsKey("id") ? Convert.ToString(cmd["id"]) : "";
                if (!string.IsNullOrEmpty(cmdId) && cmdId != _lastExecutedCommandId)
                {
                    _lastExecutedCommandId = cmdId;
                    ExecuteRemoteCommand(cmd);
                    _forceHeartbeatNow = true;
                }
            }

            // Processa sessao de acesso remoto
            if (ctrl.ContainsKey("remoteSession") && ctrl["remoteSession"] is Dictionary<string, object>)
            {
                Dictionary<string, object> rs = (Dictionary<string, object>)ctrl["remoteSession"];
                string status = rs.ContainsKey("status") ? Convert.ToString(rs["status"]) : "closed";
                string sessionId = rs.ContainsKey("sessionId") ? Convert.ToString(rs["sessionId"]) : "";
                string mode = rs.ContainsKey("mode") ? Convert.ToString(rs["mode"]) : "unattended";
                string operatorName = rs.ContainsKey("requestedBy") ? Convert.ToString(rs["requestedBy"]) : "Equipe de TI";
                string quality = rs.ContainsKey("quality") ? Convert.ToString(rs["quality"]) : "balanced";
                _activeSessionQuality = quality;

                if (status == "closed" || status == "ended")
                {
                    if (_activeSessionState == "active")
                    {
                        _activeSessionState = "idle";
                        _activeSessionId = "";
                        UpdateRemoteBanner(false, "");
                    }
                    return;
                }

                if ((status == "requesting" || status == "active") && !string.IsNullOrEmpty(sessionId))
                {
                    if (_activeSessionId != sessionId)
                    {
                        _activeSessionId = sessionId;
                        _activeSessionOperator = operatorName;
                        _lastProcessedInputSeq = 0;

                        bool allowWithoutPrompt = (mode == "unattended" && _config.unattendedEnabled);
                        if (allowWithoutPrompt)
                        {
                            _activeSessionState = "active";
                            UpdateRemoteBanner(true, operatorName);
                            _forceHeartbeatNow = true;
                        }
                        else
                        {
                            bool accepted = PromptUserForConsent(operatorName);
                            if (accepted)
                            {
                                _activeSessionState = "active";
                                UpdateRemoteBanner(true, operatorName);
                            }
                            else
                            {
                                _activeSessionState = "rejected";
                                UpdateRemoteBanner(false, "");
                            }
                            _forceHeartbeatNow = true;
                        }
                    }

                    // Se a sessao estiver ativa, executa os eventos de mouse e teclado
                    if (_activeSessionState == "active" && rs.ContainsKey("inputEvents") && rs["inputEvents"] is List<object>)
                    {
                        List<object> events = (List<object>)rs["inputEvents"];
                        foreach (object item in events)
                        {
                            Dictionary<string, object> ev = item as Dictionary<string, object>;
                            if (ev == null) continue;
                            long seq = ev.ContainsKey("seq") ? Convert.ToInt64(ev["seq"]) : 0;
                            if (seq > _lastProcessedInputSeq)
                            {
                                _lastProcessedInputSeq = seq;
                                RemoteDesktopEngine.ExecuteInputEvent(ev);
                            }
                        }
                    }
                }
            }
        }

        private bool PromptUserForConsent(string operatorName)
        {
            bool accepted = false;
            try
            {
                this.Invoke((MethodInvoker)delegate
                {
                    using (ConsentDialog dlg = new ConsentDialog(operatorName))
                    {
                        accepted = (dlg.ShowDialog() == DialogResult.OK);
                    }
                });
            }
            catch { }
            return accepted;
        }

        private void ExecuteRemoteCommand(Dictionary<string, object> cmd)
        {
            string cmdId = cmd.ContainsKey("id") ? Convert.ToString(cmd["id"]) : "";
            string type = cmd.ContainsKey("type") ? Convert.ToString(cmd["type"]) : "";
            string commandText = cmd.ContainsKey("command") ? Convert.ToString(cmd["command"]) : "";
            string output = "";
            int exitCode = 0;

            try
            {
                if (type == "powershell")
                {
                    output = MachineIdentity.RunQuickPowerShell(commandText);
                    if (string.IsNullOrEmpty(output)) output = "(Comando concluído sem saída no console)";
                }
                else if (type == "kill_process")
                {
                    int pid;
                    if (int.TryParse(commandText, out pid))
                    {
                        using (Process p = Process.GetProcessById(pid))
                        {
                            string pName = p.ProcessName;
                            p.Kill();
                            output = string.Format("Processo {0} (PID {1}) finalizado com sucesso.", pName, pid);
                        }
                    }
                    else
                    {
                        Process[] list = Process.GetProcessesByName(commandText.Replace(".exe", ""));
                        int killed = 0;
                        foreach (Process p in list)
                        {
                            try { p.Kill(); killed++; } catch { }
                            finally { p.Dispose(); }
                        }
                        output = string.Format("{0} instância(s) de '{1}' finalizada(s).", killed, commandText);
                    }
                }
                else if (type == "msgbox")
                {
                    string title = cmd.ContainsKey("title") ? Convert.ToString(cmd["title"]) : "Mensagem da TI - Nexus ITAM";
                    string msg = commandText;
                    ThreadPool.QueueUserWorkItem(delegate
                    {
                        MessageBox.Show(msg, title, MessageBoxButtons.OK, MessageBoxIcon.Information, MessageBoxDefaultButton.Button1, MessageBoxOptions.DefaultDesktopOnly);
                    });
                    output = "Mensagem exibida na tela do colaborador.";
                }
                else if (type == "lock_screen")
                {
                    NativeMethods.LockWorkStation();
                    output = "Estação de trabalho bloqueada.";
                }
                else if (type == "restart")
                {
                    Process.Start("shutdown.exe", "/r /t 15 /c \"Reinicio solicitado pela equipe de TI (Nexus ITAM)\"");
                    output = "Reinício agendado para 15 segundos.";
                }
                else if (type == "shutdown")
                {
                    Process.Start("shutdown.exe", "/s /t 15 /c \"Desligamento solicitado pela equipe de TI (Nexus ITAM)\"");
                    output = "Desligamento agendado para 15 segundos.";
                }
                else if (type == "force_inventory")
                {
                    _forceInventoryNow = true;
                    output = "Coleta completa de inventário disparada.";
                }
                else if (type == "install_winget")
                {
                    output = MachineIdentity.RunQuickPowerShell(
                        "winget install --id \"" + commandText + "\" --silent --accept-package-agreements --accept-source-agreements");
                }
                else if (type == "uninstall_software")
                {
                    output = MachineIdentity.RunQuickPowerShell(
                        "winget uninstall --name \"" + commandText + "\" --silent --accept-source-agreements");
                }
                else
                {
                    output = "Tipo de comando desconhecido: " + type;
                    exitCode = 1;
                }
            }
            catch (Exception ex)
            {
                output = "Erro ao executar comando: " + ex.Message;
                exitCode = 1;
            }

            if (output != null && output.Length > 12000)
            {
                output = output.Substring(0, 12000) + "\r\n... [Saída truncada]";
            }

            Dictionary<string, object> res = new Dictionary<string, object>();
            res["commandId"] = cmdId;
            res["type"] = type;
            res["command"] = commandText;
            res["output"] = output;
            res["exitCode"] = exitCode;
            res["completedAt"] = DateTime.UtcNow.ToString("o");
            _lastCommandResult = res;
        }

        private void SendDeviceHeartbeat(bool includeScreenFrame)
        {
            int cpu = TelemetryCollector.SampleCpuPercent();
            int ramPct;
            double ramUsed, ramTotal;
            TelemetryCollector.SampleMemory(out ramPct, out ramUsed, out ramTotal);

            int diskPct;
            double diskFree, diskTotal;
            TelemetryCollector.SampleSystemDrive(out diskPct, out diskFree, out diskTotal);

            double uptimeHours = Math.Round((Environment.TickCount & Int32.MaxValue) / (1000.0 * 3600.0), 1);

            Dictionary<string, object> metrics = new Dictionary<string, object>();
            metrics["cpuPercent"] = cpu;
            metrics["ramPercent"] = ramPct;
            metrics["ramUsedGb"] = ramUsed;
            metrics["ramTotalGb"] = ramTotal;
            metrics["diskPercent"] = diskPct;
            metrics["diskFreeGb"] = diskFree;
            metrics["diskTotalGb"] = diskTotal;
            metrics["uptimeHours"] = uptimeHours;

            Dictionary<string, object> remoteState = new Dictionary<string, object>();
            remoteState["sessionId"] = _activeSessionId;
            remoteState["state"] = _activeSessionState;
            remoteState["operatorName"] = _activeSessionOperator;
            remoteState["lastInputSeq"] = _lastProcessedInputSeq;
            remoteState["unattendedEnabled"] = _config.unattendedEnabled;
            remoteState["updatedAt"] = DateTime.UtcNow.ToString("o");

            string devKey = MachineIdentity.GetDeviceKey();
            string docId = _config.tenantId + "_" + devKey;

            Dictionary<string, object> doc = new Dictionary<string, object>();
            doc["tenantId"] = _config.tenantId;
            doc["agentToken"] = _config.agentToken;
            doc["deviceKey"] = devKey;
            doc["accessId"] = MachineIdentity.GetAccessId();
            doc["hostname"] = Environment.MachineName;
            doc["serialNumber"] = MachineIdentity.GetSerialNumber();
            doc["deviceId"] = MachineIdentity.GetMachineGuid();
            doc["internalId"] = string.IsNullOrEmpty(_config.patrimony) ? Environment.MachineName : _config.patrimony;
            doc["ipAddress"] = MachineIdentity.GetLocalIPv4();
            doc["macAddress"] = MachineIdentity.GetMacAddress();
            doc["osCaption"] = MachineIdentity.GetOsCaption();
            doc["loggedUser"] = Environment.UserName;
            doc["agentVersion"] = "3.0.0-exe";
            doc["status"] = "online";
            doc["lastSeenAt"] = DateTime.UtcNow;
            doc["updatedAt"] = DateTime.UtcNow;
            doc["metrics"] = metrics;
            doc["topProcesses"] = TelemetryCollector.GetTopProcesses(12);
            doc["remoteState"] = remoteState;

            if (includeScreenFrame)
            {
                Dictionary<string, object> frame = RemoteDesktopEngine.CaptureCompressedFrame(_activeSessionQuality);
                if (frame != null)
                {
                    doc["screenFrame"] = frame;
                }
            }

            if (_lastCommandResult != null)
            {
                doc["lastCommandResult"] = _lastCommandResult;
            }

            if (_pendingSupportRequest != null)
            {
                doc["supportRequest"] = _pendingSupportRequest;
            }

            string err;
            bool ok = FirestoreWire.PatchDocument(_config.projectId, "agentDevices", docId, doc, out err);
            if (ok)
            {
                if (_activeSessionState == "active")
                {
                    UpdateStatusBadge("● EM ACESSO REMOTO", Color.FromArgb(216, 180, 254));
                }
                else
                {
                    UpdateStatusBadge("● CONECTADO À NUVEM", Color.FromArgb(52, 211, 153));
                }
            }
            else
            {
                UpdateStatusBadge("● ERRO DE CONEXÃO", Color.FromArgb(248, 113, 113));
            }
        }

        private void SyncFullInventoryToInbox()
        {
            try
            {
                string psScript = Path.Combine(AgentConfig.DefaultDir, "NexusAgent.ps1");
                if (!File.Exists(psScript)) psScript = Path.Combine(AgentConfig.DefaultDir, "nexus-agent.ps1");
                if (File.Exists(psScript))
                {
                    ProcessStartInfo psi = new ProcessStartInfo("powershell.exe",
                        "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + psScript + "\" -Scheduled -NoPause");
                    psi.CreateNoWindow = true;
                    psi.UseShellExecute = false;
                    using (Process p = Process.Start(psi))
                    {
                        p.WaitForExit(45000);
                    }
                    UpdateSyncLabel("Inventário sincronizado às " + DateTime.Now.ToString("HH:mm"));
                    return;
                }

                // Coleta direta caso o script ps1 auxiliar nao esteja na pasta
                int ramPct;
                double ramUsed, ramTotal;
                TelemetryCollector.SampleMemory(out ramPct, out ramUsed, out ramTotal);

                int diskPct;
                double diskFree, diskTotal;
                TelemetryCollector.SampleSystemDrive(out diskPct, out diskFree, out diskTotal);

                string cpuName = MachineIdentity.RunQuickPowerShell("(Get-CimInstance Win32_Processor | Select-Object -First 1).Name");
                if (string.IsNullOrEmpty(cpuName)) cpuName = "Intel/AMD x64 Processor";
                string manufacturer = MachineIdentity.RunQuickPowerShell("(Get-CimInstance Win32_ComputerSystem).Manufacturer");
                string model = MachineIdentity.RunQuickPowerShell("(Get-CimInstance Win32_ComputerSystem).Model");

                Dictionary<string, object> payload = new Dictionary<string, object>();
                payload["agentVersion"] = "3.0.0-exe";
                payload["collectedAt"] = DateTime.UtcNow.ToString("o");
                payload["hostname"] = Environment.MachineName;
                payload["internalId"] = string.IsNullOrEmpty(_config.patrimony) ? Environment.MachineName : _config.patrimony;
                payload["serialNumber"] = MachineIdentity.GetSerialNumber();
                payload["deviceId"] = MachineIdentity.GetMachineGuid();
                payload["manufacturer"] = string.IsNullOrEmpty(manufacturer) ? "OEM" : manufacturer;
                payload["model"] = string.IsNullOrEmpty(model) ? Environment.MachineName : model;
                payload["type"] = "Computador";
                payload["os_caption"] = MachineIdentity.GetOsCaption();
                payload["os_arch"] = Environment.Is64BitOperatingSystem ? "64-bit" : "32-bit";
                payload["processor"] = cpuName;
                payload["cpu_cores"] = Environment.ProcessorCount;
                payload["ram_total_gb"] = ramTotal;
                payload["ip_address"] = MachineIdentity.GetLocalIPv4();
                payload["mac_address"] = MachineIdentity.GetMacAddress();
                payload["logged_user"] = Environment.UserName;
                payload["uptime_hours"] = Math.Round((Environment.TickCount & Int32.MaxValue) / (1000.0 * 3600.0), 1);

                string devKey = MachineIdentity.GetDeviceKey();
                string docId = _config.tenantId + "_" + devKey;

                Dictionary<string, object> inboxDoc = new Dictionary<string, object>();
                inboxDoc["tenantId"] = _config.tenantId;
                inboxDoc["agentToken"] = _config.agentToken;
                inboxDoc["deviceKey"] = devKey;
                inboxDoc["status"] = "pending";
                inboxDoc["source"] = "agent-windows-exe";
                inboxDoc["agentVersion"] = "3.0.0-exe";
                inboxDoc["hostname"] = Environment.MachineName;
                inboxDoc["serialNumber"] = MachineIdentity.GetSerialNumber();
                inboxDoc["deviceId"] = MachineIdentity.GetMachineGuid();
                inboxDoc["internalId"] = string.IsNullOrEmpty(_config.patrimony) ? Environment.MachineName : _config.patrimony;
                inboxDoc["ip_address"] = MachineIdentity.GetLocalIPv4();
                inboxDoc["createdAt"] = DateTime.UtcNow;
                inboxDoc["payload"] = payload;

                string err;
                if (FirestoreWire.PatchDocument(_config.projectId, "agentInbox", docId, inboxDoc, out err))
                {
                    UpdateSyncLabel("Inventário sincronizado às " + DateTime.Now.ToString("HH:mm"));
                }
            }
            catch { }
        }

        private void UpdateStatusBadge(string text, Color color)
        {
            if (this.IsDisposed || _lblStatusBadge == null) return;
            try
            {
                this.BeginInvoke((MethodInvoker)delegate
                {
                    _lblStatusBadge.Text = text;
                    _lblStatusBadge.ForeColor = color;
                });
            }
            catch { }
        }

        private void UpdateSyncLabel(string text)
        {
            if (this.IsDisposed || _lblLastSync == null) return;
            try
            {
                this.BeginInvoke((MethodInvoker)delegate
                {
                    _lblLastSync.Text = text;
                });
            }
            catch { }
        }

        private void UpdateRemoteBanner(bool active, string operatorName)
        {
            if (this.IsDisposed) return;
            try
            {
                this.BeginInvoke((MethodInvoker)delegate
                {
                    _remoteBanner.Visible = active;
                    if (active)
                    {
                        _lblRemoteBannerText.Text = string.Format("SESSÃO REMOTA ATIVA: {0} conectado", operatorName);
                        _trayIcon.Icon = CreateDynamicIcon(true);
                        _trayIcon.ShowBalloonTip(3000, "Nexus ITAM - Acesso Remoto Iniciado",
                            string.Format("{0} conectou-se a este computador.", operatorName), ToolTipIcon.Info);
                    }
                    else
                    {
                        _trayIcon.Icon = CreateDynamicIcon(false);
                    }
                });
            }
            catch { }
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            try { NativeMethods.SetProcessDPIAware(); } catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            AgentConfig cfg = AgentConfig.Load();
            bool installMode = false;
            bool silentMode = false;

            if (args != null)
            {
                foreach (string arg in args)
                {
                    if (string.Equals(arg, "--install", StringComparison.OrdinalIgnoreCase)) installMode = true;
                    else if (string.Equals(arg, "--silent", StringComparison.OrdinalIgnoreCase)) silentMode = true;
                    else if (arg.StartsWith("--tenantId=", StringComparison.OrdinalIgnoreCase)) cfg.tenantId = arg.Substring("--tenantId=".Length).Trim('"', ' ');
                    else if (arg.StartsWith("--agentToken=", StringComparison.OrdinalIgnoreCase)) cfg.agentToken = arg.Substring("--agentToken=".Length).Trim('"', ' ');
                    else if (arg.StartsWith("--projectId=", StringComparison.OrdinalIgnoreCase)) cfg.projectId = arg.Substring("--projectId=".Length).Trim('"', ' ');
                    else if (arg.StartsWith("--patrimony=", StringComparison.OrdinalIgnoreCase)) cfg.patrimony = arg.Substring("--patrimony=".Length).Trim('"', ' ');
                }
            }

            if (!string.IsNullOrEmpty(cfg.tenantId) && !string.IsNullOrEmpty(cfg.agentToken))
            {
                cfg.Save();
            }

            if (installMode)
            {
                PerformSelfInstall(cfg);
                if (silentMode) return;
            }

            bool createdNew;
            string mutexName = "Local\\NexusITAMAgentUI_" + Process.GetCurrentProcess().SessionId.ToString();
            using (Mutex mutex = new Mutex(true, mutexName, out createdNew))
            {
                if (!createdNew)
                {
                    return;
                }
                MainAgentForm form = new MainAgentForm(cfg);
                if (silentMode)
                {
                    form.WindowState = FormWindowState.Minimized;
                    form.ShowInTaskbar = false;
                }
                Application.Run(form);
            }
        }

        private static void PerformSelfInstall(AgentConfig cfg)
        {
            try
            {
                string targetDir = AgentConfig.DefaultDir;
                if (!Directory.Exists(targetDir)) Directory.CreateDirectory(targetDir);

                cfg.Save();

                string currentExe = Application.ExecutablePath;
                string targetExe = Path.Combine(targetDir, "NexusAgent.exe");
                if (!string.Equals(Path.GetFullPath(currentExe), Path.GetFullPath(targetExe), StringComparison.OrdinalIgnoreCase))
                {
                    try { File.Copy(currentExe, targetExe, true); } catch { }
                }

                // Registra inicializacao automatica no logon do usuario/maquina
                try
                {
                    using (RegistryKey rk = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Run", true))
                    {
                        if (rk != null) rk.SetValue("NexusITAMAgent", "\"" + targetExe + "\" --silent");
                    }
                }
                catch
                {
                    try
                    {
                        using (RegistryKey rkUser = Registry.CurrentUser.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Run", true))
                        {
                            if (rkUser != null) rkUser.SetValue("NexusITAMAgent", "\"" + targetExe + "\" --silent");
                        }
                    }
                    catch { }
                }
            }
            catch { }
        }
    }
}
