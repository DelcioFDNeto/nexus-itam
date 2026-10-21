# Nexus ITAM - Agente de inventario para Windows (versao __AGENT_VERSION__)
# Coleta hardware, sistema, seguranca e softwares desta maquina e envia para a
# fila do Nexus ITAM da empresa. Somente leitura: nao altera nada no computador.
# Compativel com Windows PowerShell 5.1. Rodando como SYSTEM/Administrador
# tambem le BitLocker; como usuario comum, o restante funciona normalmente.
param(
  [switch]$Scheduled,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$AgentVersion = '__AGENT_VERSION__'
$ProjectId = '__PROJECT_ID__'
$ApiKey = '__API_KEY__'
$TenantId = '__TENANT_ID__'
$AgentToken = '__AGENT_TOKEN__'
$FirestoreBase = '__FIRESTORE_BASE__'

# --- log ----------------------------------------------------------------------
$LogFile = Join-Path $env:TEMP 'nexus-agent.log'
try {
  $dataDir = Join-Path $env:ProgramData 'NexusITAM'
  if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }
  $probe = Join-Path $dataDir 'agent.log'
  Add-Content -Path $probe -Value '' -ErrorAction Stop
  $LogFile = $probe
} catch { }

function Write-AgentLog([string]$Message) {
  try {
    if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 512KB)) { Move-Item $LogFile ($LogFile + '.old') -Force }
    Add-Content -Path $LogFile -Value ('{0} {1}' -f (Get-Date).ToString('s'), $Message) -Encoding UTF8
  } catch { }
}

function Get-Safe([scriptblock]$Block) {
  try { & $Block } catch { $null }
}

