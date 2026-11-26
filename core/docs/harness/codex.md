# pstack in Codex

pstack skills use Cursor names. In Codex, read this file once per session, then map each Cursor name in a skill with the tables below. `<pstack>` means the folder that holds `skills/` and `docs/`. A plugin install puts it under `$CODEX_HOME/plugins/cache/`, and `$CODEX_HOME` defaults to `~/.codex`. If a Cursor field has no row, drop it and say so. Never pass a field or value the tool schema rejects.

These rows were checked against Codex CLI 0.144.1. Sources lists where each fact comes from.

## Tools

| Cursor | Codex |
| --- | --- |
| `Task` | `spawn_agent`. It returns the agent id before the agent finishes. Collect the result with `wait_agent`, then call `close_agent`, because a finished agent counts toward the concurrency limit until you close it. `spawn_agent` spawns only when a user, `AGENTS.md`, or skill asks for subagents, and a pstack step that spawns an agent is that skill instruction. |
| `AskQuestion` | `request_user_input`, which Codex offers only in Plan mode. In Default mode and in `codex exec`, ask in plain text. |
| Open a todolist, or copy steps into the todolist tool | `update_plan`. |
| Run another pstack skill (`/name` or "the **name** skill") | Read `<pstack>/skills/<name>/SKILL.md` and follow it. When you tell the user to type it, write `$pstack:<name>`. |
| `Grep`, `Glob` | `rg` in the shell. |

## Subagent fields

`spawn_agent` takes `message`, `agent_type`, `model`, and `reasoning_effort`. Codex plugins cannot ship agent roles, so pstack's agents run as built-in roles that read their file.

| Cursor | Codex |
| --- | --- |
| `subagent_type: generalPurpose` | `agent_type: "default"` |
| `poteto-agent`, `comment-sicko` | `agent_type: "default"`, with a `message` whose first line is `Read <pstack>/agents/<name>.md and act as that agent.` |
| The `model:` line in `poteto-agent`'s file | It holds a Cursor slug. Pass `model` and `reasoning_effort` on every `spawn_agent` call for `poteto-agent`, mapped with the Models table, and ignore that line. |
| `readonly: true` | `agent_type: "explorer"`. A subagent runs in the parent's sandbox, so the brief also says "do not edit files", and you check `git status` afterward. |
| `readonly: false` | `agent_type: "worker"` |
| `environment: "cloud"` | Every subagent works in the parent's folder. Run `git worktree add` for the branch or commit the worker needs, and name that path in the brief. |
| `environment: "local"` | Omit. |
| `cloud_base_branch: <b>` | Tell the worker to check out `<b>` first. |
| `run_in_background: true` | Omit. `spawn_agent` returns before the agent finishes. |
| `resume` | `send_input` with the agent id while the agent is open. `resume_agent` reopens a closed one. |
| `file_attachments` | List the paths in the `message`. |

## Models

| Cursor | Codex |
| --- | --- |
| `claude-<family>-<version>-<effort>[-fast]`, such as `claude-opus-5-5-xhigh`, or a `gemini-*` or `grok-*` slug | Omit `model` so the agent runs on the session model, and say so. Pass the effort token as `reasoning_effort`, such as `"xhigh"`, when the `spawn_agent` description lists it for the session model. Drop `-fast`. A panel that wants one seat per vendor runs every seat on OpenAI models. |
| A `gpt-*` slug | Pass it as `model` only when the `spawn_agent` description lists it. Otherwise omit `model`, and say so. |
| `auto` or `inherit-parent` | Omit `model` and `reasoning_effort`. |
| The `pstack-models.mdc` rule, `~/.cursor/rules/pstack-models.mdc` | `$CODEX_HOME/pstack-models.md`. Codex does not load it into sessions, so read it before you choose a role's model. If the file or the role's line is missing, use the skill's default slug. |
| A role value `<model> <effort>`, such as `gpt-5.6-sol high` | `model: "gpt-5.6-sol"` and `reasoning_effort: "high"` |

## setup-pstack

Codex has no folder of rules that it loads into every session, so `setup-pstack` writes a file that skills read when they choose a model. Follow its steps with these changes:

