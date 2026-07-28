# Progress ledger — eval-fixes

Derived from [`plan.md`](plan.md) (the authority). **Orchestrator writes this; workers never do.**
Statuses: `todo` · `wip` · `done` · `blocked` · `dropped` (with reason). Record the **test count on every
gate run** — a silent drop means a deleted test (`CLAUDE.md`: allowed only loudly, relocated assertion named).

Baseline gate (start of this plan): **740 passing** (685 committed-portable + 55 vault), lint + tsc clean.
**Re-run the gate before the first dispatch to reconfirm 740** — 55 of those are vault-dependent
(`coderbyte-migration.test.ts`); a missing/moved vault silently drops them and corrupts every wave's
silent-drop check.

**Supersedes coderbyte-migration Phase 2 + Phase 3** (plan §A): on adopting this plan, mark coderbyte's
`T2.1–T2.8` and `E57–E60` rows `dropped → tracked in eval-fixes` so no task dispatches twice.

## Phase A — quick fixes (G2–G5)

| Task | Wave | Owner | Status | Test count | Gate | Notes |
|------|------|-------|--------|-----------|------|-------|
| TA.1 grade-candidate CLI (G3) | A1 | orchestrator | done | 747 (+7) | green | `scripts/grade-candidate.mjs` + `test/grade-candidate.test.ts`; exits 0/1/2/3; **final-case failures masked as `hidden`** so grading cannot leak the hidden suite; argv-only paths, candidate reaches child as file contents via `runSuite` |
| TA.3 document G4 + G5 | A1 | orchestrator | done | 747 | green | format spec §6 "candidate contract — pure per call"; CLAUDE.md gains an **Artifact harnesses** block (both CLIs were undocumented) + the blind-solve-oracle note |
| TA.2a Tetris text piece defs | A2 | orchestrator | done | — | verify OK | vault-only: ASCII + `(row,col)` table for all 7 base orientations + distinct-rotation counts, beside the image. Verify green before **and** after; `git status` shows no repo edit |
| TA.2b Tetris java blind-solve (G2) | A2 | blind worker | done | — | **grade-candidate exit 0** | Independent sonnet worker, blinded copy only (`# Solutions` + `## Final Tests` stripped). Graded **7/7 public + 4/4 hidden final**. Implementation is structurally unlike the reference (own helper decomposition, counts rows from `preDropMin` up rather than `0..maxRow` minus a baseline) — not a paraphrase. G2 closed: java was the one runtime the eval's blind set never exercised |

## Phase B — `project` / react env (G1)

