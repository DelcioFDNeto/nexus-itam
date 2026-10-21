#!/usr/bin/env bash
# Nexus ITAM - Agente de inventario para Linux (versao __AGENT_VERSION__)
# Coleta hardware, sistema, seguranca e pacotes e envia para a fila do
# Nexus ITAM da empresa. Somente leitura. Rode como root para ler numero de
# serie e UUID da placa (sem root eles ficam em branco).
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

# --- JSON no formato do Firestore REST ------------------------------------------
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
read_file() { [ -r "$1" ] && head -c 256 "$1" 2>/dev/null | tr -d '\n'; }
gb() { awk -v b="$1" 'BEGIN { if (b > 0) printf "%.1f", b / 1073741824 }'; }
iso_from_epoch() { [ -n "$1" ] && date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null; }

[ "$1" = "--scheduled" ] && sleep $((RANDOM % 240))
IS_ROOT=false; [ "$(id -u)" = 0 ] && IS_ROOT=true

# --- identidade ------------------------------------------------------------------
HOST_NAME=$(hostname 2>/dev/null)
DEVICE_ID=$(read_file /etc/machine-id); [ -n "$DEVICE_ID" ] || DEVICE_ID=$(read_file /var/lib/dbus/machine-id)
SERIAL=$(read_file /sys/class/dmi/id/product_serial)
UUID=$(read_file /sys/class/dmi/id/product_uuid)
ASSET_TAG=$(read_file /sys/class/dmi/id/chassis_asset_tag)
DEVICE_KEY=$(printf '%s|%s|%s' "$DEVICE_ID" "$SERIAL" "$UUID" | tr '[:lower:]' '[:upper:]' | sha256sum 2>/dev/null | cut -c1-32)
[ -n "$DEVICE_KEY" ] || DEVICE_KEY=$(printf '%s' "$HOST_NAME" | tr -cd 'A-Za-z0-9' | cut -c1-40)

# --- sistema e hardware ------------------------------------------------------------
OS_NAME=$( (. /etc/os-release 2>/dev/null; printf '%s' "$PRETTY_NAME") )
KERNEL=$(uname -r 2>/dev/null)
ARCH=$(uname -m 2>/dev/null)
BOOT_EPOCH=$(awk '/^btime/ {print $2}' /proc/stat 2>/dev/null)
LOGGED_USER=$(who 2>/dev/null | awk '$1 != "root" {print $1; exit}')
DOMAIN_NAME=$(dnsdomainname 2>/dev/null)
CPU=$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2- | sed 's/^ *//')
CORES=$(nproc 2>/dev/null)
RAM_GB=$(awk '/MemTotal/ {printf "%.1f", $2 / 1048576}' /proc/meminfo 2>/dev/null)
CHASSIS=$(read_file /sys/class/dmi/id/chassis_type)
HAS_BATTERY=false; ls /sys/class/power_supply/BAT* >/dev/null 2>&1 && HAS_BATTERY=true

