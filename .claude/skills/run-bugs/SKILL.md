---
name: run-bugs
description: Audit and fix bugs only with 10 subagents. Use when the user says "run bugs".
---

# Run bugs

Same method as `run-check`, but only the bugs group runs. Read `.claude/skills/run-check/SKILL.md` for the shared rules (findings file, 20 at once cap, release rules, report format) and follow them.

## Agent budget: 10 per run

| Role | Agent | Count |
|---|---|---|
| Auditors (haiku) | `bug-auditor` | 6 |
| Fixers (sonnet) | `bug-fixer` | 2 |
| Verifiers (sonnet) | `finding-verifier` | 2 |

## Steps

1. Empty `<scratchpad>/findings.md`. Launch the 6 `bug-auditor` agents in the background, one per slice: `app.js` in 3 parts, the edge functions, SQL plus migrations plus config plus workflows, then css plus sw plus the small web files. They grep the findings file before reporting and never edit repo files.
2. When all auditors are done, launch the 2 `bug-fixer` agents: one owns `app.js`, one owns everything else. They work in parallel on different files only.
3. Run `node --check` on edited JS and `bash tests/run.sh` (must print ALL TESTS PASSED).
4. Launch 2 `finding-verifier` agents splitting the findings file in half and add up the verdicts (FIXED, PARTIAL, NOT_FIXED, INVALID).
5. Version bump, commit and push the branch following the release rules in `run-check`. Push to `main` only when the user says so.

## Report (short, in the user's style)

- tasks and agents called
- bugs found and fixed (exact verifier numbers)
- what changed and what is still open
- what the user must do and what to test by hand