function ConvertTo-IsoDate($Value) {
  if (-not $Value) { return '' }
  try { return ([datetime]$Value).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') } catch { return '' }
}

function ConvertFrom-WmiString($Codes) {
  if (-not $Codes) { return '' }
  $bytes = [byte[]]@($Codes | Where-Object { $_ -ne 0 -and $_ -lt 256 })
  if ($bytes.Length -eq 0) { return '' }
  return ([System.Text.Encoding]::ASCII.GetString($bytes)).Trim()
}

# --- coleta -------------------------------------------------------------------
function Get-LoggedUser($ComputerSystem) {
  $user = Get-Safe { [string]$ComputerSystem.UserName }
  if (-not $user) {
    # Sessao remota ou tarefa como SYSTEM: o dono do explorer.exe e quem esta usando.
    $user = Get-Safe {
      $proc = Get-CimInstance Win32_Process -Filter "Name = 'explorer.exe'" | Select-Object -First 1
      if ($proc) {
        $owner = Invoke-CimMethod -InputObject $proc -MethodName GetOwner
        if ($owner.User) { '{0}\{1}' -f $owner.Domain, $owner.User }
      }
    }
  }
  if (-not $user -and $env:USERNAME -and $env:USERNAME -notmatch '\$$' -and $env:USERNAME -ne 'SYSTEM') {
    $user = '{0}\{1}' -f $env:USERDOMAIN, $env:USERNAME
  }
  return [string]$user
}

function Get-InstalledSoftware {
  $paths = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  # Programas instalados por usuario (Teams, Chrome do usuario...) das sessoes abertas.
  Get-Safe { Get-ChildItem 'Registry::HKEY_USERS' -ErrorAction SilentlyContinue } | Where-Object { $_.PSChildName -match '^S-1-5-21-[\d-]+$' } | ForEach-Object {
    $paths += ('Registry::HKEY_USERS\{0}\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -f $_.PSChildName)
  }
  $items = Get-ItemProperty -Path $paths -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -and $_.SystemComponent -ne 1 -and -not $_.ParentKeyName -and $_.DisplayName -notmatch '^(Update for|Security Update|Hotfix|Atualiza)' }
  $seen = @{}
  $list = New-Object System.Collections.ArrayList
  foreach ($item in ($items | Sort-Object DisplayName)) {
    $name = ([string]$item.DisplayName).Trim()
    $key = $name.ToLowerInvariant() + '|' + [string]$item.DisplayVersion
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = $true
    [void]$list.Add([ordered]@{ name = $name; version = [string]$item.DisplayVersion; publisher = [string]$item.Publisher })
    if ($list.Count -ge 800) { break }
  }
  return ,$list.ToArray()
}

function Get-Inventory {
  $os = Get-Safe { Get-CimInstance Win32_OperatingSystem }
  $cs = Get-Safe { Get-CimInstance Win32_ComputerSystem }
  $csp = Get-Safe { Get-CimInstance Win32_ComputerSystemProduct }
  $bios = Get-Safe { Get-CimInstance Win32_BIOS }
  $board = Get-Safe { Get-CimInstance Win32_BaseBoard }
  $enclosure = Get-Safe { Get-CimInstance Win32_SystemEnclosure | Select-Object -First 1 }
  $cpu = Get-Safe { Get-CimInstance Win32_Processor | Select-Object -First 1 }
  $ramBytes = Get-Safe { (Get-CimInstance Win32_PhysicalMemory | Measure-Object -Property Capacity -Sum).Sum }
  if (-not $ramBytes) { $ramBytes = Get-Safe { $cs.TotalPhysicalMemory } }
  $gpu = Get-Safe { (@(Get-CimInstance Win32_VideoController | Where-Object { $_.Name } | ForEach-Object { [string]$_.Name }) -join ', ') }
  $machineGuid = Get-Safe { [string](Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid).MachineGuid }

  $serial = Get-Safe { ([string]$bios.SerialNumber).Trim() }
  $uuid = Get-Safe { ([string]$csp.UUID).Trim() }
  $deviceId = $machineGuid
  if (-not $deviceId) { $deviceId = $uuid }

  # Chave do documento na fila: uma por maquina fisica (clones sem sysprep
  # repetem o MachineGuid, mas nao o serial/UUID da placa).
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $hash = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes(('{0}|{1}|{2}' -f $deviceId, $serial, $uuid).ToUpperInvariant()))
  $deviceKey = (@($hash | Select-Object -First 16 | ForEach-Object { $_.ToString('x2') }) -join '')

  $network = @(Get-Safe { Get-CimInstance Win32_NetworkAdapterConfiguration -Filter 'IPEnabled = True' } | Where-Object { $_ -and $_.MACAddress } | ForEach-Object {
    [ordered]@{
      name = [string]$_.Description
      mac = [string]$_.MACAddress
      ip = [string](@($_.IPAddress | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' }) | Select-Object -First 1)
      gateway = [string](@($_.DefaultIPGateway | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' }) | Select-Object -First 1)
    }
  })

  $mediaByIndex = @{}
  foreach ($pd in @(Get-Safe { Get-PhysicalDisk })) { if ($pd) { $mediaByIndex[[string]$pd.DeviceId] = [string]$pd.MediaType } }
  $disks = @(Get-Safe { Get-CimInstance Win32_DiskDrive } | Where-Object { $_ } | ForEach-Object {
    [ordered]@{
      model = ([string]$_.Model).Trim()
      sizeGb = [math]::Round(([double]$_.Size) / 1GB, 0)
      serial = ([string]$_.SerialNumber).Trim()
      media = [string]$mediaByIndex[[string]$_.Index]
    }
  })

  $bitlocker = @{}
  foreach ($vol in @(Get-Safe { Get-CimInstance -Namespace 'root\cimv2\security\microsoftvolumeencryption' -ClassName Win32_EncryptableVolume })) {
    if ($vol -and $vol.DriveLetter) { $bitlocker[[string]$vol.DriveLetter] = ([int]$vol.ProtectionStatus -eq 1) }
  }
  $volumes = @(Get-Safe { Get-CimInstance Win32_LogicalDisk -Filter 'DriveType = 3' } | Where-Object { $_ -and $_.Size } | ForEach-Object {
    $encrypted = $null
    if ($bitlocker.ContainsKey([string]$_.DeviceID)) { $encrypted = $bitlocker[[string]$_.DeviceID] }
    [ordered]@{
      drive = [string]$_.DeviceID
      label = [string]$_.VolumeName
      sizeGb = [math]::Round(([double]$_.Size) / 1GB, 1)
      freeGb = [math]::Round(([double]$_.FreeSpace) / 1GB, 1)
      encrypted = $encrypted
    }
  })

  $antivirus = @(Get-Safe { Get-CimInstance -Namespace 'root\SecurityCenter2' -ClassName AntivirusProduct } | Where-Object { $_ } | ForEach-Object {
    $hex = '{0:X6}' -f [int]$_.productState
    [ordered]@{
      name = [string]$_.displayName
      enabled = (@('10', '11') -contains $hex.Substring(2, 2))
      upToDate = ($hex.Substring(4, 2) -eq '00')
    }
  })
  if ($antivirus.Count -eq 0) {
    # Windows Server nao tem Central de Seguranca: consulta o Defender direto.
    $mp = Get-Safe { Get-MpComputerStatus }
    if ($mp) {
      $antivirus = @([ordered]@{
        name = 'Microsoft Defender'
        enabled = ([bool]$mp.AntivirusEnabled -and [bool]$mp.RealTimeProtectionEnabled)
        upToDate = ([int]$mp.AntivirusSignatureAge -le 7)
      })
    }
  }

  $firewall = ''
  $profiles = Get-Safe { Get-NetFirewallProfile }
  if ($profiles) {
    $on = @($profiles | Where-Object { [string]$_.Enabled -eq 'True' } | ForEach-Object { [string]$_.Name })
    if ($on.Count -gt 0) { $firewall = $on -join ', ' } else { $firewall = 'Desativado' }
  }

  $admins = @(Get-Safe { Get-LocalGroupMember -SID 'S-1-5-32-544' } | Where-Object { $_ } | ForEach-Object { [string]$_.Name })
  $lastUpdate = Get-Safe { (Get-HotFix -ErrorAction SilentlyContinue | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending | Select-Object -First 1).InstalledOn }
  $pendingReboot = (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending') -or
    (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired')

  $monitors = @(Get-Safe { Get-CimInstance -Namespace 'root\wmi' -ClassName WmiMonitorID } | Where-Object { $_ } | ForEach-Object {
    [ordered]@{
      manufacturer = ConvertFrom-WmiString $_.ManufacturerName
      model = ConvertFrom-WmiString $_.UserFriendlyName
      serial = ConvertFrom-WmiString $_.SerialNumberID
    }
  })

  $battery = $null
  $design = Get-Safe { (Get-CimInstance -Namespace 'root\wmi' -ClassName BatteryStaticData | Select-Object -First 1).DesignedCapacity }
  $full = Get-Safe { (Get-CimInstance -Namespace 'root\wmi' -ClassName BatteryFullChargedCapacity | Select-Object -First 1).FullChargedCapacity }
  if ($design -and $full) { $battery = [ordered]@{ designCapacity = [double]$design; fullCapacity = [double]$full } }

  return [ordered]@{
    deviceKey = $deviceKey
    agentVersion = $AgentVersion
    deviceId = [string]$deviceId
    hostname = [string]$env:COMPUTERNAME
    domain = [string]$cs.Domain
    loggedUser = Get-LoggedUser $cs
    collectedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    serialNumber = [string]$serial
    assetTag = ([string]$enclosure.SMBIOSAssetTag).Trim()
    os = [ordered]@{
      name = [string]$os.Caption
      version = [string]$os.Version
      build = [string]$os.BuildNumber
      arch = [string]$os.OSArchitecture
      installDate = ConvertTo-IsoDate $os.InstallDate
      lastBoot = ConvertTo-IsoDate $os.LastBootUpTime
    }
    hardware = [ordered]@{
      manufacturer = ([string]$cs.Manufacturer).Trim()
      model = ([string]$cs.Model).Trim()
      board = ([string]$board.Product).Trim()
      processor = ([string]$cpu.Name).Trim()
      cores = [int]$cpu.NumberOfCores
      ramGb = [math]::Round(([double]$ramBytes) / 1GB, 1)
      gpu = [string]$gpu
      biosVersion = [string]$bios.SMBIOSBIOSVersion
      pc_system_type = [int]$cs.PCSystemType
      chassis_types = (@($enclosure.ChassisTypes) -join ',')
      smbios_uuid = [string]$uuid
      chassis_serial = ([string]$enclosure.SerialNumber).Trim()
    }
    network = $network
    disks = $disks
    volumes = $volumes
    monitors = $monitors
    battery = $battery
    security = [ordered]@{
      antivirus = $antivirus
      firewall = $firewall
      localAdmins = $admins
      lastUpdate = ConvertTo-IsoDate $lastUpdate
      pendingReboot = [bool]$pendingReboot
    }
    software = Get-InstalledSoftware
  }
}

# --- envio (Firestore REST) ---------------------------------------------------
function ConvertTo-FirestoreValue($Value) {
  if ($null -eq $Value) { return @{ nullValue = $null } }
  if ($Value -is [string]) { return @{ stringValue = $Value } }
  if ($Value -is [bool]) { return @{ booleanValue = $Value } }
  if ($Value -is [datetime]) { return @{ timestampValue = $Value.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') } }
  if ($Value -is [byte] -or $Value -is [int16] -or $Value -is [uint16] -or $Value -is [int] -or $Value -is [uint32] -or $Value -is [long] -or $Value -is [uint64]) {
    return @{ integerValue = [string]$Value }
  }
  if ($Value -is [double] -or $Value -is [single] -or $Value -is [decimal]) { return @{ doubleValue = [double]$Value } }
  if ($Value -is [System.Collections.IDictionary]) {
    $fields = [ordered]@{}
    foreach ($key in $Value.Keys) { $fields[[string]$key] = ConvertTo-FirestoreValue $Value[$key] }
    return @{ mapValue = @{ fields = $fields } }
  }
  if ($Value -is [System.Collections.IEnumerable]) {
    $values = @(foreach ($item in $Value) { ConvertTo-FirestoreValue $item })
    return @{ arrayValue = @{ values = $values } }
  }
  return @{ stringValue = [string]$Value }
}

function Send-Inventory($Inventory, [string]$DeviceKey) {
  $primary = @($Inventory.network | Where-Object { $_.gateway }) | Select-Object -First 1
  if (-not $primary) { $primary = @($Inventory.network) | Select-Object -First 1 }
  $primaryIp = ''
  if ($primary) { $primaryIp = [string]$primary.ip }

  $document = @{
    fields = [ordered]@{
      tenantId = @{ stringValue = $TenantId }
      agentToken = @{ stringValue = $AgentToken }
      deviceKey = @{ stringValue = $DeviceKey }
      status = @{ stringValue = 'pending' }
      source = @{ stringValue = 'Agente ITAM Windows' }
      agentVersion = @{ stringValue = $AgentVersion }
      hostname = @{ stringValue = [string]$Inventory.hostname }
      serialNumber = @{ stringValue = [string]$Inventory.serialNumber }
      deviceId = @{ stringValue = [string]$Inventory.deviceId }
      internalId = @{ stringValue = '' }
      ip_address = @{ stringValue = $primaryIp }
      createdAt = @{ timestampValue = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') }
      payload = ConvertTo-FirestoreValue $Inventory
    }
  }
  $json = ConvertTo-Json -InputObject $document -Depth 40 -Compress
  # Corpo em UTF-8: o PowerShell 5.1 mandaria em Latin-1 e o Firestore recusaria
  # nomes de programas com acento.
  $body = [System.Text.Encoding]::UTF8.GetBytes($json)
  $uri = '{0}/projects/{1}/databases/(default)/documents/agentInbox/{2}_{3}?key={4}' -f $FirestoreBase, $ProjectId, $TenantId, $DeviceKey, $ApiKey
  Invoke-RestMethod -Method Patch -Uri $uri -Body $body -ContentType 'application/json; charset=utf-8' -TimeoutSec 60 | Out-Null
}

function Get-HttpError($ErrorRecord) {
  $message = $ErrorRecord.Exception.Message
  try {
    $stream = $ErrorRecord.Exception.Response.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($stream)
    $detail = $reader.ReadToEnd()
    if ($detail) { $message = $message + ' ' + $detail.Substring(0, [Math]::Min(300, $detail.Length)) }
  } catch { }
  return $message
}

# --- principal ----------------------------------------------------------------
$exitCode = 1
try {
  # Windows antigos negociam TLS 1.0 por padrao; o Google exige 1.2.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  try { [Net.WebRequest]::DefaultWebProxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials } catch { }

  if ($Scheduled) { Start-Sleep -Seconds (Get-Random -Minimum 0 -Maximum 240) }

  $inventory = Get-Inventory
  $deviceKey = [string]$inventory.deviceKey
  $inventory.Remove('deviceKey')

  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      Send-Inventory $inventory $deviceKey
      Write-AgentLog ('OK {0} ({1} programas)' -f $inventory.hostname, @($inventory.software).Count)
      Write-Host ('Inventario de {0} enviado ao Nexus ITAM.' -f $inventory.hostname)
      $exitCode = 0
      break
    } catch {
      $detail = Get-HttpError $_
      Write-AgentLog ('Falha no envio (tentativa {0} de 3) - {1}' -f $attempt, $detail)
      if ($attempt -lt 3) { Start-Sleep -Seconds (15 * $attempt) }
    }
  }
  if ($exitCode -ne 0) { Write-Host ('Nao foi possivel enviar o inventario. Detalhes em {0}' -f $LogFile) }
} catch {
  Write-AgentLog ('Erro: {0}' -f $_.Exception.Message)
  Write-Host ('Erro no agente: {0}' -f $_.Exception.Message)
  $exitCode = 2
}

if (-not $Scheduled -and -not $NoPause -and $Host.Name -eq 'ConsoleHost') { Start-Sleep -Seconds 5 }
exit $exitCode
