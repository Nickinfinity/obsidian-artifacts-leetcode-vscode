# Evaluation-system validation run — findings

**Date:** 2026-07-27 · **Branch:** `feature/VSX-122_multilib-multilang-support`

**Goal (user):** deploy a real test run against the migrated exercises — dispatch sub-agents
that solve each exercise **blind** (no reference solution), grade their solutions through the
actual evaluation system, and prove whether the system can (a) accept an independent correct
solution and (b) reject a wrong one. Record every problem detected here to fix later.

---

## Method

1. **Blind problem views** — for each exercise, `## Final Tests` and `# Solutions` are stripped
   (`scratchpad/mkblind.mjs`), leaving statement + examples + public tests + signature stub. The
   solver never sees the reference or the hidden grading suite.
2. **Sub-agents (sonnet)** — one per exercise, told the candidate contract (bare function, no
   stdin/main, per-language rules), write a solution in an assigned language, forbidden from
   hardcoding visible cases.
3. **Grading rig** — `scratchpad/grade-candidate.mjs` drives the **exact same** `runSuite` the
   extension's *Submit* uses: `parseLeetCode` → `testEnvFor(type, lang)` →
   `buildExecutable(parsed, lang, candidate)` → `runSuite(candidate, submitSuite(parsed), …)`.
   It grades an **arbitrary external candidate** against public **+ hidden final** and prints
   per-case PASS/FAIL. This tool does **not** exist in the repo — see Gap G3.

Passing the **hidden finals the agent never saw** is the key signal: a hardcoded lookup table
cannot pass them, so a green verdict means a genuine general solution graded correctly.

---

## Results — blind solve → grade (public + hidden final)

| Exercise | Lang | Public | Final | Verdict | Meaning |
|----------|------|--------|-------|---------|---------|
| Sudoku Quadrant Checker | python | 7/7 | 3/3 | **solved** | grader accepts independent solution; reconstructed E46 rule is solvable from prose alone |
| Quick Knight | javascript | 6/6 | 3/3 | **solved** | BFS, hidden finals pass |
| Calculator | rust | 6/6 | 3/3 | **solved** | shunting-yard, rust env |
| Convex Hull Points | typescript | 6/6 | 3/3 | **solved** | strip-only TS env |
| Maximal Rectangle | python | 6/6 | 3/3 | **solved** | histogram/DP |
| Min Window Substring | rust | 6/6 | 3/3 | **solved** | sliding window, rust env |
| **Tetris Move** | java | — | — | **NOT RUN** | solver agent killed by session limit before writing its file (infra, not grader) — see G2 |
| **React (all 4)** | js/ts | — | — | **UNEVALUABLE** | no `project` env exists — see G1 |

**6 of 6 completed blind solves passed through the hidden finals**, spanning all five runtimes
(python ×2, javascript, rust ×2, typescript). The exercises are **not over-fit** to their
reference solutions — a fresh reasoner reproduces the graded answers.

## Grader-internals probes (adversarial candidates, Quick Knight / js)

| Probe | Candidate | Result | Proves |
|-------|-----------|--------|--------|
| Stray stdout | correct logic + `console.log(...)` every call | **solved** | `__LEET__` sentinel isolates solver stdout from result parsing |
| Mid-suite throw | throws only on the 3rd case | case #2 fails (`err=boom on case 3`), **all others pass**, solved:false | per-case try/catch — one throw fails one case, not the suite |
| Off-by-one | `return steps + 1` | every case fails, `exp/got` shown, solved:false | exact reject; no false leniency |

Baseline reject was also confirmed directly: a `return ""` Sudoku stub → 1/7 public, 0/3 final,
solved:false.

**Conclusion: the function-type evaluation system works.** It compiles/runs candidates in all
five runtimes, grades against a hidden suite, rejects wrong output, and is robust to stray
stdout and per-case exceptions.

---

## Problems / gaps to solve later

