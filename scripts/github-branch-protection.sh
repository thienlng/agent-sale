#!/usr/bin/env bash
# Apply branch protection to `main` matching .agents/rules/02-git-and-pr.md.
# Requires: gh CLI authenticated with admin rights on the repo, and a plan that supports
# branch protection on this repo (public repo, or GitHub Pro/Team for a private one).
# On GitHub Free with a private repo the API answers 403 "Upgrade to GitHub Pro…";
# until then the pre-push hook (no force push, no deleting main) is the only control.
# Usage: bash scripts/github-branch-protection.sh <owner>/<repo>
set -euo pipefail
REPO="${1:?usage: $0 <owner>/<repo>}"

gh api -X PUT "repos/${REPO}/branches/main/protection" \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["CI / check", "PR checks / conventions"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "require_last_push_approval": true
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON

# Squash-merge only, delete branches after merge
gh api -X PATCH "repos/${REPO}" \
  -f allow_squash_merge=true -f allow_merge_commit=false -f allow_rebase_merge=false \
  -f delete_branch_on_merge=true -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY >/dev/null

echo "Branch protection applied to ${REPO}:main"
