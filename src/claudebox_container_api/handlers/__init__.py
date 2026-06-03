"""HTTP request handlers package."""

from fastapi import APIRouter

from .chat import router as chat_router
from .files import router as files_router
from .lifecycle import router as lifecycle_router
from .mcp import router as mcp_router
from .sessions import router as sessions_router


api_router = APIRouter()
api_router.include_router(chat_router)
api_router.include_router(files_router)
api_router.include_router(lifecycle_router)
api_router.include_router(mcp_router)
api_router.include_router(sessions_router)
