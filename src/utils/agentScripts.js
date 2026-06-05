export const buildWindowsScript = (projectId, apiKey, tenantId, agentToken, mode = 'portable') => {
  const baseScript = `
$ProjectId = "${projectId}"
$ApiKey = "${apiKey}"
$TenantId = "${tenantId}"
$AgentToken = "${agentToken}"

function Get-ItamPayload {
  $ErrorActionPreference = "SilentlyContinue"
  $os = Get-CimInstance Win32_OperatingSystem
  $sys = Get-CimInstance Win32_ComputerSystem
  $bios = Get-CimInstance Win32_BIOS
  $board = Get-CimInstance Win32_BaseBoard
  $cpu = Get-CimInstance Win32_Processor
  $rams = Get-CimInstance Win32_PhysicalMemory
  $netAdapter = Get-CimInstance Win32_NetworkAdapterConfiguration | Where-Object { $_.IPEnabled -eq $true } | Select-Object -First 1
  $disks = Get-CimInstance Win32_DiskDrive | ForEach-Object {
    $size = if ($_.Size) { [math]::Round($_.Size / 1GB, 2) } else { 0 }
    "$($_.Model) ($size GB) Serial: $($_.SerialNumber)"
  }

  $softwareList = @()
  $softwareList += Get-ItemProperty HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* | Where-Object { $_.DisplayName } | Select-Object -ExpandProperty DisplayName
  $softwareList += Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* | Where-Object { $_.DisplayName } | Select-Object -ExpandProperty DisplayName
  $softwareList = $softwareList | Sort-Object -Unique

  $avList = Get-CimInstance -Namespace root\\SecurityCenter2 -Class AntivirusProduct | Select-Object -ExpandProperty displayName
  $fwList = Get-NetFirewallProfile | Where-Object { $_.Enabled -eq $true } | Select-Object -ExpandProperty Name

  $monitorsList = Get-CimInstance Win32_DesktopMonitor | Where-Object { $_.Availability -ne $null -and $_.Name -ne 'Monitor Genérico' } | Select-Object -ExpandProperty Name

  return @{
    hostname = $env:COMPUTERNAME
    usuario_logado = $env:USERNAME
    mac_address = if ($netAdapter -and $netAdapter.MACAddress) { $netAdapter.MACAddress } else { "" }
    ip_address = if ($netAdapter -and $netAdapter.IPAddress) { $netAdapter.IPAddress[0] } else { "" }
    sistema_operacional = "$($os.Caption) $($os.OSArchitecture)"
    data_coleta = (Get-Date).ToString("o")
    software = if ($softwareList) { $softwareList -join "||" } else { "" }
    security = @{
      antivirus = if ($avList) { $avList -join ", " } else { "Nenhum detectado" }
      firewall = if ($fwList) { $fwList -join ", " } else { "Desativado" }
    }
    monitors = if ($monitorsList) { $monitorsList -join "||" } else { "" }
    hardware = @{
      fabricante = $sys.Manufacturer
      modelo_sistema = $sys.Model
      modelo_placa = $board.Product
      placa_mae_serial = $board.SerialNumber
      bios_serial = $bios.SerialNumber
      pc_system_type = $sys.PCSystemType
      chassis_types = ($sys.ChassisSKUNumber, ((Get-CimInstance Win32_SystemEnclosure).ChassisTypes -join ",")) -join "|"
      processador = $cpu.Name
      ram_gb = if ($rams) { [math]::Round(($rams | Measure-Object Capacity -Sum).Sum / 1GB, 2) } else { 0 }
      storage = ($disks -join " | ")
    }
  }
}

function ConvertTo-FirestoreValue {
  param($Value)
  if ($null -eq $Value) { return @{ nullValue = $null } }
  if ($Value -is [hashtable]) {
    $fields = @{}
    foreach ($key in $Value.Keys) { $fields[$key] = ConvertTo-FirestoreValue $Value[$key] }
    return @{ mapValue = @{ fields = $fields } }
  }
  if ($Value -is [int] -or $Value -is [long]) { return @{ integerValue = "$Value" } }
  if ($Value -is [double] -or $Value -is [decimal] -or $Value -is [float]) { return @{ doubleValue = [double]$Value } }
  if ($Value -is [bool]) { return @{ booleanValue = $Value } }
  return @{ stringValue = [string]$Value }
}

function Send-ItamPayload {
  param($Payload)
  $endpoint = "https://firestore.googleapis.com/v1/projects/$ProjectId/databases/(default)/documents/agentInbox?key=$ApiKey"
  $document = @{
    fields = @{
      payload = ConvertTo-FirestoreValue $Payload
      source = @{ stringValue = "Agente ITAM PowerShell" }
      status = @{ stringValue = "pending" }
      hostname = @{ stringValue = [string]$Payload.hostname }
      internalId = @{ stringValue = "" }
      serialNumber = @{ stringValue = [string]$Payload.hardware.bios_serial }
      createdAt = @{ stringValue = (Get-Date).ToString("o") }
      tenantId = @{ stringValue = $TenantId }
      agentToken = @{ stringValue = $AgentToken }
      ip_address = @{ stringValue = [string]$Payload.ip_address }
    }
  }
  $body = $document | ConvertTo-Json -Depth 20
  Invoke-RestMethod -Method Post -Uri $endpoint -Body $body -ContentType "application/json" | Out-Null
}

$payload = Get-ItamPayload
try {
  Send-ItamPayload $payload
} catch {
  Write-Warning "Falha ao enviar."
}
`;

  if (mode === 'service') {
    return `# Agente ITAM - Auto Instalador de Serviço (Scheduled Task)
Requires -RunAsAdministrator

$InstallDir = "C:\\ProgramData\\NexusITAM"
$ScriptPath = Join-Path $InstallDir "NexusAgent.ps1"
$TaskName = "NexusITAM_AgentSync"

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
}

$AgentCode = @"
\${baseScript}
"@

$AgentCode | Out-File -FilePath $ScriptPath -Encoding UTF8 -Force

$Action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File \\"$ScriptPath\\""
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -Hidden
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Force | Out-Null

Write-Host "Agente instalado com sucesso."
`;
  }

  return `# Agente ITAM Ativo - Portatil\n${baseScript}`;
};

