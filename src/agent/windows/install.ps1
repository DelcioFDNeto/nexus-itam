#Requires -RunAsAdministrator
# Nexus ITAM - Instalador do Agente Windows (versao __AGENT_VERSION__)
# Instala em C:\ProgramData\NexusITAM:
#  - NexusAgent.exe: servico "Nexus ITAM Agent" (SYSTEM: sinal de vida, comandos
#    remotos e inventario) + bandeja na sessao do colaborador (ID de acesso,
#    pedido de suporte e acesso remoto com aviso na tela).
#  - NexusAgent.ps1: coletor de inventario, SEM o token da empresa.
# A maquina e matriculada na empresa uma unica vez; depois disso o token nao fica
# em disco. Pode rodar de novo (GPO de inicializacao, Intune): reaproveita a
# matricula e so atualiza o executavel.
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$InstallDir = Join-Path $env:ProgramData 'NexusITAM'
$ExePath = Join-Path $InstallDir 'NexusAgent.exe'
$ScriptPath = Join-Path $InstallDir 'NexusAgent.ps1'
$ConfigPath = Join-Path $InstallDir 'config.json'
$LogPath = Join-Path $InstallDir 'logs\install.log'
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Utf8Bom = New-Object System.Text.UTF8Encoding($true)

function Show-InstallLog {
  if (Test-Path $LogPath) { Get-Content $LogPath -Tail 8 | ForEach-Object { Write-Host ('  ' + $_) } }
}

if ($Uninstall) {
  if (Test-Path $ExePath) {
    $proc = Start-Process -FilePath $ExePath -ArgumentList '--uninstall' -Wait -PassThru -WindowStyle Hidden
    Write-Host ('Agente Nexus ITAM removido (codigo {0}).' -f $proc.ExitCode)
    exit $proc.ExitCode
  }
  # Agente 2.x/3.0 sem o executavel 3.1.
  Unregister-ScheduledTask -TaskName 'NexusITAM_AgentSync' -Confirm:$false -ErrorAction SilentlyContinue
  Remove-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run' -Name 'NexusITAMAgent' -ErrorAction SilentlyContinue
  Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host 'Agente Nexus ITAM removido.'
  exit 0
}

# Servico e bandeja liberam o executavel antes da troca.
Stop-Service -Name 'NexusITAMAgent' -Force -ErrorAction SilentlyContinue
Get-Process -Name 'NexusAgent' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$AgentCs = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('__AGENT_CS_BASE64__'))
$Collector = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('__AGENT_CODE_BASE64__'))

# Compila com o csc.exe do .NET Framework 4.x que acompanha o Windows.
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'Compilador do .NET Framework 4.x nao encontrado: instale o .NET Framework 4.8.' }

$buildId = [Guid]::NewGuid().ToString('N')
$tempCs = Join-Path $env:TEMP ('NexusAgent_' + $buildId + '.cs')
$tempExe = Join-Path $env:TEMP ('NexusAgent_' + $buildId + '.exe')
try {
  [System.IO.File]::WriteAllText($tempCs, $AgentCs, $Utf8Bom)
  $refs = @('System.dll', 'System.Core.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll', 'System.Web.Extensions.dll',
    'System.Management.dll', 'System.Security.dll', 'System.ServiceProcess.dll') | ForEach-Object { '/r:' + $_ }
  $buildLog = & $csc /nologo /target:winexe /optimize+ ('/out:' + $tempExe) $refs $tempCs 2>&1
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tempExe)) { throw ('Falha ao compilar o NexusAgent.exe: ' + ($buildLog -join ' ')) }
  Move-Item -Path $tempExe -Destination $ExePath -Force
} finally {
  Remove-Item -Path $tempCs, $tempExe -Force -ErrorAction SilentlyContinue
}

[System.IO.File]::WriteAllText($ScriptPath, $Collector, $Utf8Bom)

# O token so fica no config.json ate a matricula: o NexusAgent.exe apaga.
$patrimony = ''
if (Test-Path $ConfigPath) {
  try { $patrimony = [string](Get-Content $ConfigPath -Raw | ConvertFrom-Json).patrimony } catch { }
}
$config = [ordered]@{
  projectId  = '__PROJECT_ID__'
  apiKey     = '__API_KEY__'
  tenantId   = '__TENANT_ID__'
  agentToken = '__AGENT_TOKEN__'
  patrimony  = $patrimony
}
[System.IO.File]::WriteAllText($ConfigPath, ($config | ConvertTo-Json), $Utf8)

$proc = Start-Process -FilePath $ExePath -ArgumentList '--install', '--quiet' -Wait -PassThru -WindowStyle Hidden
if ($proc.ExitCode -ne 0) {
  # Falhou antes da matricula: o token nao pode ficar para tras.
  $config.agentToken = ''
  [System.IO.File]::WriteAllText($ConfigPath, ($config | ConvertTo-Json), $Utf8)
  Write-Host ('Falha na instalacao do agente (codigo {0}). Ultimas linhas do log:' -f $proc.ExitCode)
  Show-InstallLog
  exit $proc.ExitCode
}

Write-Host 'Agente Nexus ITAM __AGENT_VERSION__ instalado: servico "Nexus ITAM Agent" em execucao e bandeja ao lado do relogio.'
Write-Host ('Pasta: {0} | Log: {1}' -f $InstallDir, $LogPath)
