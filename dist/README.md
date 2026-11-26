# harness trees

This folder is generated from `core/skills`, `core/agents`, `core/docs/guide`, `core/docs/harness/claude-code.md`, `core/README.md`, `core/LICENSE`, and `core/plugin.json`. Do not edit it by hand.

Cursor uses `core/` directly, and Claude Code installs `claude-code/`. The tree leaves out the rest of `core/`, such as `core/automations` and `core/assets`. A relative link to a core file that the tree leaves out points at that file on GitHub `main` instead.

After editing those sources, run `node scripts/generate-harness-trees.mjs` from the repository root and commit the result.