export const buildLinuxScript = (projectId, apiKey, tenantId, agentToken, mode = 'portable') => {
  const baseScript = `#!/bin/bash
# Agente ITAM Linux

PROJECT_ID="${projectId}"
API_KEY="${apiKey}"
TENANT_ID="${tenantId}"
AGENT_TOKEN="${agentToken}"

HOSTNAME=$(hostname)
USER_LOGGED=$(who | awk '{print $1}' | head -n 1)
MAC_ADDR=$(ip link | awk '/ether/ {print $2}' | head -n 1)
IP_ADDR=$(hostname -I | awk '{print $1}')
OS_CAPTION=$(grep PRETTY_NAME /etc/os-release | cut -d '"' -f 2)

# Hardware
MFG=$(cat /sys/class/dmi/id/sys_vendor 2>/dev/null || echo "Desconhecido")
MODEL=$(cat /sys/class/dmi/id/product_name 2>/dev/null || echo "Desconhecido")
BOARD=$(cat /sys/class/dmi/id/board_name 2>/dev/null || echo "Desconhecido")
SERIAL=$(cat /sys/class/dmi/id/product_serial 2>/dev/null || echo "Desconhecido")
BIOS=$(cat /sys/class/dmi/id/bios_version 2>/dev/null || echo "Desconhecido")
CPU=$(grep "model name" /proc/cpuinfo | head -n 1 | cut -d ":" -f 2 | sed 's/^ //g')
RAM_TOTAL=$(free -m | awk '/^Mem:/{print $2}')
RAM_GB=$(awk "BEGIN {print $RAM_TOTAL/1024}")
DISKS=$(df -h --output=source,size / | tail -n 1 | awk '{print $1 " (" $2 ")"}')

# Software
if command -v dpkg &> /dev/null; then
    SOFTWARES=$(dpkg-query -W -f='\${Package}\\n' | paste -sd "||" -)
elif command -v rpm &> /dev/null; then
    SOFTWARES=$(rpm -qa | paste -sd "||" -)
else
    SOFTWARES=""
fi

DATE_NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

PAYLOAD=$(cat <<EOF
{
  "fields": {
    "payload": {
      "mapValue": {
        "fields": {
          "hostname": { "stringValue": "$HOSTNAME" },
          "usuario_logado": { "stringValue": "$USER_LOGGED" },
          "mac_address": { "stringValue": "$MAC_ADDR" },
          "ip_address": { "stringValue": "$IP_ADDR" },
          "sistema_operacional": { "stringValue": "$OS_CAPTION" },
          "data_coleta": { "stringValue": "$DATE_NOW" },
          "software": { "stringValue": "$SOFTWARES" },
          "hardware": {
            "mapValue": {
              "fields": {
                "fabricante": { "stringValue": "$MFG" },
                "modelo_sistema": { "stringValue": "$MODEL" },
                "modelo_placa": { "stringValue": "$BOARD" },
                "placa_mae_serial": { "stringValue": "$SERIAL" },
                "bios_serial": { "stringValue": "$BIOS" },
                "processador": { "stringValue": "$CPU" },
                "ram_gb": { "doubleValue": $RAM_GB },
                "storage": { "stringValue": "$DISKS" }
              }
            }
          }
        }
      }
    },
    "source": { "stringValue": "Agente ITAM Bash (Linux)" },
    "status": { "stringValue": "pending" },
    "hostname": { "stringValue": "$HOSTNAME" },
    "internalId": { "stringValue": "" },
    "serialNumber": { "stringValue": "$SERIAL" },
    "createdAt": { "stringValue": "$DATE_NOW" },
    "tenantId": { "stringValue": "$TENANT_ID" },
    "agentToken": { "stringValue": "$AGENT_TOKEN" },
    "ip_address": { "stringValue": "$IP_ADDR" }
  }
}
EOF
)

curl -s -X POST "https://firestore.googleapis.com/v1/projects/$PROJECT_ID/databases/(default)/documents/agentInbox?key=$API_KEY" \\
  -H "Content-Type: application/json" \\
  -d "$PAYLOAD" > /dev/null

`;

  if (mode === 'service') {
    return `#!/bin/bash
# Instala o script no crontab para rodar a cada boot
SCRIPT_PATH="/usr/local/bin/nexus-agent.sh"
cat << 'EOFAGENT' > $SCRIPT_PATH
${baseScript}
EOFAGENT
chmod +x $SCRIPT_PATH
(crontab -l 2>/dev/null; echo "@reboot $SCRIPT_PATH") | crontab -
echo "Agente instalado no crontab."
`;
  }

  return baseScript;
};

