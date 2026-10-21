#!/bin/bash
# Nexus ITAM - instalador do agente para macOS (versao __AGENT_VERSION__)
# Instala em /usr/local/nexus-itam (so o root le: o script carrega o token da
# empresa) e cria um LaunchDaemon que roda na inicializacao e a cada 6 horas.
# Para remover: sudo bash este-arquivo.sh --uninstall
set -e
if [ "$(id -u)" != 0 ]; then
  echo 'Execute como root: sudo bash' "$0"
  exit 1
fi
INSTALL_DIR=/usr/local/nexus-itam
SCRIPT_PATH=$INSTALL_DIR/nexus-agent.sh
LABEL=com.nexusitam.agent
PLIST_PATH=/Library/LaunchDaemons/$LABEL.plist

if [ "$1" = "--uninstall" ]; then
  launchctl bootout system "$PLIST_PATH" 2>/dev/null || launchctl unload "$PLIST_PATH" 2>/dev/null || true
  rm -f "$PLIST_PATH"
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

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$SCRIPT_PATH</string><string>--scheduled</string></array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>21600</integer>
</dict>
</plist>
EOF
chmod 644 "$PLIST_PATH"
launchctl bootout system "$PLIST_PATH" 2>/dev/null || true
launchctl bootstrap system "$PLIST_PATH" 2>/dev/null || launchctl load "$PLIST_PATH"
echo 'Agente Nexus ITAM instalado: roda na inicializacao e a cada 6 horas.'
echo 'Log: /var/log/nexus-agent.log'
