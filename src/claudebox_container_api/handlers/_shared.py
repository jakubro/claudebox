"""Shared handler dependencies - FastAPI DI aliases for common services."""

from typing import Annotated

from fastapi import Depends

from claudebox import SessionService
from ..files import FileService, get_file_service
from ..session import get_session


# FastAPI dependency - injects the active Session service.
SessionDep = Annotated[SessionService, Depends(get_session)]

# FastAPI dependency - injects the active FileService.
FilesDep = Annotated[FileService, Depends(get_file_service)]
