# Configuring a workspace

Settings live in `.claudebox/settings.toml`. There can be several, and knowing which one wins is
most of what there is to learn.

## Which file wins

Claudebox starts in the directory you are working in and walks up, then reads your home directory.
Every `.claudebox/settings.toml` it passes is merged, and the nearest one wins on any key the two
share. The merge is deep: a file that sets one key under `[env]` does not discard the rest.

So the shape people usually want falls out for free - broad defaults at
`~/.claudebox/settings.toml`, project specifics inside each project:

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

Put that in a file and Claudebox stops looking further up. Reach for it when a project must not
inherit whatever your home directory happens to say - a repository you share, or a workspace whose
behavior should not change with the machine.

## The keys people reach for first

**Mount something extra.** The workspace is already mounted, at the same path inside the container
as outside, so this is only for what lies outside it.

```toml
[mounts]
"/data/models" = "/models"
```

**Publish a port** so a dev server the agent starts is reachable from your browser. A host port of
`0` picks a free one.

```toml
[ports]
8080 = 80
```

**Pass environment through.** Values are strings and numbers, not shell expressions.

```toml
[env]
DATABASE_URL = "postgres://localhost/dev"
```

**Wire up your editor** so file paths and tool blocks become clickable openers. `{path}` and
`{line}` are substituted; leave it out and the controls do not appear.

```toml
[editor]
url_template = "jetbrains://idea/navigate/reference?project=demo&path={path}:{line}"
```

## Checking what you get

Settings are read when a session starts, so change a file and start a session to see the effect.
`claudebox doctor` reports what the environment resolved to when something looks wrong.

## Details

- [Configuration reference](../reference/configuration.md) - every key, type and default
- [Workspaces](workspaces.md) - which directory is the root
- [Runtimes](runtimes.md) - the `[langgraph]` section
- [Nested containers](../features/nested-containers.md) - `[containers] nested`
