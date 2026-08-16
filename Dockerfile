# ACCORSI — frontend: compila a SPA e serve pelo Caddy.
#
# ATENÇÃO à chave do Google Maps: o Vite embute variáveis VITE_* no bundle
# em tempo de compilação. A chave FICA VISÍVEL no JavaScript entregue ao
# navegador — isso é inerente ao Maps JS API, não é um defeito do projeto.
# Restrinja a chave por referenciador HTTP no Google Cloud Console para o
# domínio de produção, e restrinja também as APIs habilitadas
# (Maps JavaScript, Places, Geocoding). Sem isso a chave é utilizável por
# qualquer site.

FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

ARG VITE_GOOGLE_MAPS_API_KEY
ARG VITE_GOOGLE_MAPS_MAP_ID=""
ARG VITE_AUTH_REQUIRED="true"
ARG VITE_API_BASE_URL="/api/v1"
ARG VITE_REGISTRATIONS_MODE="api"

ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY \
    VITE_GOOGLE_MAPS_MAP_ID=$VITE_GOOGLE_MAPS_MAP_ID \
    VITE_AUTH_REQUIRED=$VITE_AUTH_REQUIRED \
    VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_REGISTRATIONS_MODE=$VITE_REGISTRATIONS_MODE

# Falha cedo se a chave não foi passada: sem ela o mapa nunca carrega e o
# app fica preso na tela de carregamento.
RUN test -n "$VITE_GOOGLE_MAPS_API_KEY" || \
    (echo "ERRO: VITE_GOOGLE_MAPS_API_KEY não foi informada no build." && exit 1)

RUN npm run build


FROM caddy:2-alpine AS runtime

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv

EXPOSE 80 443

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --spider -q http://127.0.0.1/favicon.svg || exit 1
