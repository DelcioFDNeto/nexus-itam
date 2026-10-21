#!/bin/bash
# Nexus ITAM - Agente de inventario para macOS (versao __AGENT_VERSION__)
# Coleta hardware, sistema, seguranca e aplicativos e envia para a fila do
# Nexus ITAM da empresa. Somente leitura. Compativel com o bash 3.2 do macOS.
export LC_ALL=C

AGENT_VERSION='__AGENT_VERSION__'
PROJECT_ID='__PROJECT_ID__'
API_KEY='__API_KEY__'
TENANT_ID='__TENANT_ID__'
AGENT_TOKEN='__AGENT_TOKEN__'
FIRESTORE_BASE='__FIRESTORE_BASE__'

LOG_FILE=/var/log/nexus-agent.log
{ : >> "$LOG_FILE"; } 2>/dev/null || LOG_FILE="${TMPDIR:-/tmp}/nexus-agent.log"
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG_FILE" 2>/dev/null; }

esc() { printf '%s' "$1" | tr '\r\n\t' '   ' | tr -d '\000-\037' | sed 's/\\/\\\\/g; s/"/\\"/g'; }
str() { printf '{"stringValue":"%s"}' "$(esc "$1")"; }
num() { case "$1" in ''|*[!0-9.]*|*.*.*) printf '{"nullValue":null}' ;; *) printf '{"doubleValue":%s}' "$1" ;; esac; }
bool() { case "$1" in true) printf '{"booleanValue":true}' ;; false) printf '{"booleanValue":false}' ;; *) printf '{"nullValue":null}' ;; esac; }
map() {
  local out='' sep=''
  while [ $# -ge 2 ]; do out="$out$sep\"$1\":$2"; sep=','; shift 2; done
  printf '{"mapValue":{"fields":{%s}}}' "$out"
}
arr() {
  local out='' sep='' v
  for v in "$@"; do out="$out$sep$v"; sep=','; done
  printf '{"arrayValue":{"values":[%s]}}' "$out"
}
iso_from_epoch() { [ -n "$1" ] && date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null; }
platform() { ioreg -rd1 -c IOPlatformExpertDevice 2>/dev/null | awk -F'"' -v k="$1" '$2 == k {print $4; exit}'; }

[ "$1" = "--scheduled" ] && sleep $((RANDOM % 240))

# --- identidade --------------------------------------------------------------------
HOST_NAME=$(scutil --get ComputerName 2>/dev/null || hostname)
DEVICE_ID=$(platform IOPlatformUUID)
SERIAL=$(platform IOPlatformSerialNumber)
DEVICE_KEY=$(printf '%s|%s' "$DEVICE_ID" "$SERIAL" | tr '[:lower:]' '[:upper:]' | shasum -a 256 2>/dev/null | cut -c1-32)
[ -n "$DEVICE_KEY" ] || DEVICE_KEY=$(printf '%s' "$HOST_NAME" | tr -cd 'A-Za-z0-9' | cut -c1-40)

# --- sistema e hardware --------------------------------------------------------------
OS_NAME="$(sw_vers -productName 2>/dev/null) $(sw_vers -productVersion 2>/dev/null)"
OS_BUILD=$(sw_vers -buildVersion 2>/dev/null)
ARCH=$(uname -m 2>/dev/null)
BOOT_EPOCH=$(sysctl -n kern.boottime 2>/dev/null | awk -F'[ ,]+' '{print $4; exit}')
CONSOLE_USER=$(stat -f%Su /dev/console 2>/dev/null)
[ "$CONSOLE_USER" = root ] && CONSOLE_USER=''
MODEL=$(sysctl -n hw.model 2>/dev/null)
CPU=$(sysctl -n machdep.cpu.brand_string 2>/dev/null)
CORES=$(sysctl -n hw.physicalcpu 2>/dev/null)
RAM_GB=$(sysctl -n hw.memsize 2>/dev/null | awk '{printf "%.1f", $1 / 1073741824}')
DESIGN_CAP=$(ioreg -rn AppleSmartBattery 2>/dev/null | awk '$1 == "\"DesignCapacity\"" {print $3; exit}')
FULL_CAP=$(ioreg -rn AppleSmartBattery 2>/dev/null | awk '$1 == "\"AppleRawMaxCapacity\"" {print $3; exit}')

# --- rede --------------------------------------------------------------------------
DEFAULT_IF=$(route -n get default 2>/dev/null | awk '/interface:/ {print $2; exit}')
GATEWAY=$(route -n get default 2>/dev/null | awk '/gateway:/ {print $2; exit}')
PRIMARY_IP=''
NETS=()
if [ -n "$DEFAULT_IF" ]; then
  PRIMARY_IP=$(ipconfig getifaddr "$DEFAULT_IF" 2>/dev/null)
  MAC=$(ifconfig "$DEFAULT_IF" 2>/dev/null | awk '/ether/ {print $2; exit}')
  NETS+=("$(map name "$(str "$DEFAULT_IF")" mac "$(str "$MAC")" ip "$(str "$PRIMARY_IP")" gateway "$(str "$GATEWAY")")")
fi

# --- volumes e seguranca -----------------------------------------------------------
read -r ROOT_SIZE_KB ROOT_FREE_KB < <(df -k / 2>/dev/null | awk 'NR == 2 {print $2, $4}')
FILEVAULT=''
if fdesetup status 2>/dev/null | grep -q 'is On'; then FILEVAULT=true; elif fdesetup status >/dev/null 2>&1; then FILEVAULT=false; fi
VOLS=("$(map drive "$(str /)" sizeGb "$(num "$(awk -v k="$ROOT_SIZE_KB" 'BEGIN {printf "%.1f", k / 1048576}')")" freeGb "$(num "$(awk -v k="$ROOT_FREE_KB" 'BEGIN {printf "%.1f", k / 1048576}')")" encrypted "$(bool "$FILEVAULT")")")
FIREWALL=''
FW_STATE=$(/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null)
case "$FW_STATE" in *enabled*) FIREWALL='Application Firewall' ;; *disabled*) FIREWALL='Desativado' ;; esac
ADMINS=()
for member in $(dscl . -read /Groups/admin GroupMembership 2>/dev/null | cut -d: -f2-); do
  ADMINS+=("$(str "$member")")
