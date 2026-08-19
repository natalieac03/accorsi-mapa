from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import __version__
from .api.router import api_router
from .api.routes.health import router as health_router
from .config import get_settings
from .middleware import RequestIdMiddleware, SecurityHeadersMiddleware

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings = get_settings()
    settings.validate_runtime_security()
    if not settings.auth_required:
        # Aviso alto no log: nesse modo qualquer pessoa com o endereço entra.
        logger.warning(
            "AUTH_REQUIRED=false: API aberta sem login, valendo como %s. "
            "Modo de demonstração. Volte para true depois.",
            "demonstracao@local",
        )
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        docs_url="/docs" if settings.docs_enabled else None,
        redoc_url=None,
        lifespan=lifespan,
    )
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestIdMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-CSRF-Token", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
    )
    if settings.allowed_host_list and "*" not in settings.allowed_host_list:
        app.add_middleware(
            TrustedHostMiddleware,
            allowed_hosts=settings.allowed_host_list,
        )

    app.include_router(health_router)
    app.include_router(api_router, prefix=settings.api_prefix)
    return app


app = create_app()