export const buildMacScript = (projectId, apiKey, tenantId, agentToken, mode = 'portable') => {
  const baseScript = `#!/bin/bash
# Agente ITAM macOS

PROJECT_ID="${projectId}"
API_KEY="${apiKey}"
TENANT_ID="${tenantId}"
AGENT_TOKEN="${agentToken}"

HOSTNAME=$(scutil --get LocalHostName)
USER_LOGGED=$(whoami)
MAC_ADDR=$(ifconfig en0 | grep ether | awk '{print $2}')
IP_ADDR=$(ipconfig getifaddr en0)
OS_CAPTION=$(sw_vers -productName) $(sw_vers -productVersion)

MFG="Apple Inc."
MODEL=$(system_profiler SPHardwareDataType | grep "Model Identifier" | awk -F': ' '{print $2}')
SERIAL=$(system_profiler SPHardwareDataType | grep "Serial Number" | awk -F': ' '{print $2}')
CPU=$(system_profiler SPHardwareDataType | grep "Processor Name" | awk -F': ' '{print $2}')
if [ -z "$CPU" ]; then CPU=$(system_profiler SPHardwareDataType | grep "Chip" | awk -F': ' '{print $2}'); fi
RAM_GB=$(system_profiler SPHardwareDataType | grep "Memory" | awk '{print $2}')
DISKS=$(system_profiler SPStorageDataType | grep "Capacity" | head -n 1 | awk -F': ' '{print $2}')

# Softwares instalados (/Applications)
SOFTWARES=$(ls /Applications | sed 's/.app//g' | paste -sd "||" -)

DATE_NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

PAYLOAD=$(cat <<EOF
{
  "fields": {
    "payload": {
      "mapValue": {
        "fields": {
          "hostname": { "stringValue": "$HOSTNAME" },
          "usuario_logado": { "stringValue": "$USER_LOGGED" },
          "mac_address": { "stringValue": "$MAC_ADDR" },
          "ip_address": { "stringValue": "$IP_ADDR" },
          "sistema_operacional": { "stringValue": "$OS_CAPTION" },
          "data_coleta": { "stringValue": "$DATE_NOW" },
          "software": { "stringValue": "$SOFTWARES" },
          "hardware": {
            "mapValue": {
              "fields": {
                "fabricante": { "stringValue": "$MFG" },
                "modelo_sistema": { "stringValue": "$MODEL" },
                "modelo_placa": { "stringValue": "$MODEL" },
                "placa_mae_serial": { "stringValue": "$SERIAL" },
                "bios_serial": { "stringValue": "$SERIAL" },
                "processador": { "stringValue": "$CPU" },
                "ram_gb": { "doubleValue": $RAM_GB },
                "storage": { "stringValue": "$DISKS" }
              }
            }
          }
        }
      }
    },
    "source": { "stringValue": "Agente ITAM Bash (macOS)" },
    "status": { "stringValue": "pending" },
    "hostname": { "stringValue": "$HOSTNAME" },
    "internalId": { "stringValue": "" },
    "serialNumber": { "stringValue": "$SERIAL" },
    "createdAt": { "stringValue": "$DATE_NOW" },
    "tenantId": { "stringValue": "$TENANT_ID" },
    "agentToken": { "stringValue": "$AGENT_TOKEN" },
    "ip_address": { "stringValue": "$IP_ADDR" }
  }
}
EOF
)

curl -s -X POST "https://firestore.googleapis.com/v1/projects/$PROJECT_ID/databases/(default)/documents/agentInbox?key=$API_KEY" \\
  -H "Content-Type: application/json" \\
  -d "$PAYLOAD" > /dev/null

`;

  if (mode === 'service') {
    return `#!/bin/bash
# Instala o script via LaunchDaemon
PLIST_PATH="/Library/LaunchDaemons/com.nexus.agent.plist"
SCRIPT_PATH="/usr/local/bin/nexus-agent.sh"

sudo cat << 'EOFAGENT' > $SCRIPT_PATH
${baseScript}
EOFAGENT
sudo chmod +x $SCRIPT_PATH

sudo cat << 'EOFPLIST' > $PLIST_PATH
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.nexus.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>$SCRIPT_PATH</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
EOFPLIST

sudo launchctl load $PLIST_PATH
echo "Agente instalado como LaunchDaemon no macOS."
`;
  }

  return baseScript;
};
