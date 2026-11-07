# Writing a profile

A profile is a directory. It carries the system prompt an agent runs with, the shell hooks that shape its container, and the skills, subagents and slash commands it can reach, in one place that can be versioned.

## The sample profile

A fresh install copies the shipped sample to `~/.claudebox/profile`, ready to read and edit. The `profile` key points claudebox at another directory:

```toml
profile = "~/code/my-profile"
```

The directory it names may contain any of these, and nothing is required:

```
profile/
|-- agents/
|   `-- example.md         Subagent definition
|-- commands/
|   `-- example.md         Slash command
|-- config/
|   |-- .gitconfig         Linked into the container at session start
|   `-- claude.json        Copied to the agent's settings at session start
|-- hooks/
|   |-- container-start.sh
|   |-- container-end.sh
|   |-- agent-start.sh
|   |-- agent-stop.sh
|   `-- image-build.sh
|-- prompt.md              System prompt entry point
`-- skills/
    `-- example/
        `-- SKILL.md       Skill definition
```

## The system prompt

`prompt.md` is the entry point. A runtime other than the default reads `prompt.<agent>.md` instead - `prompt.langgraph.md` for LangGraph - so the two can get different instructions without two copies of everything.

A session started under a settings bundle extends the same convention with the bundle's name: `prompt.research.md` for a bundle named `research`, or `prompt.langgraph.research.md` under LangGraph. When that file does not exist the runtime's own entry point is read, as for any other session, and a bundle never borrows the other runtime's file.

Neither file has to be one file. Include forms compose it:

| Form | Resolves to |
|---|---|
| `{{ relative/path }}` | A path relative to the prompt file, interpolated again in turn |
| `{{ @path }}` | A path relative to the workspace root |
| `{{ /absolute/path }}` | That exact path, included as-is |
| `{{ !name }}` | The output of the built-in `name` - `path` for the working directory, `tree` for a filtered listing of the workspace |

Two behaviors of includes:

**An executable target is run, not read.** If the file an include names has its executable bit set, Claudebox runs it and includes what it prints. That is how a prompt gets today's date, the current branch, or anything else that has to be computed at session start - and it is also why a stray `chmod +x` on a prompt fragment makes it vanish from the output.

**Only fragments beside the prompt are interpolated recursively.** What decides this is where the target lands, not which form named it: anything resolving inside the prompt file's own directory is expanded again, so includes can nest, and anything outside it is included literally, braces and all.

Indentation carries, on one condition: an include whose line holds nothing but whitespace before the braces indents every line it brings in, so a fragment dropped into a fenced block keeps its place. With anything else on that line first - a list marker, a label - the following lines come in unindented.

## Hooks

The shell hooks differ in how they run:

| Hook | Runs | How |
|---|---|---|
| `container-start.sh` | Container starts | Sourced - it can export variables the session keeps |
| `container-end.sh` | Container exits | Sourced |
| `agent-start.sh` | Before an interactive session begins | Executed as its own process, once |
| `agent-stop.sh` | After an interactive session ends | Executed as its own process, once |
| `image-build.sh` | Image build | Becomes a layer of the image |

Sourced hooks run inside the container's own shell, so what they set survives. Executed hooks do not - anything they export is gone when they exit. `container-start.sh` is for changing the environment, and `agent-start.sh` for running something once.

`agent-start.sh` and `agent-stop.sh` are skipped for non-interactive runs.

Beyond shell, a profile can carry Python hooks that plug into the agent's own lifecycle events - session start, before and after a tool call, before compaction - through the `@hook` and `@statusline` decorators.

The profile itself is mounted read-only - it is shared across every workspace that resolves it, so a hook that needs to keep state writes to the session directory, the workspace, or a temporary path instead. That is what the sample's own hooks already do: `container-start.sh` reads the profile and writes into the agent's own settings, never back into the profile.

## Making skills and commands visible

The sample's `container-start.sh` symlinks the profile's `agents/`, `commands/` and `skills/` directories into the agent's configuration directory at the start of every session. That symlink is what makes them discoverable. A profile that replaces the hook without keeping that loop gets a profile whose skills never appear.

It also copies `config/claude.json` over the agent's settings, so changes made during a session do not leak back to the host, and links `config/.gitconfig`, so commits carry the identity it sets.

A `commands/*.md` file needs YAML frontmatter with a `name`. A `skills/<name>/SKILL.md` falls back to its directory name when frontmatter omits one. A file that fails to parse is dropped rather than half-loaded, so it never appears in the Skills panel or in `/` autocomplete.

![The Skills panel docked right listing the profile's commands, each with the way it is typed and a line saying what it does, and the same commands offered by the autocomplete that `/` opens in the message box](images/profiles-skills.png)

## Related pages

- [Configuration reference](../reference/configuration.md) - the `profile` key
- [Panels](../features/panels.md) - the Skills panel, where commands show up
- [Runtimes](runtimes.md) - which prompt file each runtime reads
