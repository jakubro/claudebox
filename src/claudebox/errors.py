"""Generic API error hierarchy — typed exceptions with HTTP status codes."""


class ApiError(Exception):
    """Base for typed API errors; subclasses set status_code and error_key."""

    status_code: int = 500
    error_key: str = "internal_error"

    def __init__(self, **context: str) -> None:
        self.context = context
        super().__init__(self.error_key)
