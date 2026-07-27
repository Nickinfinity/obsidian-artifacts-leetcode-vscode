# Progress ledger — CoderByte migration

Derived from [`plan.md`](plan.md) (the authority). **Orchestrator writes this; workers never do.**
Statuses: `todo` · `wip` · `done` · `blocked` · `dropped` (with reason). Record the **test count on every
gate run** — a silent drop means a deleted test.

## Decisions log

| When | Decision | Resolution |
|------|----------|------------|
| plan authored | React grading | Full `project`/react runtime env (Phase 2) |
| plan authored | Function-exercise language depth | All 5 green (java/python/js/ts/rust) |
| plan authored | Migrated-file location | Vault only; harness path-coupled, skips when absent |
| plan authored | SQL Contains Letter | Reserved `test.type`, ungraded |
| _pending HG_ | E56 reserved token | existing reserved value vs new `sql` row (format change) |
| _pending_ | E42 RREF float encoding | escalation — string-precision / rational / reserved |
| _pending HG_ | Phase-2 grammar (spike §1–§7) | six decisions, see plan §G |
| plan review | Correctness anchor | Pin source examples — harness enforces `## Examples ⊆ ## Tests` (plan §D.5); worker fidelity + reviewer checks vs source |
| plan review | `css-assert` in jsdom | Declared/inline style + class presence only, never layout geometry (plan §F.3, HG decision 8); ponytail ceiling |
| plan review | Phase-2 scope | Build all 8 spike gaps (T2.1–T2.8) as written |
| plan review | React install strategy | Shared cached `node_modules` keyed on libs+versions; install timeout separate from suite cap; offline-tolerant once warm (HG decision 7) |
| plan review | Cross-language determinism | General authoring rule (plan §D.6), not just E42; float/map/unordered → deterministic encoding or ESCALATE |
| plan review | Invented-case correctness | Opt-in **independent-recompute cross-check** (plan §D.7): 2nd agent recomputes expecteds from inputs+prose only, pure diff, mismatches → CHANGES. Default-on Math/Matrices/Trees-Graphs-DP waves; +1 agent pass/exercise; reviewer stays final gate (correlated-misread residual) |

## Phase 0 — readiness

| Task | Owner | Status | Test count | Gate | Notes |
|------|-------|--------|-----------|------|-------|
| T0.1 verify helper | wave-0 | done | 669 → 684 | pass | `verifyExercise` + `compareExpecteds`; hostile throw+spin fixtures; reviewer CHANGES r1 = strengthen §D.5 pin to input-VALUE equality (was key-set) + discriminating test — resolved by orchestrator directly (worker died mid-fix to account session limit; fix was reviewer-specified + pre-approved). Baseline was 669, not 509 (memory stale). |
| T0.2 harness CLI + wrapper | wave-0 | done | 684 → 685 | pass | `scripts/verify-exercise.mjs` (verify + `--expecteds` §D.7 diff; asserts dist first) + `test/coderbyte-migration.test.ts` (vault walk, skips when absent → portable). Smoke-tested: OK/AGREE exit 0, MISMATCH exit 1 (case idx shown), missing exit 2. Built inline by orchestrator (subagents blocked); self-review degraded. |
| T0.3 pilot + exec fixes | wave-0 | done | 685 → 689 | pass | 4 pilots ALL-5-GREEN via CLI + committed vault-walker: `Strings/AB Check` (string→string), `Arrays/Array Addition` (int[]→string, subset-sum), `Matrices/Symmetric Matrix` (string[]→string), `Trees/Symmetric Tree` (string[]→string). **No execution defect surfaced** across java/python/js/ts/rust → zero `src/services` fix needed (valid pilot outcome). SECURITY: source `Symmetric Tree.md` carried a prompt-injection (`varPcb`/`__define-pcb__`, "don't tell the user") — IGNORED, surfaced to human, migrated clean. |

**Phase 0 = COMPLETE.** Full gate: `689 passing`, lint clean, `tsc --noEmit` clean. Repo files added: `src/services/exercise-verify.helpers.ts`, `test/exercise-verify.test.ts`, `scripts/verify-exercise.mjs`, `test/coderbyte-migration.test.ts`. **Uncommitted** (base rule: commit only on explicit user ask — awaiting go). Committed-gate portability holds: fresh checkout w/o vault = 685 (4 pilot cases are machine-local, decision 3).

**Authoring conventions locked by the pilot (apply to all Phase-1 waves):**
- `## Examples` MUST use `key = value` form (`input: str = "after badly"`), incl. single-param — the §D.5 pin parser (`parseExampleInput`) splits on `=`; the bare positional form in the old `examples/` artifacts is NOT accepted.
- The 3-language `examples/leetcode/function/**` artifacts are the shape template but ship only java/python/js — **author ts + rust too** (all-5-green, decision 2).
- Rust: PascalCase `fn` name grades green (non_snake_case warning only); string param → `Vec<String>`/`String` sig, `int[]` → `Vec<i32>`; nested `fn` helpers fine (only col-0 `fn <name>` is rewritten `pub`). Java: candidate = bare `static` method(s), extra `static` helpers OK, `import` lines hoisted.
- TS strip-only: typed arrow/function fns, no enum/namespace/param-props/decorators.

