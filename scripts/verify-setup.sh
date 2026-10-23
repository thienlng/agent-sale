#!/usr/bin/env bash
# Verify local environment + agent setup. Safe to run repeatedly.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
fail=0
ok()   { printf '  \033[32m✔\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✘\033[0m %s\n' "$1"; fail=1; }

echo "Node / pnpm"
want_node=$(cat .nvmrc)
have_node=$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1 || true)
[[ "$have_node" == "$want_node" ]] && ok "node $have_node" || bad "node $want_node required (found ${have_node:-none}). Use nvm/fnm: 'nvm use'"
command -v pnpm >/dev/null && ok "pnpm $(pnpm -v)" || bad "pnpm missing: corepack enable && corepack prepare"

echo "Agent setup"
[[ -f AGENTS.md ]] && ok "AGENTS.md" || bad "AGENTS.md missing"
for f in .agents/rules/0{1,2,3,4,5,6,7,8}-*.md; do [[ -f "$f" ]] && ok "$f" || bad "$f missing"; done
for link in .claude/skills .opencode/skill; do
  if [[ -L "$link" && -d "$link" ]]; then ok "$link -> $(readlink "$link")"; else bad "$link should be a symlink to ../.agents/skills"; fi
done
for s in .agents/skills/*/SKILL.md; do head -1 "$s" | grep -q '^---$' && ok "$s" || bad "$s has no front matter"; done
[[ -f .mcp.json && -f opencode.json && -f .codex/config.toml ]] && ok "MCP configs present" || bad "MCP config missing"

echo "Task board"
grep -q '^## In progress' TODO.md && grep -q '^## Backlog' TODO.md && ok "TODO.md sections" || bad "TODO.md malformed"
for f in todo/T-*.md todo/done/T-*.md; do [[ -f "$f" ]] || continue; head -1 "$f" | grep -q '^---$' || bad "$f missing front matter"; done

echo "Dependencies"
if [[ ! -d node_modules ]]; then echo "  installing…"; pnpm install --frozen-lockfile; fi
ok "node_modules present"
[[ -f .husky/pre-commit && -f .husky/commit-msg ]] && ok "git hooks" || bad "husky hooks missing (run pnpm install)"

echo "Gate: pnpm check"
if pnpm check >/tmp/agent-sales-check.log 2>&1; then ok "pnpm check passed"; else bad "pnpm check failed — see /tmp/agent-sales-check.log"; fi

if [[ $fail -eq 0 ]]; then echo "All good. Read AGENTS.md, then take a task from TODO.md."; else echo "Fix the items marked ✘."; exit 1; fi
