---
name: quo-changeset
description: Create a properly-structured Changeset file for the Quo Integrations repo before opening a PR. Use whenever a PR changes code under backend/ (or anything user-visible), when `npx changeset` output needs interpreting, or when the pre-PR hook has blocked `gh pr create` for a missing changeset. Explains bump type selection, frontmatter, and the summary content the team expects.
---

# Quo Changeset Guide

Quo ships from a Changesets-based CD pipeline. Every PR that touches deployed code needs a changeset; the Changesets action aggregates them into a release PR that bumps the version, updates `CHANGELOG.md`, and tags a GitHub Release. Missing a changeset means your fix will not be part of a release until someone adds one after the fact.

## When a changeset is needed

Add a changeset when the PR:
- Changes code under `backend/src/**` (integration logic, api modules, routes, handlers, base classes).
- Changes deployed infrastructure (`backend/infrastructure.js`, `backend/index.js`, `backend/serverless.js`).
- Bumps `@friggframework/*` or other runtime deps in `backend/package.json`.

Skip it (use `npx changeset --empty` and commit the empty file so the hook is satisfied):
- Docs-only (`README.md`, `docs/**`, comments in `.md`).
- CI/CD pipeline edits (`.github/workflows/**`, `scripts/**`) that don't change the deployed artifact.
- Tooling or test-only changes that don't affect runtime behavior.
- Local-only config (`.claude/**`, `.env.example`).

If in doubt, add a patch changeset — an over-counted version bump is harmless; a missed one is not.

## Bump type

The repo deploys as a single package (`quo-integrations-frigg-backend`). There is no downstream consumer importing it as a library, so the bump type is purely a semantic signal for the release notes.

- **patch** — bug fixes, error-handling improvements, log changes, dependency patch bumps, any change that preserves existing observable behavior (~90% of PRs). Examples from recent history: "fix(zoho): fall back to enableNotification on NOT_SUBSCRIBED", "fix(pipedrive): load integration config from DB in settings routes", "chore: bump @friggframework/core".
- **minor** — new integration, new event handler or route, new user-facing capability, new config option with a safe default. Example: adding a fresh integration class, or adding a new webhook event that's opt-in.
- **major** — breaking change to a deployed endpoint or the public shape of an integration's config (rare). If you're reaching for major, call it out in #team-platform first.

Default to **patch** unless you're shipping net-new capability.

## File location + naming

- Directory: `.changeset/` at the repo root.
- Filename: kebab-case, descriptive-but-short, `.md` extension.
  - Good: `zoho-not-subscribed-recovery.md`, `pipedrive-owner-attribution-fix.md`, `axiscare-phone-format.md`.
  - Avoid: generic names (`fix.md`, `update.md`), PR numbers (`pr-75.md`), dates (`2026-04-17.md`).
- One changeset per PR is the norm. Split only if a single PR legitimately ships two independent changes that each merit their own release note.

## Frontmatter

```markdown
---
'quo-integrations-frigg-backend': patch
---
```

- Package key MUST match the `name` field in `backend/package.json` exactly: `quo-integrations-frigg-backend`.
- Bump type is `patch` | `minor` | `major`.
- Quotes around the package key are required (YAML-safe).

## Body — what to write

The body becomes a bullet in `CHANGELOG.md` and the GitHub Release notes. Write for the person triaging a regression three months from now, not for yourself today.

Structure to aim for (1–3 short paragraphs):

1. **What changed** — one sentence, user-visible effect first. Not the implementation.
2. **Why / context** — what was broken or needed. Link customer IDs, integration IDs, or a prod observation if that's the trigger. Daniel's note patterns apply: be specific, include IDs and endpoints.
3. **Scope / affected users** — which integrations, which customers, under what conditions the change fires.

### Good example (from this repo)

```markdown
---
'quo-integrations-frigg-backend': patch
---

Recover Zoho CRM integrations when notification renewal returns `NOT_SUBSCRIBED`. Zoho garbage-collects expired notification channels server-side; the 7-day renewal then PATCHes a channel Zoho no longer knows about and fails with `400 NOT_SUBSCRIBED`, leaving the integration silently broken (no webhook events, no recovery). `_renewZohoNotificationWithRetry` now falls back to `enableNotification` (POST) to re-create the subscription, preserving the original `return_affected_field_values: true` and `notify_on_related_action: false` flags so webhook payloads keep field-level diff data. Non-NOT_SUBSCRIBED 400s still retry 3×; logical failures on the re-subscribe POST throw `HaltError` so the SQS message is discarded instead of wasting retries + hitting the DLQ. Affected prod integrations at the time of the fix: 7130, 7132, 7133, 7195.
```

### Bad examples

```markdown
---
'quo-integrations-frigg-backend': patch
---

Fix bug in zoho.
```
*(No information. The CHANGELOG becomes noise.)*

```markdown
---
'quo-integrations-frigg-backend': patch
---

Fix PR #75.
```
*(PR number ages out of context — CHANGELOGs live longer than PR UIs.)*

```markdown
---
'quo-integrations-frigg-backend': patch
---

Added _reSubscribeNotification helper and _isNotSubscribedError helper to _renewZohoNotificationWithRetry.
```
*(Implementation detail, not user-visible effect. Reads like a commit message.)*

## How to create one

Two paths:

1. **Interactive:** from the repo root, run `npx changeset` and follow prompts (select package → bump type → summary). This writes a file with an auto-generated name like `gentle-apricots-laugh.md`; rename it to something descriptive before committing.
2. **Manual:** create the file directly under `.changeset/<descriptive-name>.md` with the frontmatter + body above. Faster once you know what you're writing.

Then commit the changeset as part of your PR branch:

```bash
git add .changeset/<your-file>.md
git commit -m "chore: add changeset for <short description>"
git push
```

## Verifying the hook

The local `check-changeset.sh` PreToolUse hook blocks `gh pr create` on this repo when no changeset file has been added on the current branch vs `origin/main`. If it blocks you and a changeset genuinely isn't needed, run `npx changeset --empty` and commit the resulting empty file.
