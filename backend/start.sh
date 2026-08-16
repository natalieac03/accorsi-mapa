#!/bin/sh
set -eu

alembic upgrade head
# Um único worker, de propósito: o limitador de tentativas de login guarda
# estado na memória do processo. Com N workers o limite efetivo vira 5xN.
# Só aumente depois de mover o limitador para armazenamento compartilhado.
#
# FORWARDED_ALLOW_IPS precisa ser o IP exato do proxy. Com "*" qualquer
# cliente pode forjar X-Forwarded-For e anular o componente de IP do limite.
exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8000}" \
  --workers 1 \
  --proxy-headers \
  --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-127.0.0.1}"