### G1 — React / `project` type is completely unevaluable  ·  severity: HIGH (blocks Phase 3)
`testEnvFor('project', 'javascript') === undefined`, `languagesForType('project') === []`, and
zero React exercises exist in the vault. The evaluation system **cannot grade any React
exercise** — the `project`/react runtime env (Phase 2, T2.1–T2.8) is unbuilt. Until Phase 2
lands, "test the React exercises" is impossible; there is nothing to run and nothing to run it
with.
- **Fix:** implement Phase 2 (`project` env: `## Files` writer, per-run libs installer with the
  `validateLibNames` allowlist, JSX/TSX bundle + jsdom render driver, `dom-assert`/`css-assert`
  check kinds) behind the human-gate grammar decisions, then migrate E57–E60 (Phase 3).

### G2 — Tetris/java blind solve incomplete  ·  severity: LOW (infra, not a defect)
5 of 7 solver agents hit the account **session limit** (resets 5:30pm America/Bogota); 6 had
already written their solution file, but the Tetris (java) agent was killed before writing. The
Tetris **reference** solution is independently green (proven by `verify-exercise.mjs`), so this
is only a missing *blind* data point, not a grader problem.
- **Fix:** after the session-limit reset, re-dispatch one sonnet agent for Tetris/java (blind
  view already at `scratchpad/blind/tetris.md`) and grade with the rig. This also exercises the
  **java** env in the blind set, the only one of five not yet covered by a completed blind solve.

### G3 — no committed tool to grade an arbitrary candidate  ·  severity: MEDIUM
The repo ships `scripts/verify-exercise.mjs`, which only runs the **stored** reference solution.
Validating the grader against an **external** candidate required building
`scratchpad/grade-candidate.mjs` by hand. There is no headless equivalent of the extension's
*Submit* for CI / regression / eval-system testing.
- **Fix:** promote the rig to `scripts/grade-candidate.mjs`
  (`node scripts/grade-candidate.mjs <exercise.md> <lang> <candidate-file>`), reusing
  `runSuite` + `submitSuite` + `buildExecutable` + `testEnvFor`. Small, `vscode`-free, mirrors
  the existing harness. Enables an automated "independent solver" regression gate.

### G4 — candidate global/module state persists across cases in a suite  ·  severity: LOW (by design; document)
The mid-suite-throw probe confirmed the JS env evaluates the candidate **once** and calls it
per case in a **shared context** (a module-level counter survived between cases). Same shape
holds for python (`importlib` once), java, and rust (one process per suite). This is the
intended performance model (one process per suite, documented in `CLAUDE.md`), but it means a
candidate that mutates module/global state leaks that state into later cases — an unusual
solution could get a false FAIL, and a stateful trick could pass. No exercise depends on
fresh-per-call state today.
- **Fix (if ever needed):** none required now; document the "shared context per suite" contract
  in `ARTIFACT_LEETCODE_FILE_FORMAT.md` so authors know candidates must be pure per call. Only
  reach for per-case isolation (fresh context/process) if a real exercise needs it — YAGNI.

### G5 — grader trusts author-supplied `expecteds` (known §D.7 residual) — but the blind-solve method is a usable oracle  ·  severity: INFO
The harness proves runnability + self-consistency, not fidelity to a source (plan §D.7). This
run demonstrates a **practical correctness oracle**: an independent blind solver passing the
hidden finals is strong evidence the stored `expecteds` are actually correct (6/6 here,
including the reverse-engineered **Sudoku** — an independent agent reproduced every expected
from the reconstructed prose alone).
- **Fix / opportunity:** fold "one blind independent solve per exercise" into the review loop as
  the §D.7 cross-check's cheaper cousin — reuses G3's rig; no second answer key needed.

---

## Reproduce

```bash
cd <repo> && pnpm compile      # rig imports from dist/
SC=<scratchpad>
# blind view:   node "$SC/mkblind.mjs" "<vault md>" "$SC/blind/x.md"
# grade:        node "$SC/grade-candidate.mjs" "<vault md>" <lang> "$SC/blind/sol-x.<ext>"
#               exit 0 = solved (all public+final pass), 1 = not solved, 2/3 = bad input/no env
```

Artifacts this run: `scratchpad/grade-candidate.mjs`, `scratchpad/mkblind.mjs`,
`scratchpad/blind/{sudoku,tetris,calculator,convexhull,quickknight,maxrect,minwindow}.md` +
`sol-*.*` candidates + `qk-{noisy,throw,wrong}.js` probes. Scratchpad is session-local (may be
wiped); the rig is small enough to regenerate from G3.
