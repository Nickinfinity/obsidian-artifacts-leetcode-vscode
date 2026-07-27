# Progress ledger — CoderByte migration

Derived from [`plan.md`](plan.md) (the authority). **Orchestrator writes this; workers never do.**
Statuses: `todo` · `wip` · `done` · `blocked` · `dropped` (with reason). Record the **test count on every
gate run** — a silent drop means a deleted test.

## ⇢ HANDOFF (fresh agent starts HERE — 2026-07-27, Phase-1 function migration COMPLETE)

**Where we are:** Phase 0 = DONE + committed (`a7f54bd`). Phase 1 function migration = **55 of 55 all-5-green** (java/python/js/ts/rust) — the last 3 deferred (E52 Tetris, E23 Matrix Border, E46 Sudoku) are now migrated (see "Deferred-three recovery" below). **E56 SQL = SKIPPED per user** (not migrated, final). Full gate **740 passing** (685 committed-portable + 55 vault), lint + tsc clean. Vault at `/Users/nick/N0t3s/L33tC0d3/CoderByte/{Strings,Arrays,Matrices,Math,Trees,Graphs,DP,Geometry,Simulation,Z-Assets}/`. **No PR** (user instruction — do NOT open one). Phase 1 (function) is DONE; remaining plan work is Phase 2 (project/react env) + Phase 3 (react migration), both behind the human-gate decisions.

### Deferred-three recovery (2026-07-27)

- **E52 Tetris Move** → `Simulation/Tetris Move.md`. Ported the validated scratchpad model (7 tetrominoes × distinct 90°CW rotations × horizontal positions; landing base per column; count completed rows − min height). All-5-green. Both source images embedded via `![[Z-Assets/tetris-piece-board.png]]` / `![[Z-Assets/tetris-example-board.png]]` (already in `Z-Assets/`). Source examples `I…→2`, `O…→0`, desc `L…→3` all pinned.
- **E23 Matrix Border** → `Matrices/Matrix Border.md`. Source had FULL prose (not image-based — prior defer was min-swap-semantics doubt). Model: rearrange rows/cols by swaps so border=all-1, interior=all-0; min swaps = enumerate row-perm × col-perm, cost `(n−cycles_row)+(n−cycles_col)`, take min. Validated vs both source examples (→2, →2). Test set = scrambles of the border target (guaranteed solvable). n≤5 keeps Python brute force fast. All-5-green.
- **E46 Sudoku Quadrant Checker** → `Matrices/Sudoku Quadrant Checker.md`. Source description literally "Content" + NO image + one example (`→ "1,3,4"`). **Reverse-engineered from the example**: flag every 3×3 quadrant (numbered `(r/3)*3+(c/3)+1`) that contains a cell breaking a Sudoku row/col/box uniqueness rule; `x`=empty. That numbering + rule reproduces the example exactly ((0,0)→q1, (0,8)→q3, (3,0)→q4). Description carries a `> Note` flagging the reconstruction. **String output → example `output:` MUST be JSON-quoted** (`output: "1,3,4"`) or the §D.5 pin's `safeJsonParse` yields null and fails. All-5-green. **Needs user confirmation the reconstructed rule matches intent** (correctness residual — harness proves runnability, not fidelity to the lost original spec).

**How to work (unchanged):** author `.md` to the vault (NOT the repo — decision 3), verify each with:
```
cd <repo>; pnpm compile   # once, if dist stale
node scripts/verify-exercise.mjs "/Users/nick/N0t3s/L33tC0d3/CoderByte/<Topic>/<Name>.md"
```
Conventions are in the "Phase-0 = COMPLETE" block below (key=value examples, all 5 langs, TS strip-only, Rust PascalCase-fn-ok, Java bare static method+helpers). The all-5-green cross-check IS the oracle for hand-authored `expected` values — if one is wrong, all 5 langs agree with each other and disagree with it → FAIL shows the true value → fix the expected.

**USER INSTRUCTIONS (resolved 2026-07-27):**
1. **E56 SQL Contains Letter → SKIP** — not migrated, final. Function total is 55/55; SQL is out of scope.
2. **The 3 deferred → migrated** (see "Deferred-three recovery" above). E52 ported from the validated scratchpad model + both images embedded; E23 recovered from source prose (never image-based); E46 reverse-engineered from its single example (source had no description and no image) — **flagged for user confirmation of the reconstructed rule**.

**Open for the user:** confirm E46's reconstructed rule matches intent (correctness residual). Everything else in Phase 1 is done.

---

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

### Completion log (authoritative — the row table below is superseded by this)

