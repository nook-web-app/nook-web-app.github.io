---
name: run-check
description: Full audit-and-fix pass over the Nook repo with a swarm of subagents. Use when the user says "run check" (or asks for a full code check for bugs, security and performance issues).
---

# Run check

A full pass over the whole repo: audit every line, fix what is real, prove it with the tests, report numbers. Agents cannot message each other, so they share one findings file.

## Setup

1. Findings file: `<scratchpad>/findings.md`, emptied at the start. One line per finding: `TYPE|file:line|short description|exact fix`, TYPE is BUG, SEC or PERF.
2. Keep a running count: agents launched, findings by type, fixes by type.

## 1. Audit (read only)

Split the code into slices of about 330 lines: `app.js` (about 8000 lines), `style.css`, `sw.js update.js guard.js supabase.js index.html manifest.webmanifest`, each edge function group under `supabase/functions/`, `supabase_setup.sql`, the other `*.sql` files, `supabase/migrations/`, `supabase/config.toml` and `.github/workflows/`. Launch one `code-auditor` agent per slice, in the background.

- At most 20 subagents run at once. Launch 20, then the rest as slots free up.
- Each auditor reads the findings file and greps it before reporting, so nothing is reported twice.
- Auditors never edit repo files.

## 2. Fix

One `code-fixer` agent per file group, never two agents editing the same file at once. Order: SQL and migrations first (new idempotent guarded migration, never edit applied ones), then edge functions, then `app.js`, `style.css`, `sw.js`.

- Fixes are minimal and match the surrounding style.
- Anything needing a dashboard setting or a secret is listed for the user, not faked.
- Fixers log every fix and skip to `<scratchpad>/fixed*.md` as `TYPE|file:line|change` or `SKIP|file:line|reason`.

## 3. Verify

1. `node --check` on edited JS, then `bash tests/run.sh` must print ALL TESTS PASSED.
2. Launch `finding-verifier` agents (about 55 findings each) to check every finding one by one against the current code. Verdicts: FIXED, PARTIAL, NOT_FIXED, INVALID.
3. Take another pass at the NOT_FIXED and PARTIAL ones when a safe fix exists.

## 4. Release rules for this repo

- Version bump: `APP_VERSION` in `app.js` and a new top entry in `CLAUDE_READ_THIS.txt` must match (the notes file has its own writing rules at the top: use `fixed: Fixed some bugs` and a ` !` after the version for security fixes). `sw.js` takes its version from `update.js` automatically.
- Commit on the designated branch with the attribution lines from the session reminder, push it.
- Push to `main` only when the user says so: that deploys migrations and edge functions through `.github/workflows/supabase.yml`. After a main push, check the GitHub runs.
- Never commit scratchpad or log files into the repo.

## 5. Report (short, in the user's style)

- tasks and agents called
- bugs, security and performance issues found and fixed (use the verifier's exact numbers)
- how the app got faster and what was done
- what is still open and what the user must do (secrets, dashboard settings, merge to main)
- risks to test by hand
