# Configuration reference

Every key `.claudebox/settings.toml` accepts, with its type, its default and what it does. For how
the files compose and which one wins, see the [configuration guide](../guide/configuration.md).

Settings are TOML. Claudebox walks up from the working directory, then reads your home directory,
and deep-merges what it finds - nearest wins. A file declaring `root = true` stops the walk there.

## Top level

| Key | Type | Default | Meaning |
|---|---|---|---|
| `root` | boolean | `false` | Stop searching parent directories for further settings files |
| `profile` | path | `~/.claudebox/profile` when that directory exists | Profile directory supplying prompts, hooks, skills, commands and agents |
| `agent` | string | `"claude"` | Which runtime to launch: `claude` or `langgraph` |
| `backend` | string | `"podman"` | Container runtime: `podman` or `docker` |

Paths accept `~` and relative forms; both are resolved when the settings are loaded.

## Container

| Key | Type | Default | Meaning |
|---|---|---|---|
| `[mounts]` | table of path = path | none | Extra host-path to container-path mounts. The workspace itself is always mounted at the same path inside and out |
| `[ports]` | table of int = int | none | Host port to container port. A host port of `0` takes a random free one |
| `[network] mode` | string | unset | Container network mode. Unset gives the session its own private network namespace |
| `[containers] nested` | boolean | `false` | Let the agent build images and run containers inside its session. See [nested containers](../features/nested-containers.md) |
| `[env]` | table of name = value | none | Environment variables passed into the container |

## Interface

| Key | Type | Default | Meaning |
|---|---|---|---|
| `[editor] url_template` | string | unset | URI opened by the "open in IDE" controls. `{path}` and `{line}` are substituted. Unset hides the controls |
| `[links] allow` | list of patterns | none | Patterns a shared link's carried message must match in full before it may auto-submit. Omitted allows none |

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

## A worked file

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

## Details

- [Configuration guide](../guide/configuration.md) - the hierarchy as a task
- [Runtimes guide](../guide/runtimes.md) - choosing between the two agents
- [Workspaces guide](../guide/workspaces.md) - markers, registration and storage
