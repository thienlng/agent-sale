# .agents — tool-agnostic agent configuration

Single source of truth for how coding agents work in this repo. Entry point: `/AGENTS.md`.

| Path | Purpose |
|---|---|
| `rules/` | Mandatory rules, numbered. Every agent must read all of them before working. |
| `skills/<name>/SKILL.md` | Reusable step-by-step workflows (Agent Skills format: YAML front matter + markdown). |

## How each tool finds this

| Tool | Instructions | Rules (`.agents/rules/*.md`) | Skills | MCP |
|---|---|---|---|---|
| Claude Code | `CLAUDE.md` → `@AGENTS.md` | loaded on instruction from `AGENTS.md` | `.claude/skills` → symlink to `.agents/skills` | `.mcp.json` |
| OpenAI Codex | `AGENTS.md` (native; root → cwd chain, 32 KiB combined limit) | loaded on instruction from `AGENTS.md` | `.agents/skills` (native; symlinks followed) | `.codex/config.toml` (project must be trusted) |
| OpenCode | `AGENTS.md` (native; `CLAUDE.md` only as fallback) | **auto-loaded** via `instructions` glob in `opencode.json` | `.agents/skills` (native; also scans `.claude/skills`, `.opencode/skills`) | `opencode.json` |
| Gemini CLI | `GEMINI.md` → points to `AGENTS.md` | on instruction | — | `.gemini/settings.json` (add when needed) |
| Cursor / Copilot / others | `AGENTS.md` (native in most tools) | on instruction | — | tool-specific |

Verified against the official docs on 2026-10-23 (OpenCode: docs/rules, docs/skills, docs/mcp-servers; Codex: agent-configuration/agents-md, build-skills, extend/mcp). Notes:

- Codex applies `.codex/config.toml` (MCP servers) only when the project is trusted: accept the trust prompt on first launch in this directory, or add `[projects."<absolute repo path>"] trust_level = "trusted"` to `~/.codex/config.toml`. Trust is per exact path, not inherited from a parent directory.
- Keep `AGENTS.md` well under 32 KiB (Codex truncates the combined instruction chain beyond `project_doc_max_bytes`). Rules stay in separate files on purpose.
- OpenCode scans both `.agents/skills` and `.claude/skills`; since `.claude/skills` is a symlink to the same directory the skills resolve to identical files. If your OpenCode version warns about duplicate skill names, that is why — it is harmless.
- Do not copy skills into tool-specific folders; copies drift. Run `bash scripts/verify-setup.sh` to check the layout.

## Changing rules or skills

Rules and skills are **protected**: change them only when a human explicitly asks, through a reviewed PR. Keep rules short; put long explanations in `docs/`.
