#!/opt/claudebox/claudebox/.venv/bin/python

import json

from claudebox import HookRequest, hook


@hook
def main(request: HookRequest):
    """Append Bash commands to an audit log for session review."""

    if request.data.get("tool_name") == "Bash":
        path = request.session.path / "audit" / "bash.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)

        with open(path, "a") as f:
            f.write(json.dumps(request.data) + "\n")


if __name__ == "__main__":
    main()
