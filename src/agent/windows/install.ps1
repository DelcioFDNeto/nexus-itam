#Requires -RunAsAdministrator
# Nexus ITAM - Instalador Completo do Agente Nativo Windows + Acesso Remoto (versao __AGENT_VERSION__)
# Instala:
#  1. C:\ProgramData\NexusITAM\NexusAgent.exe (Aplicativo Nativo de Bandeja, Telemetria, Terminal e Acesso Remoto)
#  2. C:\ProgramData\NexusITAM\NexusAgent.ps1 (Coletor profundo de inventario WMI/CIM)
#  3. C:\ProgramData\NexusITAM\config.json (Credenciais do Tenant)
#  4. Atalho na Area de Trabalho Publica + Inicializacao Automatica + Tarefa Agendada SYSTEM
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$InstallDir = Join-Path $env:ProgramData 'NexusITAM'
$ScriptPath = Join-Path $InstallDir 'NexusAgent.ps1'
$ExePath    = Join-Path $InstallDir 'NexusAgent.exe'
$ConfigPath = Join-Path $InstallDir 'config.json'
$TaskName   = 'NexusITAM_AgentSync'

if ($Uninstall) {
  Get-Process -Name 'NexusAgent' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Remove-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run' -Name 'NexusITAMAgent' -ErrorAction SilentlyContinue
  $pubDesk = [Environment]::GetFolderPath('CommonDesktopDirectory')
  if ($pubDesk) {
    Remove-Item -Path (Join-Path $pubDesk 'Nexus ITAM - Suporte e Agente.lnk') -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host 'Agente Nexus ITAM removido com sucesso.'
  exit 0
}

Get-Process -Name 'NexusAgent' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$AgentCode = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('__AGENT_CODE_BASE64__'))
$AgentCs   = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('__AGENT_CS_BASE64__'))

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# Grava config.json para o executavel nativo (RMM e Acesso Remoto)
$ConfigJson = @{
  projectId         = '__PROJECT_ID__'
  tenantId          = '__TENANT_ID__'
  agentToken        = '__AGENT_TOKEN__'
  patrimony         = ''
  serverUrl         = 'https://itam-nexus.web.app'
  unattendedEnabled = $true
} | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($ConfigPath, $ConfigJson, (New-Object System.Text.UTF8Encoding($false)))

# Grava script de inventario profundo
[System.IO.File]::WriteAllText($ScriptPath, $AgentCode, (New-Object System.Text.UTF8Encoding($true)))

# Compila o executavel nativo NexusAgent.exe usando o compilador .NET nativo do Windows
$cscPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $cscPath)) {
  $cscPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (Test-Path $cscPath) {
  $tempCs = Join-Path $env:TEMP ('NexusAgentBuild_' + [Guid]::NewGuid().ToString('N') + '.cs')
  try {
    [System.IO.File]::WriteAllText($tempCs, $AgentCs, (New-Object System.Text.UTF8Encoding($true)))
    & $cscPath /nologo /target:winexe /optimize+ /out:$ExePath /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll $tempCs | Out-Null
  } finally {
    Remove-Item -Path $tempCs -Force -ErrorAction SilentlyContinue
  }
}

# Permissoes: SYSTEM e Administradores com controle total; Usuarios locais com leitura/execucao para o aplicativo de bandeja e acesso remoto
& icacls.exe $InstallDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null

# Registra o aplicativo nativo na inicializacao da sessao do usuario e cria atalho na Area de Trabalho
if (Test-Path $ExePath) {
  Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run' -Name 'NexusITAMAgent' -Value ('"{0}" --silent' -f $ExePath) -Force
  try {
    $pubDesk = [Environment]::GetFolderPath('CommonDesktopDirectory')
    if ($pubDesk) {
      $shell = New-Object -ComObject WScript.Shell
      $shortcut = $shell.CreateShortcut((Join-Path $pubDesk 'Nexus ITAM - Suporte e Agente.lnk'))
      $shortcut.TargetPath = $ExePath
      $shortcut.WorkingDirectory = $InstallDir
      $shortcut.Description = 'Abrir Agente Nexus ITAM - ID de Acesso Remoto e Suporte de TI'
      $shortcut.Save()
    }
  } catch { }
}

# Registra tarefa agendada SYSTEM para coleta periodica de inventario completo
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Scheduled' -f $ScriptPath
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$atStartup = New-ScheduledTaskTrigger -AtStartup
$atStartup.Delay = 'PT5M'
$atLogon = New-ScheduledTaskTrigger -AtLogOn
$atLogon.Delay = 'PT3M'
$daily = New-ScheduledTaskTrigger -Daily -At '12:30'
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($atStartup, $atLogon, $daily) -Settings $settings -Principal $principal -Description 'Inventario de ativos e RMM Nexus ITAM' -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

# Inicia imediatamente o aplicativo nativo NexusAgent.exe na sessao atual
if (Test-Path $ExePath) {
  Start-Process -FilePath $ExePath -WorkingDirectory $InstallDir
}

Write-Host 'Agente Nexus ITAM (Executavel Nativo + Acesso Remoto + Inventario) instalado com sucesso!'
Write-Host ('Executavel: {0}' -f $ExePath)
Write-Host ('Log: {0}' -f (Join-Path $InstallDir 'agent.log'))