# --- rede ----------------------------------------------------------------------
DEFAULT_IF=$(ip route show default 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "dev") {print $(i + 1); exit}}')
GATEWAY=$(ip route show default 2>/dev/null | awk '{print $3; exit}')
NETS=()
PRIMARY_IP=''
if command -v ip >/dev/null 2>&1; then
  while read -r ifname cidr; do
    [ -n "$ifname" ] || continue
    addr=${cidr%/*}
    gw=''
    if [ "$ifname" = "$DEFAULT_IF" ]; then gw=$GATEWAY; PRIMARY_IP=$addr; fi
    NETS+=("$(map name "$(str "$ifname")" mac "$(str "$(read_file "/sys/class/net/$ifname/address")")" ip "$(str "$addr")" gateway "$(str "$gw")")")
  done < <(ip -o -4 addr show scope global 2>/dev/null | awk '{print $2, $4}')
fi
[ -n "$PRIMARY_IP" ] || PRIMARY_IP=$(hostname -I 2>/dev/null | awk '{print $1}')

# --- discos e volumes ---------------------------------------------------------------
DISKS=()
if command -v lsblk >/dev/null 2>&1; then
  while read -r name size rota type; do
    [ "$type" = disk ] || continue
    media=HDD; [ "$rota" = 0 ] && media=SSD
    model=$(read_file "/sys/block/$name/device/model")
    dserial=$(lsblk -dn -o SERIAL "/dev/$name" 2>/dev/null | head -n 1)
    DISKS+=("$(map model "$(str "$model")" sizeGb "$(num "$((size / 1073741824))")" serial "$(str "$dserial")" media "$(str "$media")")")
  done < <(lsblk -dbn -o NAME,SIZE,ROTA,TYPE 2>/dev/null)
fi

VOLS=()
while read -r src size avail mount; do
  [ -n "$mount" ] || continue
  enc=''
  if command -v lsblk >/dev/null 2>&1 && [ -b "$src" ]; then
    if lsblk -s -no TYPE "$src" 2>/dev/null | grep -q crypt; then enc=true; else enc=false; fi
  fi
  VOLS+=("$(map drive "$(str "$mount")" label "$(str "$src")" sizeGb "$(num "$(gb "$size")")" freeGb "$(num "$(gb "$avail")")" encrypted "$(bool "$enc")")")
done < <(df -P -B1 -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null | awk 'NR > 1 && ($6 == "/" || $6 == "/home" || $6 == "/boot") {print $1, $2, $4, $6}')

# --- seguranca -------------------------------------------------------------------
FIREWALL=''
if [ "$IS_ROOT" = true ]; then
  if command -v ufw >/dev/null 2>&1; then
    if ufw status 2>/dev/null | grep -qi 'status: active'; then FIREWALL='ufw'; else FIREWALL='Desativado'; fi
  elif command -v firewall-cmd >/dev/null 2>&1; then
    if [ "$(firewall-cmd --state 2>/dev/null)" = running ]; then FIREWALL='firewalld'; else FIREWALL='Desativado'; fi
  fi
fi
ADMINS=()
while read -r member; do
  [ -n "$member" ] && ADMINS+=("$(str "$member")")
done < <(getent group sudo wheel admin 2>/dev/null | cut -d: -f4 | tr ',' '\n' | sort -u)
PENDING_REBOOT=false; [ -f /var/run/reboot-required ] && PENDING_REBOOT=true
UPDATE_EPOCH=''
for stamp in /var/lib/apt/periodic/update-success-stamp /var/log/apt/history.log /var/lib/dnf/history.sqlite /var/lib/rpm/rpmdb.sqlite; do
  if [ -e "$stamp" ]; then UPDATE_EPOCH=$(stat -c %Y "$stamp" 2>/dev/null); break; fi
done

# --- software (pacotes instalados pelo usuario quando o apt sabe dizer) ----------
SOFT=''
to_fs_list() {
  awk -F'\t' 'count < 1500 && $1 != "" {
    gsub(/[\\"]/, "", $1); gsub(/[\\"]/, "", $2)
    printf "%s{\"mapValue\":{\"fields\":{\"name\":{\"stringValue\":\"%s\"},\"version\":{\"stringValue\":\"%s\"}}}}", (count++ ? "," : ""), $1, $2
  }'
}
if command -v dpkg-query >/dev/null 2>&1; then
  MANUAL=$(apt-mark showmanual 2>/dev/null)
  if [ -n "$MANUAL" ]; then
    SOFT=$(dpkg-query -W -f='${Package}\t${Version}\n' 2>/dev/null | awk -F'\t' 'NR == FNR {keep[$1] = 1; next} keep[$1]' <(printf '%s\n' "$MANUAL") - | to_fs_list)
  else
    SOFT=$(dpkg-query -W -f='${Package}\t${Version}\n' 2>/dev/null | to_fs_list)
  fi
elif command -v rpm >/dev/null 2>&1; then
  SOFT=$(rpm -qa --qf '%{NAME}\t%{VERSION}-%{RELEASE}\n' 2>/dev/null | sort | to_fs_list)
fi

# --- envio -------------------------------------------------------------------------
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
PAYLOAD=$(map \
  agentVersion "$(str "$AGENT_VERSION")" \
  deviceId "$(str "$DEVICE_ID")" \
  hostname "$(str "$HOST_NAME")" \
  domain "$(str "$DOMAIN_NAME")" \
  loggedUser "$(str "$LOGGED_USER")" \
  collectedAt "$(str "$NOW")" \
  serialNumber "$(str "$SERIAL")" \
  assetTag "$(str "$ASSET_TAG")" \
  os "$(map name "$(str "$OS_NAME")" version "$(str "$KERNEL")" arch "$(str "$ARCH")" lastBoot "$(str "$(iso_from_epoch "$BOOT_EPOCH")")")" \
  hardware "$(map manufacturer "$(str "$(read_file /sys/class/dmi/id/sys_vendor)")" model "$(str "$(read_file /sys/class/dmi/id/product_name)")" board "$(str "$(read_file /sys/class/dmi/id/board_name)")" processor "$(str "$CPU")" cores "$(num "$CORES")" ramGb "$(num "$RAM_GB")" biosVersion "$(str "$(read_file /sys/class/dmi/id/bios_version)")" chassis_types "$(str "$CHASSIS")" smbios_uuid "$(str "$UUID")")" \
  battery "$(if [ "$HAS_BATTERY" = true ]; then map present "$(bool true)"; else printf '{"nullValue":null}'; fi)" \
  network "$(arr "${NETS[@]}")" \
  disks "$(arr "${DISKS[@]}")" \
  volumes "$(arr "${VOLS[@]}")" \
  security "$(map firewall "$(str "$FIREWALL")" localAdmins "$(arr "${ADMINS[@]}")" lastUpdate "$(str "$(iso_from_epoch "$UPDATE_EPOCH")")" pendingReboot "$(bool "$PENDING_REBOOT")")" \
  software "{\"arrayValue\":{\"values\":[$SOFT]}}")

DOC=$(printf '{"fields":{"tenantId":%s,"agentToken":%s,"deviceKey":%s,"status":%s,"source":%s,"agentVersion":%s,"hostname":%s,"serialNumber":%s,"deviceId":%s,"internalId":%s,"ip_address":%s,"createdAt":{"timestampValue":"%s"},"payload":%s}}' \
  "$(str "$TENANT_ID")" "$(str "$AGENT_TOKEN")" "$(str "$DEVICE_KEY")" "$(str pending)" "$(str 'Agente ITAM Linux')" \
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