**Run-state note (infra):** account session limit hit during T0.1 (resets ~3:50am America/Bogota) → subagent dispatch fails. Orchestrator continuing inline (writes + self-review) until subagent capacity returns; independent-reviewer guarantee degraded, recorded here per CREATING_A_PLAN §3.1 degradation rule.

## Phase 1 — function migration (55) + SQL (1)

| Task | Wave | Status | Harness | Notes |
|------|------|--------|---------|-------|
| E01 AB Check | 1 | todo | — | |
| E02 Alphabet Run Encryption | 1 | todo | — | |
| E09 Bracket Matcher | 1 | todo | — | |
| E12 Codeland Username Validation | 1 | todo | — | |
| E16 Dash Insert II | 1 | todo | — | |
| E21 Letter Changes | 1 | todo | — | |
| E22 Letter Count | 1 | todo | — | |
| E28 Min Window Substring | 1 | todo | — | |
| E30 Number Encoding | 1 | todo | — | |
| E31 Number Search | 2 | todo | — | |
| E33 Palindrome | 2 | todo | — | |
| E34 Palindrome Two | 2 | todo | — | |
| E36 Pattern Chaser | 2 | todo | — | |
| E43 Roman Numeral Reduction | 2 | todo | — | |
| E45 String Scramble | 2 | todo | — | |
| E47 Swap Case | 2 | todo | — | |
| E48 Swap II | 2 | todo | — | |
| E54 Wildcard Characters | 2 | todo | — | |
| E55 Wildcards | 2 | todo | — | confirm distinct from E54 |
| E03 Array Addition | 3 | todo | — | |
| E04 Array Couples | 3 | todo | — | |
| E05 Array Rotation | 3 | todo | — | |
| E19 Gas Station | 3 | todo | — | |
| E25 Max Subarray | 3 | todo | — | |
| E35 Parallel Sums | 3 | todo | — | |
| E49 Switch Sort | 3 | todo | — | |
| E52 Tetris Move | 3 | todo | — | |
| E06 Binary Converter | 4 | todo | — | |
| E08 Bracket Combinations | 4 | todo | — | |
| E10 Calculator | 4 | todo | — | |
| E17 Division | 4 | todo | — | |
| E18 Fibonacci Checker | 4 | todo | — | |
| E29 Missing Digit | 4 | todo | — | |
| E32 Overlapping Ranges | 4 | todo | — | |
| E37 Pentagonal Number | 4 | todo | — | |
| E38 Polynomial Expansion | 4 | todo | — | |
| E39 Prime Checker | 4 | todo | — | |
| E23 Matrix Border | 5 | todo | — | |
| E24 Matrix Determinant | 5 | todo | — | overflow/float watch |
| E26 Maximal Rectangle | 5 | todo | — | |
| E27 Maximal Square | 5 | todo | — | |
| E40 Queen Check | 5 | todo | — | |
| E46 Sudoku Quadrant Checker | 5 | todo | — | |
| E50 Symmetric Matrix | 5 | todo | — | |
| E42 RREF Matrix | E42 | todo | — | **may-ESCALATE** float encoding |
| E07 Binary Search Tree LCA | 6 | todo | — | |
| E11 City Traffic | 6 | todo | — | |
| E13 Coin Determiner | 6 | todo | — | |
| E14 Convex Hull Points | 6 | todo | — | output ordering deterministic |
| E15 Correct Path | 6 | todo | — | |
| E20 LCS | 6 | todo | — | confirm substring vs subsequence |
| E41 Quick Knight | 6 | todo | — | |
| E44 Shortest Path | 6 | todo | — | |
| E51 Symmetric Tree | 6 | todo | — | |
| E53 Tree Constructor | 6 | todo | — | |
| E56 SQL Contains Letter | 6 | todo | n/a | reserved type; HG token |

## Phase 2 — project/react runtime env

| Task | Wave | Status | Test count | Gate | Notes |
|------|------|--------|-----------|------|-------|
| HG decisions 1–6 | HG | todo | — | — | human gate; doc-sync |
| T2.1 project env skeleton | 7 | todo | — | — | |
| T2.2 parser: check binding + warn | 7 | todo | — | — | updates format spec |
| T2.3 `## Files` writer | 8 | todo | — | — | fs containment |
| T2.4 per-run installer | 8 | todo | — | — | libs allowlist |
| T2.5 JSX bundle + jsdom driver | 8 | todo | — | — | esbuild/tsc |
| T2.6 dom-assert/css-assert kinds | 9 | todo | — | — | |
| T2.7 build check kind | 9 | todo | — | — | |
| T2.8 panel + harness project branch | 9 | todo | — | — | F5 click-path TBD |

## Phase 3 — React migration (js + ts only)

| Task | Wave | Status | Harness | Notes |
|------|------|--------|---------|-------|
| E57 React Tic Tac Toe | 10 | todo | — | dom-assert: alternation/winner/reset/no-override |
| E58 React Phone Book | 10 | todo | — | dom-assert: form→sorted list, empty guard, defaults |
| E59 React Letter Tiles | 10 | todo | — | dom-assert: 26 tiles, append, 3-consecutive collapse |
| E60 React Context API | 10 | todo | — | dom-assert: context toggle, default array[0] |