**DONE (12 exercises, all-5-green via `scripts/verify-exercise.mjs` + the committed vault-walker):**
- Pilots (T0.3): **E01** AB Check · **E03** Array Addition · **E50** Symmetric Matrix · **E51** Symmetric Tree
- **Wave 1 — Strings A COMPLETE:** E01✓ · **E02** Alphabet Run Encryption (Hard decrypt parser — hand-verified vs both source examples) · **E09** Bracket Matcher (→int) · **E12** Codeland Username Validation · **E16** Dash Insert II · **E21** Letter Changes · **E22** Letter Count · **E28** Min Window Substring · **E30** Number Encoding

- **Wave 2 — Strings B COMPLETE:** **E31** Number Search (→int, round-half-up via `floor(x+0.5)` for cross-lang determinism) · **E33** Palindrome (strip spaces) · **E34** Palindrome Two (letters-only, case-insensitive) · **E36** Pattern Chaser (Hard, longest repeated substring, overlap-allowed) · **E43** Roman Numeral Reduction (Hard, sum→greedy additive) · **E45** String Scramble (2 params, multiset subset) · **E47** Swap Case · **E48** Swap II (case-swap + swap digits flanking a letter-run) · **E54** Wildcard Characters (Hard, `+`/`*`/`{N}` matcher) · **E55** Wildcards (Hard, + `$`=digit 1-9)

- **Wave 3 — Arrays + Simulation (7/8; E52 DEFERRED):** E03✓ · **E04** Array Couples (reversed-pair check) · **E05** Array Rotation (concat string) · **E19** Gas Station (Hard, circular simulate — harness caught a bad authored expected, fixed) · **E25** Max Subarray (Kadane, →int) · **E35** Parallel Sums (Hard, equal-sum partition, lex-first subset for cross-lang determinism) · **E49** Switch Sort (Hard, BFS min-swaps, →int)
  - **E52 Tetris Move — DEFERRED (not migrated).** Needs Tetris piece-rotation geometry + board-fill mechanics that live in source images (imgur links) I can't see. Authoring blind risks a wrong-but-self-consistent artifact (harness proves runnability, not correctness). Do it with human input on piece shapes, or ESCALATE. Not counted in the green total.

- **Wave 4 — Math COMPLETE (10/10):** **E06** Binary Converter (→int) · **E08** Bracket Combinations (Catalan DP, →int) · **E10** Calculator (Hard, shunting-yard + implicit-mult, →int) · **E17** Division (GCD, 2 params, →int) · **E18** Fibonacci Checker · **E29** Missing Digit (→int) · **E32** Overlapping Ranges · **E37** Pentagonal Number (→int) · **E38** Polynomial Expansion (Hard, parse×multiply×format, §D.6-deterministic int coeffs) · **E39** Prime Checker (digit-perm prime, →int)

- **Wave 5 — Matrices (5/7; E23 + E46 DEFERRED):** E50✓ · **E24** Matrix Determinant (Hard, cofactor, i64 internal→i32, §D.6 overflow-safe for test set) · **E26** Maximal Rectangle (Hard, histogram-stack) · **E27** Maximal Square (Hard, DP) · **E40** Queen Check (Hard, chess check + escape-count)
  - **E23 Matrix Border — DEFERRED.** "Number of swaps" = min row/col swaps to make border all-1/inside all-0; min-transposition semantics + validity search is subtle to get provably right; author with care later or ESCALATE.
  - **E46 Sudoku Quadrant Checker — DEFERRED.** Source has NO description (literally "Content") and one cryptic example (`→ "1,3,4"`); semantics unrecoverable from source. Needs human clarification or drop.

