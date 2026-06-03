"""Terminal output helpers shared across claudebox CLI verbs."""

from claudebox import console


ICON_OK = "✓"
ICON_FAIL = "✗"
ICON_INFO = "○"


def print_ok(message: str) -> None:
    """Print a success line prefixed with the OK icon."""

    console.print(f"[green]{ICON_OK}[/green] {message}")


def print_fail(message: str) -> None:
    """Print a failure line prefixed with the fail icon."""

    console.print(f"[red]{ICON_FAIL} {message}[/red]")


def print_info(message: str) -> None:
    """Print an informational line prefixed with the info icon."""

    console.print(f"[dim]{ICON_INFO} {message}[/dim]")
