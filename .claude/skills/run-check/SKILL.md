---
name: run-check
description: Audit and fix bugs, security and performance with 28 subagents. Use when the user says "run check".
---

# Run check

A full pass over the whole repo: audit every line, fix what is real, prove it with the tests, report numbers. Agents cannot message each other, so they share one findings file.

## Setup

1. Findings file: `<scratchpad>/findings.md`, emptied at the start. One line per finding: `TYPE|file:line|short description|exact fix`, TYPE is BUG, SEC or PERF.
2. Keep a running count: agents launched, findings by type, fixes by type.

## Agent budget: 28 per run

| Group | Auditors (haiku) | Fixers (sonnet) | Total |
|---|---|---|---|
| bugs (`bug-auditor`, `bug-fixer`) | 6 | 2 | 8 |
| security (`security-auditor`, `security-fixer`) | 6 | 2 | 8 |
| performance (`perf-auditor`, `perf-fixer`) | 6 | 2 | 8 |
| shared (`finding-verifier`, sonnet) | | | 4 |
| **All** | 18 | 6 | **28** |

## 1. Audit (read only): three groups, 6 slices each

Every group audits the same 6 slices, so each one goes deep on one topic:

1. `app.js` lines 1 to about 2700
2. `app.js` about 2700 to 5400
3. `app.js` about 5400 to the end
4. every edge function under `supabase/functions/`
5. `supabase_setup.sql`, the other `*.sql` files, `supabase/migrations/`, `supabase/config.toml`, `.github/workflows/`
6. `style.css`, `sw.js`, `update.js`, `guard.js`, `supabase.js`, `index.html`, `manifest.webmanifest`

Launch all 18 in the background (under the 20 at once cap). Each auditor greps the findings file before reporting, so nothing is reported twice, including across groups. Auditors never edit repo files. Re-split slice 1 to 3 if `app.js` changed size a lot.

## 2. Fix: three groups, one after another (6 fixers)

`security-fixer`, then `bug-fixer`, then `perf-fixer` (sonnet). Inside each group 2 fixers run together: one owns `app.js`, the other owns everything else (SQL migration, edge functions, css, sw). Groups never overlap, so two agents never edit the same file at once.

- Fixes are minimal and match the surrounding style. New SQL goes in one new idempotent guarded migration, never edit applied ones.
- Anything needing a dashboard setting or a secret is listed for the user, not faked.
- Fixers log every fix and skip to `<scratchpad>/fixed*.md` as `TYPE|file:line|change` or `SKIP|file:line|reason`.

## 3. Verify (4 verifiers)

1. `node --check` on edited JS, then `bash tests/run.sh` must print ALL TESTS PASSED.
2. Launch 4 `finding-verifier` agents splitting the findings file into 4 equal ranges. Verdicts: FIXED, PARTIAL, NOT_FIXED, INVALID. Add up the verdicts for the exact numbers.
3. Retry NOT_FIXED and PARTIAL items yourself when a safe fix exists (no extra agents).

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
