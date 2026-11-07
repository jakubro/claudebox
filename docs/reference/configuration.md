# Configuration reference

Every key `.claudebox/settings.toml` accepts, with its type, its default and what it does. For how the files compose and which one wins, see the [configuration guide](../guide/configuration.md).

Settings are TOML. Claudebox walks up from the working directory, then reads the home directory, and deep-merges what it finds - nearest wins. A file declaring `root = true` stops the walk there. A file not owned by the user running claudebox is skipped, with a one-line notice on stderr naming it - a settings file is authoritative only for the person who wrote it.

## Top level

| Key | Type | Default | Meaning |
|---|---|---|---|
| `root` | boolean | `false` | Stop searching parent directories for further settings files |
| `profile` | path | `~/.claudebox/profile` when that directory exists | Profile directory supplying prompts, hooks, skills, commands and agents |
| `agent` | string | `"claude"` | Which runtime to launch: `claude` or `langgraph` |
| `backend` | string | `"podman"` | Container runtime: `podman`, `docker` or `local`. Any other value is refused at load, naming the settings file it came from |

Paths accept `~` and relative forms; both are resolved when the settings are loaded.

## Container

| Key | Type | Default | Meaning |
|---|---|---|---|
| `[mounts]` | table of path = path | none | Extra host-path to container-path mounts. The workspace itself is always mounted at the same path inside and out |
| `[ports]` | table of host port = container port, or host port = `{ container, bind }` | none | Host port to container port, published on `127.0.0.1`. `container` is a port or `"<port>/<tcp|udp|sctp>"`; `bind` is an IPv4 or IPv6 address (`0.0.0.0` and `::` for every interface) and defaults to `127.0.0.1`. A host port of `0` takes a random free one. A fixed host port already in use is published on a free port at the same address instead; `claudebox run` and `claudebox shell` print which |
| `[network] mode` | string | unset | Container network mode. Unset gives the session its own private network namespace. `host`, `none`, `container:` and `ns:` modes apply to `claudebox run` and `claudebox shell`; a session in the browser refuses to start under them |
| `[containers] nested` | boolean | `false` | Let the agent build images and run containers inside its session. See [nested containers](../features/nested-containers.md) |
| `[env]` | table of name = value | none | Environment variables passed into the container |

## Interface

| Key | Type | Default | Meaning |
|---|---|---|---|
| `[editor] url_template` | string | unset | URI opened by the "open in IDE" controls. `{path}` and `{line}` are substituted. Unset hides the controls |
| `[links] allow` | list of patterns | none | Patterns a shared link's carried message must match in full before it may auto-submit. `.` matches line breaks, so a pattern can cover multi-line text. Omitted allows none |

## Maintenance

| Key | Type | Default | Meaning |
|---|---|---|---|
| `[prune] session_days` | positive integer | `365` | Days a session may go without activity or a resume before `claudebox prune` removes it. A pinned session or one whose container is running is never removed |
| `[prune] tmp_days` | positive integer | `14` | Days a session may go without activity or a resume before `claudebox prune` empties its `/tmp`. The session itself stays. A pinned session or one whose container is running keeps its `/tmp` |

## Bundles

| Key | Type | Default | Meaning |
|---|---|---|---|
| `[bundles.<name>]` | table | none | A named set of overrides. Resolving it merges its keys over the rest of the file, the bundle winning per key |

A bundle may carry `env`, `mounts`, `ports`, `network.mode`, `model`, `effort_level`, `permission_mode`, `session_prompt` and `messages`, and nothing else - any other key is refused at load, naming the bundle and the settings file.

| Key in a bundle | Type | Meaning |
|---|---|---|
| `env`, `mounts`, `ports`, `[network] mode` | as above | Merged over the workspace's own for the session's container |
| `model` | string | Model the session starts on |
| `effort_level` | string | Effort level the session starts at |
| `permission_mode` | string | Permission mode the session starts in |
| `session_prompt` | string | Session prompt the session starts with |
| `messages` | list of strings | Opening messages, once, when the session is created, after any message the session opens with: the first is sent and the rest wait in the message queue, each sent when the reply before it finishes. Never checked against `[links] allow` |

A starting value is skipped on a runtime that cannot change it, and a value picked on the welcome screen wins over the bundle's. A session keeps its bundle across resumes and forks and reads it from the settings afresh each time, so a session whose bundle has been deleted cannot resume. A bundle's name may hold letters, digits, `-` and `_`. Bundles declared in several settings files merge like every other table, the nearest file winning per key.

## LangGraph runtime

Read when `agent = "langgraph"`.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `[langgraph] model` | string | unset | Model in LangChain's `provider:model-id` form |
| `[langgraph] max_tokens_override` | integer | unset | Context window for a model the built-in table does not carry |
| `[langgraph.<provider>]` | table | none | Forwarded verbatim to that provider's chat constructor - `base_url`, `reasoning`, `thinking`, `reasoning_effort` and anything else it accepts |
| `[langgraph.cost]` | table of model = `{ input, output }` | none | Price per million tokens for a model the built-in price table does not carry |
| `[langgraph.hooks]` | table of event = path | conventional paths | Profile hook scripts by lifecycle event; relative paths resolve against the profile |
| `[langgraph.web_search] provider` | string | `"duckduckgo"` | Backend for the web search tool |
| `[langgraph.web_search] api_key_env` | string | unset | Environment variable holding the search provider's key |
| `[langgraph.mcp.<name>]` | table | none | One MCP server connection. `transport` plus `command` and `args` for stdio, or `url` for SSE |

A provider's credentials come from the environment, not from these files.

## An example file

```toml
root = true

agent = "claude"
backend = "podman"
profile = "~/.claudebox/profile"

[mounts]
"/data/models" = "/models"

[ports]
8080 = 80

[containers]
nested = true

[editor]
url_template = "jetbrains://idea/navigate/reference?project=demo&path={path}:{line}"

[env]
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = 1
```

## Related pages

- [Configuration guide](../guide/configuration.md) - the hierarchy as a task
- [Runtimes guide](../guide/runtimes.md) - choosing between the two agents
- [Workspaces guide](../guide/workspaces.md) - markers, registration and storage
