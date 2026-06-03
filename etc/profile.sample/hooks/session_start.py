#!/opt/claudebox/claudebox/.venv/bin/python
"""Session start hook — injects session context."""

from claudebox import HookRequest, HookResponse, hook


@hook
def main(request: HookRequest, response: HookResponse):
    """Inject session context."""

    response.add_to_context(f"Session started at {request.session.start_time}")


if __name__ == "__main__":
    main()