- Detect. The detected models are the ones the `spawn_agent` description lists, each with the reasoning efforts it lists. Write a real model as `<model> <effort>`, such as `gpt-5.6-sol xhigh`. The effort is the last token, so the budget step works as written.
- Defaults. Each default slug becomes the first model the `spawn_agent` description lists, at the slug's effort. `claude-opus-5-5-xhigh-fast` is `<model> xhigh`, `claude-opus-5-5-high-fast` and `claude-fable-5-2-high` are `<model> high`, and `gemini-4-neon-xhigh` is `inherit-parent`.
- Write. Write `$CODEX_HOME/pstack-models.md` with no frontmatter, then the comment lines, the `# budget` line, and one line per role from step 5. Overwrite the whole file. Never put the role lines in `AGENTS.md`.

## Paths

| Cursor | Codex |
| --- | --- |
| `.cursor/skills/`, `~/.cursor/skills/` | `.agents/skills/` in any folder from the repository root down to the working folder, and `~/.agents/skills/` |
| `~/.cursor/plugins/`, `.cursor-plugin/plugin.json` | `$CODEX_HOME/plugins/cache/`, `.codex-plugin/plugin.json` |
| `.cursor/rules/*.mdc`, always-applied rules | `AGENTS.md`. Codex loads `$CODEX_HOME/AGENTS.md` and each `AGENTS.md` from the repository root down to the working folder. Codex never reads `.mdc` files. The model rule is the exception. See Models. |
| `https://github.com/cursor/plugins/blob/main/pstack/<path>` | `<pstack>/<path>` when that file exists. The plugin ships the skills, `agents/`, `docs/guide/`, and `README.md`. Read the local copy and never fetch it. Give the user the URL when they need a link. |
| Transcripts in `~/.cursor/projects/<slug>/agent-transcripts/` | `$CODEX_HOME/sessions/<YYYY>/<MM>/<DD>/rollout-<time>-<thread id>.jsonl`, one file per thread across all workspaces. The first line has `"type":"session_meta"`, and its `payload.cwd` is the workspace, so read only files whose `cwd` is this workspace. The newest of those is the current session. A subagent's file names its parent in `payload.source.subagent.thread_spawn.parent_thread_id`. |

## Cursor-only features

Codex has no Cursor Automations, Bugbot, Cursor cloud agents, or built-in PR tool. When a step needs one, put one line in your reply, `Skipped in Codex: <step>. <reason>.`, then go on to the next step. Do not stop, ask, or retry. When a later step needs what the skipped step made, such as a URL or a key, leave a placeholder and name it in the line.

| Cursor | Codex |
| --- | --- |
| Cursor Automations: routines, `update_state` routine calls, `api2.cursor.sh/automations` webhooks, routine wakes, and `SendToUser` secret requests | Skip with the line. |
| Bugbot | Bugbot comments on a GitHub PR are ordinary review threads, so triage them with the forge command that the step gives. Skip a step that starts, waits for, or configures Bugbot when the PR has no Bugbot check or comment. |
| Cursor cloud agents | `environment: "cloud"` maps to a worktree, as in Subagent fields. Skip a step that needs the cloud agent itself, such as its dashboard status or its own machine. |
| A built-in PR tool | Use the forge command that the step gives, such as `gh pr create`. That is not a skip, so write no line. |

## Sources

Source files are in `openai/codex` at tag `rust-v0.144.1`, under `https://github.com/openai/codex/blob/rust-v0.144.1/codex-rs/`.

- Subagent tools, their fields, and the rule that a skill must ask for subagents: `core/src/tools/handlers/multi_agents_spec.rs`. Built-in roles `default`, `worker`, and `explorer`: `core/src/agent/role.rs`. Agent roles load only from `agents/` beside a `config.toml`, not from plugins: `core/src/config/agent_roles.rs`. Subagents inherit the parent's sandbox: https://learn.chatgpt.com/docs/agent-configuration/subagents
- `request_user_input` modes: `tools/src/tool_config.rs`. `update_plan`: `core/src/tools/handlers/plan_spec.rs`.
- Skill folders, frontmatter, and the `agents/openai.yaml` policy: `core-skills/src/loader.rs` and https://learn.chatgpt.com/docs/build-skills. A plugin's skills are named `<plugin>:<skill>`: `core-skills/src/loader/namespace.rs`. A `$<plugin>:<skill>` mention selects from every enabled skill, explicit-only ones included: `core/src/session/turn.rs`.
- Plugin manifest paths: `utils/plugins/src/plugin_namespace.rs`. Marketplace paths: `core-plugins/src/marketplace.rs`. Plugin cache: `core-plugins/src/store.rs`. Plugins and marketplaces: https://developers.openai.com/plugins/build/plugins
- `AGENTS.md`: `core/src/agents_md.rs`. Session files: `rollout/src/recorder.rs` and the `SessionMeta` type in `protocol/src/protocol.rs`.
