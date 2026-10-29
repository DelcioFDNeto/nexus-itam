# =============================================================================
# Nexus ITAM v3.0 — Hardened Microservice Runtime Image (Fastify 5 + Node 22)
# =============================================================================
FROM node:22-alpine AS base

WORKDIR /app

# Instala apenas dependências de produção com auditoria determinística
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copia código-fonte dos microsserviços e biblioteca Zero-Trust compartilhada
COPY shared ./shared
COPY api-gateway ./api-gateway
COPY service-assets ./service-assets
COPY service-tickets ./service-tickets
COPY service-compliance ./service-compliance
COPY service-nexusdesk ./service-nexusdesk
COPY orchestrator.js ./orchestrator.js

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV SERVICE_ENTRY=api-gateway/src/server.js

# Execução sem privilégios de root (CIS Docker Benchmark)
USER node

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const p=process.env.PORT||8000;fetch('http://127.0.0.1:'+p+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "exec node ${SERVICE_ENTRY}"]