| Task | Wave | Owner | Status | Test count | Gate | Notes |
|------|------|-------|--------|-----------|------|-------|
| HG-B decisions 1,2,4,5 | HG-B | human | **done** | — | — | 1 = widen shared `JSON_FENCE` (human override of the orchestrator's own-scanner recommendation) · 2 = zero-or-one function check · 4 = read-only file mode · 5 = per-run esbuild. 7,8 confirmed. Format-spec sync lands with TB.2 |
| TB.1 project types + env skeleton | B1 | — | todo | — | — | `ProjectCheck`/`FileSpec`/`LibSpec`; env registers js+ts. B1 hunks: TEST_TYPES flip + registration + **verifyExercise project guard** + parser dispatch line |
| TB.2 parser: Files/libs/checks + binding + warn | B2 | — | todo | — | — | owns **new** `project-parser.helpers.ts` (parser helpers at 431L ceiling); updates format spec; security-critical (parser) |
| TB.3 `## Files` writer | B3 | — | todo | — | — | fs containment; role incl. readonly (dec.4); security-critical |
| TB.4 per-run installer | B3 | — | todo | — | — | validateLibNames → argv install → shared cache **outside repo, vscode-free path (os.tmpdir)**; security-critical |
| TB.7 `build` check kind | B3 | — | todo | — | — | argv + contained `dir`; security-critical |
| TB.5 JSX/TSX bundle + jsdom driver | B4 | — | todo | — | — | esbuild (HG-B dec.5); **no LANG_ALIAS hunk — rows already ship** |
| TB.6 dom-assert / css-assert kinds | B5 | — | todo | — | — | css-assert declared-only (jsdom no layout); security-critical |
| TB.8 panel + harness project branch | B6 | — | todo | — | — | vscode-coupled; completes verifyProjectExercise (no function floor) + panel; F5 on committed `project-smoke.md`; security-critical |

## Phase C — React migration (depends on Phase B)

| Task | Wave | Owner | Status | Harness | Notes |
|------|------|-------|--------|---------|-------|
| E57 React Tic Tac Toe | C | — | todo | — | dom-assert: alternation/winner/reset/no-override |
| E58 React Phone Book | C | — | todo | — | dom-assert: form→sorted list, empty guard, defaults |
| E59 React Letter Tiles | C | — | todo | — | dom-assert: 26 tiles, append, 3-consecutive collapse |
| E60 React Context API | C | — | todo | — | dom-assert: context toggle, default array[0] |

## Decisions log

| When | Decision | Resolution |
|------|----------|------------|
| plan authored | Tetris solvability | SOLVABLE — standard tetromino hard-drop sim, reference green; sole barrier = image-only piece shapes → TA.2a adds text piece defs, difficulty intact |
| plan authored | React env authority | Reuse coderbyte-migration §Phase-2 + spike-findings; expand T2.1–T2.8 into six-field TB tasks — no second design authority |
| plan authored | No jira-tickets.md | Per user — tracked as bug/issue corrections, not Jira epics |
| plan review | Supersede coderbyte Phase 2+3 | eval-fixes is the single authority for the react env + migration (was double-tracked); coderbyte T2.x/E57–E60 → dropped |
| plan review | Phase B scope | BUILD ALL now (build + css-assert + role:readonly) — full project-type env, not the dom-assert-only subset E57–E60 strictly need |
| plan review | dec.3 tsx/jsx/css rows | ALREADY SHIP in constants.ts (L24/26/85) — no orchestrator hunk; open sub-question (which runnable id `project` registers) → TB.1 (resolved: js+ts) |
| plan review | verifyExercise project break | flip project→implemented makes `reserved=false` → function floor mis-grades project; B1 hunk adds the `project` guard alongside the flip |
| A1 | grade-candidate final-case output | Failing **final** cases print `hidden`, never input/expected — the CLI is the blind solver's own feedback loop (TA.2b), so open output would leak the hidden suite it grades against |
| A1 | grade-candidate runtime gate | Exit **3** (not 1) when the runtime is missing or `env.detect()` fails — a wrong answer and an absent `javac` must not look alike to a grader. `verify-exercise.mjs` does not do this; not retrofitted (out of TA.1 scope) |
| A1 | CLAUDE.md harness block | Neither CLI was documented in `CLAUDE.md` (Phase 0 landed the script, not the doc) — TA.3's G5 note needed an anchor, so both CLIs are now documented there. Doubles as §J's "promote before `git rm -r docs`" |
| A2 | TA.2b dispatch | Orchestrator read `# Solutions` while authoring TA.2a → could not be the blind solver. Human approved one independent worker dispatch; it graded solved on the first round |
| A2 | Tetris prose indexing | The blind worker flagged "columns 6–7" as unstated-base (its winning placement is 0-indexed 5–6). Prose was self-consistent under 1-indexing, not wrong — clarified to "(counting from 1)". Difficulty untouched |
| HG-B | dec.1 case→check binding | **Human chose widening the shared `JSON_FENCE`** over a project-local scanner. Consequence TB.2 must carry: taking *all* json fences changes the **function** grammar too (a second json fence under `## Tests` goes from ignored → included), so TB.2 owes a regression test pinning the shipped function-suite behaviour |
| HG-B | dec.2 / dec.4 / dec.5 | zero-or-one function check (project skips the function floor) · `role: readonly` = read-only file mode (`ponytail:` note for partial Windows chmod) · per-run esbuild installed into the shared cache, never repo deps |
| pre-resolved | Install strategy (dec.7) | shared cached node_modules keyed on libs+versions; install timeout separate from suite cap; **cache dir vscode-free (os.tmpdir), resolves in the headless CLIs too** |
| pre-resolved | `css-assert` scope (dec.8) | declared/inline style + class presence only, never layout geometry |
