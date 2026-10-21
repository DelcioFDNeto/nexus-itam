#!/usr/bin/env bash
# Nexus ITAM - instalador do agente para Linux (versao __AGENT_VERSION__)
# Instala em /opt/nexus-itam (so o root le: o script carrega o token da
# empresa) e agenda no cron do sistema: na inicializacao e a cada 6 horas.
# Para remover: sudo bash este-arquivo.sh --uninstall
set -e
if [ "$(id -u)" != 0 ]; then
  echo 'Execute como root: sudo bash' "$0"
  exit 1
fi
INSTALL_DIR=/opt/nexus-itam
SCRIPT_PATH=$INSTALL_DIR/nexus-agent.sh
CRON_FILE=/etc/cron.d/nexus-itam

if [ "$1" = "--uninstall" ]; then
  rm -f "$CRON_FILE"
  rm -rf "$INSTALL_DIR"
  echo 'Agente Nexus ITAM removido.'
  exit 0
fi

mkdir -p "$INSTALL_DIR"
chmod 700 "$INSTALL_DIR"
cat > "$SCRIPT_PATH" <<'NEXUS_AGENT_CODE_EOF'
__AGENT_CODE__
NEXUS_AGENT_CODE_EOF
chmod 700 "$SCRIPT_PATH"

MINUTE=$((RANDOM % 60))
cat > "$CRON_FILE" <<EOF
# Nexus ITAM - inventario de ativos
SHELL=/bin/bash
@reboot root sleep 120 && $SCRIPT_PATH --scheduled
$MINUTE */6 * * * root $SCRIPT_PATH --scheduled
EOF
chmod 644 "$CRON_FILE"

"$SCRIPT_PATH" || true
echo 'Agente Nexus ITAM instalado: roda na inicializacao e a cada 6 horas.'
echo 'Log: /var/log/nexus-agent.log'