- **Wave 6 — Trees/Graphs/DP/Geometry (9/9 function; E56 SQL = human gate):** E51✓ · **E07** BST LCA (→int) · **E11** City Traffic (Hard, tree subtree-sums, big prose example matched) · **E13** Coin Determiner (DP, →int) · **E14** Convex Hull Points (Hard, monotone-chain vertex count, →int) · **E15** Correct Path (grid backtracking) · **E20** LCS (DP, →int) · **E41** Quick Knight (Hard, BFS, →int) · **E44** Shortest Path (Hard, BFS path) · **E53** Tree Constructor (valid-binary-tree)
- **E42 RREF Matrix — DONE, NOT escalated.** Source guarantees the RREF has no fractional numbers → output is integer concatenation → deterministic across all 5 langs. Rational (i64 num/den) arithmetic internally, integer emit. §D.6 float-escalation avoided by the problem constraint. `ponytail:` i64 rational intermediates; bignum only if a 6×6 ever overflows (input range doesn't).

- **Deferred-three (now COMPLETE):** **E52** Tetris Move (`Simulation/`, ported validated model, images embedded) · **E23** Matrix Border (`Matrices/`, min row/col swaps via perm-cycle cost, recovered from source prose) · **E46** Sudoku Quadrant Checker (`Matrices/`, reverse-engineered rule — quadrants containing any row/col/box violation; user-confirm pending)

Running total: **55 of 55 function exercises green** (E01–E55). E56 SQL = SKIPPED per user (out of scope). Full gate: **740 passing** (685 committed-portable + 55 vault), lint + tsc clean. Every exercise: ≥2 examples pinned into `## Tests` (§D.5), ≥6 public + ≥3 final, java/python/js/ts/rust all green.

### Remaining Phase-1 items (human input needed)

| id | Item | Status | Needs |
|----|------|--------|-------|
| E56 | SQL Contains Letter | **SKIPPED (user)** | Out of scope — not migrated, final. |
| E52 | Tetris Move | **DONE (all-5-green)** | — ported validated model to `Simulation/Tetris Move.md`; both source images embedded. |
| E23 | Matrix Border | **DONE (all-5-green)** | — recovered from source prose (not image-based). `Matrices/Matrix Border.md`. |
| E46 | Sudoku Quadrant Checker | **DONE (all-5-green)** | — reverse-engineered from the single example; `Matrices/Sudoku Quadrant Checker.md`. **User: confirm the reconstructed rule matches intent.** |

**Decisions-log additions:** E42 → integer-guarantee makes it non-fractional, resolved with rational-internal/integer-emit (no ESCALATE). E52/E23/E46 deferred as un(der)specified-from-source. E56 open at human gate.

**DONE: 22 exercises.** **REMAINING Phase 1:** Wave 3 (Arrays+Sim, E03✓ so 7: E04 E05 E19 E25 E35 E49 E52) · Wave 4 (Math, 10: E06 E08 E10 E17 E18 E29 E32 E37 E38 E39) · Wave 5 (Matrices, E50✓ so 6: E23 E24 E26 E27 E40 E46) · Wave 6 (Trees/Graphs/DP/Geo, E51✓ so 9: E07 E11 E13 E14 E15 E20 E41 E44 E53 + E56 SQL human-gate) · E42 RREF (alone, may-ESCALATE). = 32 function remaining + E56 SQL.

**Resume:** author to vault `/Users/nick/N0t3s/L33tC0d3/CoderByte/<Topic>/<Name>.md`, verify each with `node scripts/verify-exercise.mjs "<md>"` (needs `pnpm compile`). Conventions in the Phase-0 block above.



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

> **DROPPED → tracked in [`eval-fixes`](../eval-fixes/plan.md)** (that plan's §A supersedes Phase 2 + Phase 3).
> Every row below re-expands there as `HG-B` / `TB.1–TB.8`; dispatch from `eval-fixes/progress.md`, never here.

| Task | Wave | Status | Test count | Gate | Notes |
|------|------|--------|-----------|------|-------|
| HG decisions 1–6 | HG | dropped | — | — | human gate; doc-sync — superseded by eval-fixes HG-B |
| T2.1 project env skeleton | 7 | dropped | — | — | |
| T2.2 parser: check binding + warn | 7 | dropped | — | — | updates format spec |
| T2.3 `## Files` writer | 8 | dropped | — | — | fs containment |
| T2.4 per-run installer | 8 | dropped | — | — | libs allowlist |
| T2.5 JSX bundle + jsdom driver | 8 | dropped | — | — | esbuild/tsc |
| T2.6 dom-assert/css-assert kinds | 9 | dropped | — | — | |
| T2.7 build check kind | 9 | dropped | — | — | |
| T2.8 panel + harness project branch | 9 | dropped | — | — | F5 click-path TBD |

## Phase 3 — React migration (js + ts only)

> **DROPPED → tracked in [`eval-fixes`](../eval-fixes/plan.md) §F** (same four exercises, one authority).

| Task | Wave | Status | Harness | Notes |
|------|------|--------|---------|-------|
| E57 React Tic Tac Toe | 10 | dropped | — | dom-assert: alternation/winner/reset/no-override |
| E58 React Phone Book | 10 | dropped | — | dom-assert: form→sorted list, empty guard, defaults |
| E59 React Letter Tiles | 10 | dropped | — | dom-assert: 26 tiles, append, 3-consecutive collapse |
| E60 React Context API | 10 | dropped | — | dom-assert: context toggle, default array[0] |
