"""String formatting utilities."""


def wrap_box(text: str, width: int = 150) -> str:
    """Wrap text in a Unicode box-drawing border."""

    lines = text.splitlines()
    width = max(width, max(len(line) for line in lines) + 4)

    border = "─" * (width - 2)

    def pad(text: str) -> str:
        return f"│ {text}{' ' * (width - 4 - len(text))} │"

    return "\n".join(
        [
            f"┌{border}┐",
            *[pad(line) for line in lines],
            f"└{border}┘",
        ]
    )
