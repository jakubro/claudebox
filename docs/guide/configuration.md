# Configuring a workspace

Settings live in `.claudebox/settings.toml`. There can be several; this page covers which one wins and the most common keys.

## Which file wins

Claudebox starts in the working directory and walks up, then reads the home directory. Every `.claudebox/settings.toml` it passes is merged, and the nearest one wins on any key the two share. The merge is deep: a file that sets one key under `[env]` does not discard the rest.

Broad defaults can then live at `~/.claudebox/settings.toml` and project specifics inside each project:

```toml
# ~/.claudebox/settings.toml
backend = "podman"

[env]
EDITOR = "vim"
```

```toml
# myproject/.claudebox/settings.toml
[containers]
nested = true

[env]
DATABASE_URL = "postgres://localhost/dev"
```

The project ends up with both environment variables, podman, and nested containers on.

## Stopping the walk

```toml
root = true
```

In a file with that key, Claudebox stops looking further up. It keeps a project from inheriting the home directory's settings - a shared repository, or a workspace whose behavior should not change with the machine.

## Common keys

**Extra mounts.** The workspace is already mounted, at the same path inside the container as outside, so this is only for what lies outside it.

```toml
[mounts]
"/data/models" = "/models"
```

**Ports.** A published port makes a dev server the agent starts reachable from the browser. The port listens on this machine only. A host port of `0` picks a free one. The first session to start holds a fixed port; later ones publish it on a free port instead. A running session can also open a port without a settings change, once the request is approved in the conversation - see [the container boundary](../features/container-boundary.md).

```toml
[ports]
8080 = 80
```

To reach the port from another machine, say so on the entry:

```toml
[ports]
8080 = { container = 80, bind = "0.0.0.0" }
```

**Environment.** Values are strings and numbers, not shell expressions.

```toml
[env]
DATABASE_URL = "postgres://localhost/dev"
```

**Editor.** With a URL template, file paths and tool blocks become clickable openers. `{path}` and `{line}` are substituted; without it, the controls do not appear.

```toml
[editor]
url_template = "jetbrains://idea/navigate/reference?project=demo&path={path}:{line}"
```

**Bundles.** A bundle is a named set of overrides: another model, an extra key in the environment, an opening message. A bundle is one more layer: its keys merge over the file's own, so a value it does not mention is the workspace's.

```toml
[bundles.research]
model = "claude-opus-5-5"
effort_level = "max"

[bundles.research.env]
SEARCH_API_KEY = "..."
```

A bundle applies to sessions started in the browser. Picked from the "New session - research" row of the "+" menu, or from the bundle picker beside the model picker on the welcome screen, the bundle starts the new session under it: its container gets the bundle's environment, mounts, ports and network; the model, effort and permission-mode pickers start at the bundle's values and its session prompt is set; and its `messages` open the conversation: the first is sent and the rest wait in the message queue, each sent when the reply before it finishes. Each starting value can still be changed - the footer names the bundle, and a dot beside the name marks a value that has moved since. The session keeps its bundle across resumes and forks and reads it afresh from the settings each time, so deleting the bundle leaves that session unable to resume. A bundle can also bring its own system prompt; see [profiles](profiles.md#the-system-prompt).

## Checking the result

Settings are read when a session starts, so a changed file takes effect in the next session started. `claudebox doctor` reports what the environment resolved to when something looks wrong.

## Related pages

- [Configuration reference](../reference/configuration.md) - every key, type and default
- [Workspaces](workspaces.md) - which directory is the root
- [Runtimes](runtimes.md) - the `[langgraph]` section
- [Nested containers](../features/nested-containers.md) - `[containers] nested`
