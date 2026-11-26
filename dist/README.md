# harness trees

This folder is generated from `core/skills`, `core/agents`, `core/docs/guide`, `core/docs/harness`, `core/README.md`, `core/LICENSE`, and `core/plugin.json`. Do not edit it by hand.

Cursor uses `core/` directly. Claude Code installs `claude-code/`, and Codex installs `codex/`. Each tree carries only its own adapter from `core/docs/harness` and leaves out the rest of `core/`, such as `core/automations` and `core/assets`. A relative link to a core file that the tree leaves out points at that file on GitHub `main` instead.

Codex ignores the `disable-model-invocation` frontmatter, so `codex/` gives each skill that sets it an `agents/openai.yaml` that turns off implicit invocation.

After editing those sources, run `node scripts/generate-harness-trees.mjs` from the repository root and commit the result.
