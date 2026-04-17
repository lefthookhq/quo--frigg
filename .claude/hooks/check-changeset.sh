#!/usr/bin/env bash
# PreToolUse hook for Bash. Blocks `gh pr create` on the Quo repo when no
# .changeset/*.md file has been added on the current branch vs the base branch.
#
# Exit codes:
#   0 = pass through, no interference
#   2 = block and send the stderr message back to Claude

set -euo pipefail

input=$(cat)

# Extract the tool command safely; bail if jq isn't available (don't block on infra issues).
if ! command -v jq >/dev/null 2>&1; then
    exit 0
fi
command=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')

# Only gate `gh pr create` invocations (anywhere in the command string so piped/chained
# forms still match, e.g. `cd foo && gh pr create ...`).
if ! printf '%s' "$command" | grep -qE '(^|[[:space:]&;|])gh[[:space:]]+pr[[:space:]]+create'; then
    exit 0
fi

# Scope: only the Quo repo (prevents surprises if this hook ever reaches a global config).
project_dir="${CLAUDE_PROJECT_DIR:-$(pwd)}"
case "$project_dir" in
    */quo--frigg*) ;;
    *) exit 0 ;;
esac

cd "$project_dir" 2>/dev/null || exit 0

# Determine base branch (main, then master). If neither is reachable, skip the check
# rather than block on environmental problems.
base=main
if ! git rev-parse --verify "origin/$base" >/dev/null 2>&1; then
    base=master
    git rev-parse --verify "origin/$base" >/dev/null 2>&1 || exit 0
fi

# Look for any NEW .changeset/*.md file (excluding the README) added on this branch.
added=$(git diff --name-only --diff-filter=A "origin/$base"...HEAD 2>/dev/null \
    | grep -E '^\.changeset/[^/]+\.md$' \
    | grep -v '^\.changeset/README\.md$' \
    || true)

if [ -n "$added" ]; then
    exit 0
fi

cat <<'MSG' >&2
Pre-PR check blocked: no changeset file added on this branch.

Quo uses Changesets for versioning (see CLAUDE.md > "Creating releases with Changesets"). Every user-visible change should include a `.changeset/<name>.md` file.

Next step: invoke the `quo-changeset` skill for format + content guidance, then commit the changeset before retrying `gh pr create`.

If the PR is genuinely docs-only / CI-only / tooling and needs no version bump, run `npx changeset --empty` and commit the empty changeset.
MSG
exit 2
