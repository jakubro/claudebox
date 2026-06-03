"""Session domain: metadata, lifecycle orchestration."""

from .errors import SessionNotFound
from .models import SessionInfo, SessionsChangedEvent
from .service import SessionService
