# .agents — tool-agnostic agent configuration

Single source of truth for how coding agents work in this repo. Entry point: `/AGENTS.md`.

| Path | Purpose |
|---|---|
| `rules/` | Mandatory rules, numbered. Every agent must read all of them before working. |
| `skills/<name>/SKILL.md` | Reusable step-by-step workflows (Agent Skills format: YAML front matter + markdown). |

## How each tool finds this

| Tool | Instructions | Skills | MCP |
|---|---|---|---|
| Claude Code | `CLAUDE.md` → `@AGENTS.md` | `.claude/skills` → symlink to `.agents/skills` | `.mcp.json` |
| OpenAI Codex | `AGENTS.md` (native) | `.agents/skills` (native, Agent Skills standard) | `.codex/config.toml` |
| OpenCode | `AGENTS.md` (native) | `.opencode/skill` → symlink to `.agents/skills` | `opencode.json` |
| Gemini CLI | `GEMINI.md` → points to `AGENTS.md` | — | `.gemini/settings.json` (add when needed) |
| Cursor / Copilot / others | `AGENTS.md` (native in most tools) | — | tool-specific |

If your tool does not discover `.agents/skills`, add a symlink from its skills directory to `.agents/skills` (do not copy — copies drift). Run `bash scripts/verify-setup.sh` to check the symlinks.

## Changing rules or skills

Rules and skills are **protected**: change them only through a task in `TODO.md` that explicitly asks for it, reviewed by a human. Keep rules short; put long explanations in `docs/`.
