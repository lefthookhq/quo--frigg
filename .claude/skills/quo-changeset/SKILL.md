---
name: quo-changeset
description: Create a Changeset for the Quo Integrations repo before opening a PR. Use when a PR changes deployed code, when `npx changeset` needs interpreting, or when the pre-PR hook blocked `gh pr create` for a missing changeset.
---

# Quo Changeset

Every PR touching deployed code needs a file under `.changeset/`. The Changesets action aggregates them into a release PR that bumps the version and writes `CHANGELOG.md`.

## Add a changeset when the PR changes

- `backend/src/**`, `backend/infrastructure.js`, `backend/index.js`, `backend/serverless.js`
- Runtime deps in `backend/package.json`

## Skip (use `npx changeset --empty`) for

- Docs, `.github/workflows/**`, `scripts/**`, tests-only, `.claude/**`, `.env.example`

If unsure, add a patch. Over-counted bumps are harmless; missed ones aren't.

## Bump type — default **patch**

- **patch** — bug fix, error handling, dep patch bump (~90% of PRs)
- **minor** — new integration, new event/route, new opt-in capability
- **major** — breaking change to a deployed endpoint or config shape (rare; flag in #team-platform first)

## File

- Path: `.changeset/<kebab-name>.md`
- Good names: `zoho-not-subscribed-recovery.md`, `pipedrive-owner-attribution-fix.md`
- Avoid: `fix.md`, `pr-75.md`, `2026-04-17.md`

## Format

```markdown
---
'quo-integrations-frigg': patch
---

<1–3 short paragraphs>
```

Package key must be quoted and match the **root** `package.json` `name` exactly (`quo-integrations-frigg`). The repo is set up as a single-package repo — Changesets does not see `backend/` as a separate package because there's no `workspaces` field in root `package.json`.

The root package is `"private": true`, so `.changeset/config.json` sets `privatePackages: { version: true, tag: true }`. Without that flag, `changeset tag` silently skips tagging private packages — the version bump + CHANGELOG land on main but no `v{X.Y.Z}` tag is created, and the Release step looks successful while producing nothing.

## Body — user-visible effect first

Aim for: **what changed** (observable behavior, not implementation) → **why/context** (include integration IDs, endpoints, prod observation if that triggered it) → **scope** (which integrations/customers, under what conditions).

Write for someone triaging a regression three months from now.

**Good (from this repo):**

> Recover Zoho CRM integrations when notification renewal returns `NOT_SUBSCRIBED`. Zoho garbage-collects expired channels server-side; PATCH renewal then fails with `400 NOT_SUBSCRIBED` and the integration stays silently broken. `_renewZohoNotificationWithRetry` now falls back to `enableNotification` (POST), preserving `return_affected_field_values: true` and `notify_on_related_action: false` so webhook payloads keep field-level diff data. Non-NOT_SUBSCRIBED 400s still retry 3×; logical POST failures throw `HaltError` to skip pointless DLQ retries. Affected prod integrations: 7130, 7132, 7133, 7195.

**Avoid:**
- `Fix bug in zoho.` — no information
- `Fix PR #75.` — PR numbers rot
- `Added _reSubscribeNotification helper…` — implementation detail, not effect

## Create + commit

- Interactive: `npx changeset` → rename the auto-generated `gentle-apricots.md` to something descriptive.
- Manual: write `.changeset/<name>.md` directly.

Then `git add .changeset/<name>.md && git commit -m "chore: add changeset for <desc>"`.

## Hook

`.claude/hooks/check-changeset.sh` (PreToolUse, Bash) blocks `gh pr create` when no `.changeset/*.md` was added on this branch vs `origin/main`. If a changeset genuinely isn't needed, `npx changeset --empty` and commit.
