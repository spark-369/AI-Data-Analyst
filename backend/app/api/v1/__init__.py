from fastapi import APIRouter

from app.api.v1 import analytics, auth, chat, datasources

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(datasources.router)
api_router.include_router(chat.router)
api_router.include_router(analytics.router)
