---
name: run-security
description: Audit and fix security issues only with 10 subagents. Use when the user says "run security".
---

# Run security

Same method as `run-check`, but only the security issues group runs. Read `.claude/skills/run-check/SKILL.md` for the shared rules (findings file, 20 at once cap, release rules, report format) and follow them.

## Agent budget: 10 per run

| Role | Agent | Count |
|---|---|---|
| Auditors (haiku) | `security-auditor` | 6 |
| Fixers (sonnet) | `security-fixer` | 2 |
| Verifiers (sonnet) | `finding-verifier` | 2 |

## Steps

1. Empty `<scratchpad>/findings.md`. Launch the 6 `security-auditor` agents in the background, one per slice: `app.js` in 3 parts, the edge functions, SQL plus migrations plus config plus workflows, then css plus sw plus the small web files. They grep the findings file before reporting and never edit repo files.
2. When all auditors are done, launch the 2 `security-fixer` agents: one owns `app.js`, one owns everything else. They work in parallel on different files only.
3. Run `node --check` on edited JS and `bash tests/run.sh` (must print ALL TESTS PASSED).
4. Launch 2 `finding-verifier` agents splitting the findings file in half and add up the verdicts (FIXED, PARTIAL, NOT_FIXED, INVALID).
5. Version bump, commit and push the branch following the release rules in `run-check`. Push to `main` only when the user says so.

- Anything that needs a dashboard setting or a secret (for example a new edge function secret) is listed for the user with the exact steps. Never fake it.
- Security fixes ship with the forced-update marker in the notes file (` !` after the version).

## Report (short, in the user's style)

- tasks and agents called
- security issues found and fixed (exact verifier numbers)
- what changed and what is still open
- what the user must do and what to test by hand
