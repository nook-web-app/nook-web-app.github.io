---
name: run-performance
description: A performance-only audit-and-fix pass of the Nook repo with a small subagent group. Use when the user says "run performance" (or asks only for performance). For everything at once use run-check.
---

# Run performance

Same method as `run-check`, but only the performance issues group runs. Read `.claude/skills/run-check/SKILL.md` for the shared rules (findings file, 20 at once cap, release rules, report format) and follow them.

## Agent budget: 10 per run

| Role | Agent | Count |
|---|---|---|
| Auditors (haiku) | `perf-auditor` | 6 |
| Fixers (sonnet) | `perf-fixer` | 2 |
| Verifiers (sonnet) | `finding-verifier` | 2 |

## Steps

1. Empty `<scratchpad>/findings.md`. Launch the 6 `perf-auditor` agents in the background, one per slice: `app.js` in 3 parts, the edge functions, SQL plus migrations plus config plus workflows, then css plus sw plus the small web files. They grep the findings file before reporting and never edit repo files.
2. When all auditors are done, launch the 2 `perf-fixer` agents: one owns `app.js`, one owns everything else. They work in parallel on different files only.
3. Run `node --check` on edited JS and `bash tests/run.sh` (must print ALL TESTS PASSED).
4. Launch 2 `finding-verifier` agents splitting the findings file in half and add up the verdicts (FIXED, PARTIAL, NOT_FIXED, INVALID).
5. Version bump, commit and push the branch following the release rules in `run-check`. Push to `main` only when the user says so.

- Back every performance claim with something measurable: fewer queries, fewer rows, fewer writes, smaller work per frame. In the final report say what got cheaper and by roughly how much.

## Report (short, in the user's style)

- tasks and agents called
- performance issues found and fixed (exact verifier numbers)
- what changed and what is still open
- what the user must do and what to test by hand
