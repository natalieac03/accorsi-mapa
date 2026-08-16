from fastapi import APIRouter

from .routes import (
    agent,
    audit,
    auth,
    elections,
    imports,
    indicators,
    municipalities,
    registrations,
    spectrum,
    users,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(municipalities.router)
api_router.include_router(indicators.router)
api_router.include_router(elections.router)
api_router.include_router(registrations.router)
api_router.include_router(spectrum.router)
api_router.include_router(imports.router)
api_router.include_router(audit.router)
api_router.include_router(agent.router)
