"""Shared handler dependencies - FastAPI DI aliases for common services."""

from typing import Annotated

from fastapi import Depends

from claudebox import SessionService
from ..files import FileService, get_file_service
from ..session import SessionRegistry, get_registry, get_session


# FastAPI dependency - injects the addressed Session service, or the primary if unaddressed.
SessionDep = Annotated[SessionService, Depends(get_session)]

# FastAPI dependency - injects the container's session registry directly.
RegistryDep = Annotated[SessionRegistry, Depends(get_registry)]

# FastAPI dependency - injects the active FileService.
FilesDep = Annotated[FileService, Depends(get_file_service)]
