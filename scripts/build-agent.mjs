// scripts/build-agent.mjs
// -----------------------------------------------------------------------------
// Gera o distribuivel do agente Windows em public/downloads:
//   NexusAgent.exe  compilado de src/agent/windows/NexusAgent.cs
//   NexusAgent.zip  NexusAgent.exe + coletor NexusAgent.ps1 (sem token) + LEIA-ME
// O projeto e a chave de API do Firebase vem do .env (VITE_FIREBASE_*); a chave
// de API web e publica (ja vai no bundle do site). O token da empresa nunca
// entra no pacote: ele vem no config.json baixado pelo admin no painel.
//
//   npm run build:agent        (Windows: usa o csc.exe do .NET Framework 4.x)
// -----------------------------------------------------------------------------
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'public', 'downloads');

const readEnv = () => {
  const env = {};
  for (const name of ['.env', '.env.local', '.env.production']) {
    const file = join(root, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
  return { ...env, ...process.env };
};

const env = readEnv();
const projectId = env.VITE_FIREBASE_PROJECT_ID;
const apiKey = env.VITE_FIREBASE_API_KEY;
if (!projectId || !apiKey) throw new Error('Defina VITE_FIREBASE_PROJECT_ID e VITE_FIREBASE_API_KEY no .env.');

const agentVersion = readFileSync(join(root, 'src/utils/agentInventory.js'), 'utf8').match(/AGENT_VERSION = '([^']+)'/)?.[1];
if (!agentVersion) throw new Error('AGENT_VERSION nao encontrado em src/utils/agentInventory.js.');

// split/join como em agentScripts.js: o codigo tem "$$" que o replace() interpretaria.
const fill = (template, values) =>
  Object.entries(values).reduce((code, [key, value]) => code.split(`__${key}__`).join(String(value)), template);
const crlf = (code) => code.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');

const csc = [
  join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
].find(existsSync);
if (!csc) throw new Error('csc.exe do .NET Framework 4.x nao encontrado (o build do agente roda no Windows).');

const work = mkdtempSync(join(tmpdir(), 'nexus-agent-'));
try {
  const source = join(work, 'NexusAgent.cs');
  writeFileSync(source, fill(readFileSync(join(root, 'src/agent/windows/NexusAgent.cs'), 'utf8'), { PROJECT_ID: projectId, API_KEY: apiKey }));

  mkdirSync(out, { recursive: true });
  const exe = join(out, 'NexusAgent.exe');
  const refs = ['System.dll', 'System.Core.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll', 'System.Web.Extensions.dll',
    'System.Management.dll', 'System.Security.dll', 'System.ServiceProcess.dll'].map((r) => `/r:${r}`);
  execFileSync(csc, ['/nologo', '/target:winexe', '/optimize+', '/warnaserror+', `/out:${exe}`, ...refs, source], { stdio: 'inherit' });

  const collector = fill(readFileSync(join(root, 'src/agent/windows/nexus-agent.ps1'), 'utf8'), {
    AGENT_VERSION: agentVersion,
    PROJECT_ID: projectId,
    API_KEY: apiKey,
    TENANT_ID: '',
    AGENT_TOKEN: '',
    FIRESTORE_BASE: 'https://firestore.googleapis.com/v1',
  });
  writeFileSync(join(work, 'NexusAgent.ps1'), `\uFEFF${crlf(collector)}`);
  writeFileSync(join(work, 'LEIA-ME.txt'), crlf(`Nexus ITAM - Agente Windows ${agentVersion}

1. Extraia esta pasta e coloque nela o config.json baixado no painel
   (Agente ITAM > Instalar > "Baixar NexusAgent (.ZIP) + config.json").
2. Abra o NexusAgent.exe e clique em "Conectar este computador".
   O Windows pede permissao de administrador.
3. Pronto: o servico "Nexus ITAM Agent" fica rodando e o icone aparece ao lado
   do relogio. O token sai do config.json assim que a maquina e matriculada.

Para remover: NexusAgent.exe --uninstall (como administrador) ou o script
"Desinstalar" do painel.
`));

  const zip = join(out, 'NexusAgent.zip');
  rmSync(zip, { force: true });
  execFileSync('powershell.exe', [
    '-NoProfile', '-Command',
    `Compress-Archive -Path '${exe}','${join(work, 'NexusAgent.ps1')}','${join(work, 'LEIA-ME.txt')}' -DestinationPath '${zip}' -CompressionLevel Optimal`,
  ], { stdio: 'inherit' });
  console.log(`NexusAgent ${agentVersion} (${projectId}) -> ${zip}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
