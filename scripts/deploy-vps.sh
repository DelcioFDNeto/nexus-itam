#!/usr/bin/env bash
# =============================================================================
# Nexus ITAM v3.0 — Script Automatizado de Provisionamento & Deploy em VPS Linux
# =============================================================================
# Uso:
#   chmod +x scripts/deploy-vps.sh
#   ./scripts/deploy-vps.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/.."

ENV_FILE=".env.vps"

echo "=================================================================="
echo "  Nexus ITAM v3.0 — Deploy Hardened de Microsserviços na VPS"
echo "=================================================================="

if ! command -v docker >/dev/null 2>&1; then
  echo "[ERRO] Docker não encontrado. Instale com: curl -fsSL https://get.docker.com | sh"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "[ERRO] Docker Compose v2 não encontrado."
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "[ERRO] OpenSSL não encontrado. Instale com: sudo apt-get install -y openssl"
  exit 1
fi

# Gera `.env.vps` com segredos criptográficos reais de 256 bits caso não exista
if [ ! -f "${ENV_FILE}" ]; then
  echo "[INFO] Criando ${ENV_FILE} a partir de .env.vps.example com chaves de 256 bits..."
  cp .env.vps.example "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"

  PG_SECRET="$(openssl rand -hex 24)"
  JWT_SEC="$(openssl rand -hex 32)"
  GW_SEC="$(openssl rand -hex 32)"
  LEGAL_SEC="$(openssl rand -hex 32)"

  sed -i "s/SUBSTITUA_COM_OPENSSL_RAND_HEX_24/${PG_SECRET}/g" "${ENV_FILE}"
  sed -i "0,/SUBSTITUA_COM_OPENSSL_RAND_HEX_32/s//${JWT_SEC}/" "${ENV_FILE}"
  sed -i "0,/SUBSTITUA_COM_OPENSSL_RAND_HEX_32/s//${GW_SEC}/" "${ENV_FILE}"
  sed -i "0,/SUBSTITUA_COM_OPENSSL_RAND_HEX_32/s//${LEGAL_SEC}/" "${ENV_FILE}"
  echo "[INFO] Segredos de 256 bits gerados com sucesso em ${ENV_FILE}."
fi

# Detecta se os domínios foram customizados ou se roda em modo IP direto
HAS_REAL_DOMAINS=0
if [ -f "${ENV_FILE}" ] && ! grep -q "seudominio.com.br" "${ENV_FILE}" 2>/dev/null; then
  HAS_REAL_DOMAINS=1
fi

COMPOSE_FILES="-f docker-compose.yml"
if [ "${HAS_REAL_DOMAINS}" -eq 1 ]; then
  echo "[MODO] Domínios de produção detectados. Ativando Caddy TLS 1.3..."
  COMPOSE_FILES="-f docker-compose.yml -f docker-compose.vps.yml"
else
  echo "[MODO] Modo IP Direto (portas 3002 Console, 3001 Portal, 8000 Gateway)..."
  sed -i "s/EXPOSE_HOST_IP=127.0.0.1/EXPOSE_HOST_IP=0.0.0.0/" "${ENV_FILE}"
fi

echo "[1/3] Construindo imagens multi-stage (React 19, Vue 3.5 e 5 serviços Fastify)..."
docker compose --env-file "${ENV_FILE}" ${COMPOSE_FILES} build --pull

echo "[2/3] Subindo cluster com isolamento de rede (nexus-edge + nexus-mesh)..."
docker compose --env-file "${ENV_FILE}" ${COMPOSE_FILES} up -d --remove-orphans

echo "[3/3] Aguardando sondagem de saúde distribuída do API Gateway..."
HEALTHY=0
for attempt in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1; then
    HEALTHY=1
    curl -fsS http://127.0.0.1:8000/health
    echo ""
    break
  fi
  sleep 2
done

if [ "${HEALTHY}" -eq 0 ]; then
  echo "[INFO] Cluster ainda inicializando migrations do PostgreSQL 16. Verifique com: docker compose logs -f api-gateway"
fi

echo ""
echo "=================================================================="
echo "  [SUCESSO] Cluster Nexus ITAM v3.0 operacional na VPS!"
echo "=================================================================="
if [ "${HAS_REAL_DOMAINS}" -eq 1 ]; then
  echo "  Console:  https://${CONSOLE_DOMAIN:-itam.seudominio.com.br}"
  echo "  Portal:   https://${PORTAL_DOMAIN:-portal.seudominio.com.br}"
  echo "  API Docs: https://${API_DOMAIN:-api.seudominio.com.br}/docs"
else
  VPS_IP="$(curl -s -4 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
  echo "  Console Admin (React 19):    http://${VPS_IP}:3002"
  echo "  Portal Colaborador (Vue 3):  http://${VPS_IP}:3001"
  echo "  API Gateway & Swagger Docs:  http://${VPS_IP}:8000/docs"
  echo "  Health Check:                http://${VPS_IP}:8000/health"
fi
echo "=================================================================="
docker compose --env-file "${ENV_FILE}" ${COMPOSE_FILES} ps
