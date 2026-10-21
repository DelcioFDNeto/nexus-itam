#Requires -RunAsAdministrator
# Nexus ITAM - instalador do agente para Windows (versao __AGENT_VERSION__)
# Copia o agente para C:\ProgramData\NexusITAM (legivel so por SYSTEM e
# Administradores: o script carrega o token da empresa) e cria a tarefa
# agendada que roda como SYSTEM na inicializacao, no logon e todo dia.
# Uso em massa: GPO de "Script de inicializacao" ou Intune (contexto de sistema).
# Para remover: execute este mesmo arquivo com o parametro -Uninstall.
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$InstallDir = Join-Path $env:ProgramData 'NexusITAM'
$ScriptPath = Join-Path $InstallDir 'NexusAgent.ps1'
$TaskName = 'NexusITAM_AgentSync'

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host 'Agente Nexus ITAM removido.'
  exit 0
}

$AgentCode = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('__AGENT_CODE_BASE64__'))

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
# So SYSTEM (S-1-5-18) e Administradores (S-1-5-32-544) acessam a pasta.
& icacls.exe $InstallDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
[System.IO.File]::WriteAllText($ScriptPath, $AgentCode, (New-Object System.Text.UTF8Encoding($true)))

$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Scheduled' -f $ScriptPath
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$atStartup = New-ScheduledTaskTrigger -AtStartup
$atStartup.Delay = 'PT5M'
$atLogon = New-ScheduledTaskTrigger -AtLogOn
$atLogon.Delay = 'PT3M'
$daily = New-ScheduledTaskTrigger -Daily -At '12:30'
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($atStartup, $atLogon, $daily) -Settings $settings -Principal $principal -Description 'Inventario de ativos Nexus ITAM' -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host 'Agente Nexus ITAM instalado. A primeira coleta ja comecou; as proximas rodam na inicializacao, no logon e todo dia as 12:30.'
Write-Host ('Log: {0}' -f (Join-Path $InstallDir 'agent.log'))