done

# --- aplicativos -------------------------------------------------------------------
SOFT=()
for app in /Applications/*.app /Applications/Utilities/*.app; do
  [ -d "$app" ] || continue
  name=$(basename "$app" .app)
  version=$(defaults read "$app/Contents/Info" CFBundleShortVersionString 2>/dev/null)
  SOFT+=("$(map name "$(str "$name")" version "$(str "$version")")")
  [ "${#SOFT[@]}" -ge 400 ] && break
done

# --- envio -------------------------------------------------------------------------
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
BATTERY='{"nullValue":null}'
[ -n "$DESIGN_CAP" ] && [ -n "$FULL_CAP" ] && BATTERY=$(map designCapacity "$(num "$DESIGN_CAP")" fullCapacity "$(num "$FULL_CAP")")
PAYLOAD=$(map \
  agentVersion "$(str "$AGENT_VERSION")" \
  deviceId "$(str "$DEVICE_ID")" \
  hostname "$(str "$HOST_NAME")" \
  loggedUser "$(str "$CONSOLE_USER")" \
  collectedAt "$(str "$NOW")" \
  serialNumber "$(str "$SERIAL")" \
  os "$(map name "$(str "$OS_NAME")" build "$(str "$OS_BUILD")" arch "$(str "$ARCH")" lastBoot "$(str "$(iso_from_epoch "$BOOT_EPOCH")")")" \
  hardware "$(map manufacturer "$(str 'Apple')" model "$(str "$MODEL")" processor "$(str "$CPU")" cores "$(num "$CORES")" ramGb "$(num "$RAM_GB")")" \
  battery "$BATTERY" \
  network "$(arr "${NETS[@]}")" \
  volumes "$(arr "${VOLS[@]}")" \
  security "$(map firewall "$(str "$FIREWALL")" encryption "$(str "$( [ "$FILEVAULT" = true ] && echo FileVault)")" localAdmins "$(arr "${ADMINS[@]}")")" \
  software "$(arr "${SOFT[@]}")")

DOC=$(printf '{"fields":{"tenantId":%s,"agentToken":%s,"deviceKey":%s,"status":%s,"source":%s,"agentVersion":%s,"hostname":%s,"serialNumber":%s,"deviceId":%s,"internalId":%s,"ip_address":%s,"createdAt":{"timestampValue":"%s"},"payload":%s}}' \
  "$(str "$TENANT_ID")" "$(str "$AGENT_TOKEN")" "$(str "$DEVICE_KEY")" "$(str pending)" "$(str 'Agente ITAM macOS')" \
  "$(str "$AGENT_VERSION")" "$(str "$HOST_NAME")" "$(str "$SERIAL")" "$(str "$DEVICE_ID")" "$(str '')" "$(str "$PRIMARY_IP")" "$NOW" "$PAYLOAD")

URL="$FIRESTORE_BASE/projects/$PROJECT_ID/databases/(default)/documents/agentInbox/${TENANT_ID}_${DEVICE_KEY}?key=$API_KEY"
RESPONSE="${TMPDIR:-/tmp}/nexus-agent-response.$$"
for attempt in 1 2 3; do
  CODE=$(printf '%s' "$DOC" | curl -sS --globoff -o "$RESPONSE" -w '%{http_code}' -X PATCH \
    -H 'Content-Type: application/json; charset=utf-8' --data-binary @- "$URL" 2>>"$LOG_FILE")
  if [ "$CODE" = 200 ]; then
    rm -f "$RESPONSE"
    log "OK $HOST_NAME"
    echo "Inventario de $HOST_NAME enviado ao Nexus ITAM."
    exit 0
  fi
  log "Falha no envio (tentativa $attempt de 3) - HTTP $CODE $(head -c 300 "$RESPONSE" 2>/dev/null | tr '\n' ' ')"
  [ "$attempt" -lt 3 ] && sleep $((attempt * 15))
done
rm -f "$RESPONSE"
echo "Nao foi possivel enviar o inventario. Detalhes em $LOG_FILE"
exit 1
