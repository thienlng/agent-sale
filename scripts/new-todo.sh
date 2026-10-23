#!/usr/bin/env bash
# Create a new task file from todo/_template.md and append a Backlog line to TODO.md.
# Usage: pnpm todo:new "Title in imperative English"   (or: bash scripts/new-todo.sh "Title")
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TITLE="${1:-}"
if [[ -z "$TITLE" ]]; then
  echo "usage: $0 \"Task title\"" >&2
  exit 1
fi

# Next ID = highest existing T-<n> in todo/ and todo/done/ + 1
last=$(ls "$ROOT"/todo/T-*.md "$ROOT"/todo/done/T-*.md 2>/dev/null \
  | sed -E 's#.*/T-([0-9]+)[a-z]?-.*#\1#' | sort -n | tail -1)
next=$(( 10#${last:-0} + 1 ))   # 10# avoids octal parsing of "008"
id=$(printf 'T-%03d' "$next")

slug=$(printf '%s' "$TITLE" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g' | cut -c1-50)
file="todo/${id}-${slug}.md"
today=$(date +%F)

sed -e "s/^id: T-000/id: ${id}/" \
    -e "s/^title: .*/title: ${TITLE//\//\\/}/" \
    -e "s/^created: .*/created: ${today}/" \
    -e "s/^updated: .*/updated: ${today}/" \
    -e "s/^- YYYY-MM-DD — created\./- ${today} — created./" \
    "$ROOT/todo/_template.md" > "$ROOT/$file"

line="- [ ] ${id} ${TITLE} — @unassigned · [details](${file})"
# Insert under "## Backlog" (append at end of that section = before next "## " heading)
awk -v line="$line" '
  /^## Backlog/ { print; inb=1; next }
  inb && /^## / { print line; print ""; inb=0 }
  inb && /^$/ { blank=1; next }
  { if (blank && inb) { print ""; blank=0 } print }
  END { if (inb) print line }
' "$ROOT/TODO.md" > "$ROOT/TODO.md.tmp" && mv "$ROOT/TODO.md.tmp" "$ROOT/TODO.md"

echo "created $file and added to TODO.md (Backlog)"
