# Plan — CoderByte → LeetCode-artifact migration + React runtime env

**Feature slug:** `coderbyte-migration`
**Branch:** `feature/VSX-122_multilib-multilang-support`
**Authority:** This file is the single entry point and the authority its companions derive from:

- `progress.md` — the ledger (one row per task; **orchestrator writes it, never a worker**).
- `jira-tickets.md` — epic/story specs, ready to create when the Atlassian connector is authorized.

Read this file once, in full, alongside [`CREATING_A_PLAN.md`](../../../CREATING_A_PLAN.md) (the process; §2 holds the
orchestrator/reviewer/worker templates — **this plan never re-copies them**, it only appends the instance
parameters in §I below). Everything an orchestrator needs to start is here + that one read.

---

## A. Goal, in one paragraph

Migrate the 60 CoderByte exercises in `/Users/nick/N0t3s/5tudy-N0t3s/Interviews/LeetCode/CoderByte - Leet`
into the extension's `type: leetcode` on-disk format
([`ARTIFACT_LEETCODE_FILE_FORMAT.md`](../../../ARTIFACT_LEETCODE_FILE_FORMAT.md)), writing the results to the
vault at `/Users/nick/N0t3s/L33tC0d3/CoderByte`. Every migrated exercise must **run** through the real
extension runner — the point is not a re-typed note, it is a runnable challenge. The migration preserves each
original exercise's essence and objective while re-shaping its I/O into something the runner can grade
deterministically.

## B. The four decisions (answered by the human, frozen here)

| # | Decision | Answer | Consequence for this plan |
|---|---|---|---|
| 1 | React exercises (JSX + CSS) grading | **Full `project`/react runtime env** | Phase 2 implements the reserved `project` type end to end: per-run npm install of react + react-dom + jsdom + a JSX/TSX bundler, render + DOM/CSS assertions. This is the large, security-critical phase. |
| 2 | Runnability depth per **function** exercise | **All 5 green** | Each function exercise ships setup + a reference solution in **java, python, javascript, typescript, rust**, and the harness runs all five to green. All five toolchains are installed on the target machine (verified: Java 25, Python 3.13, Node 26, Rust 1.81). |
| 3 | Where migrated files live | **Vault only + path-coupled harness** | Migrated `.md` files go **only** to `/Users/nick/N0t3s/L33tC0d3/CoderByte` — they are **not** committed to the repo. The repo diff for a migration wave is empty except for extension fixes. The verification harness reads the vault path and **skips cleanly when the path is absent** so the committed gate stays portable. |
| 4 | `SQL Contains Letter` (no runnable env) | **Migrate as reserved/ungraded** | Re-shaped into the new format with a reserved `test.type` (no registered env). Parses, lists in the picker, panel explains "no environment". Graded by nothing; SQL essence preserved. |

## C. Scope split — what runs when

The work splits into two **independently shippable** slices. Phase 1 delivers the high-value, low-risk bulk;
Phases 2–3 are the larger react subsystem and **may land as a follow-up PR after Phases 0–1 merge** (the
sequencing in §H allows it; nothing in Phase 1 depends on Phase 2).

- **Phase 0** — extension readiness + the verification harness. *Enabling; must land first.*
- **Phase 1** — migrate the 55 function exercises + the 1 SQL exercise (reserved). *The bulk. Shippable alone.*
- **Phase 2** — implement the `project`/react runtime env (closes the spike gaps). *Large, security-critical.*
- **Phase 3** — migrate the 4 React exercises onto the Phase-2 env. *Depends on Phase 2.*

---

## D. The uniform verification harness (Phase 0 deliverable — the "same test for every exercise")

The human's TDD instruction: *the per-exercise test does not test the exercise's algorithm; it tests that the
migrated `.md` conforms to the format **and that its suite actually runs** — a reference solution is included
solely to prove runnability.* One harness, parametrized over a file. It is the TDD instrument every migration
task's **Done when** points at.

**Home:** `scripts/verify-exercise.mjs` (a plain Node ESM script; imports the compiled, `vscode`-free parser +
runner from `dist/`). Invoked `node scripts/verify-exercise.mjs "<path-to-md>"`. It **asserts `dist/` exists
first** and exits non-zero with a readable *"run `pnpm compile` first"* message if not — it never silently
imports a stale or missing build (the standalone CLI has no `rm -rf dist && pnpm compile` in front of it the way
the gate does). A thin mocha wrapper
`test/coderbyte-migration.test.ts` walks the vault `CoderByte/` tree and runs the harness on each file **only
when the vault dir exists** (`fs.existsSync`); absent → the suite reports 0 and the committed gate is unaffected
(decision 3). The harness logic itself is a pure function (`verifyExercise(md, path)` in
`src/services/exercise-verify.helpers.ts`) so it is unit-tested `vscode`-free against inline fixtures.

**What `verifyExercise` asserts, identically for every exercise:**

1. **Parses** — `parseLeetCode(md)` yields `type: leetcode`, non-empty `title`, and (for a runnable exercise)
   non-empty `functionName`.
2. **Structural shape** — **≥ 2** `## Examples` blocks; `## Tests` (public) has **≥ 6** cases;
   `## Final Tests` (hidden) has **≥ 3** cases; `params`/`returns` present; every `## Tests`/`## Final Tests`
   input's keys match `params` names. (Floor is `≥ 2`, not `exactly 2` — a source with three good examples
   keeps all three; the panel renders however many are present.)
3. **Runnable, all declared languages green** — for each language that has a `# Setup` **and** a `# Solutions`
   entry, resolve the env (`testEnvFor(parsed.test.type, lang)`), run the **reference solution** through
   `runSuite` against public **+** final, and assert **every case passes**. For a function exercise all five of
   java/python/javascript/typescript/rust must be present and green (decision 2).
4. **Reserved-type exercises** (SQL) — assert `languagesForType(type) === []` and that the exercise parses;
   **skip** the run step. Their `## Tests` count floor is relaxed to ≥ 1 (no grader consumes them).
5. **Ground-truth pin (the only correctness anchor) — `## Examples ⊆ ## Tests`.** The harness only proves the
   suite *runs*; it does **not** prove the migration is *correct* — the worker authors the solutions, the cases,
   **and** their `expected` values, so a misread problem produces an internally-consistent artifact that goes
   green. `verifyExercise(md, path)` sees **only the migrated file**, never the source, so it cannot diff against
   CoderByte directly. What it *can* enforce purely: **every `## Examples` input/output pair also appears as a
   public `## Tests` case** (same input keys → same `expected`). This makes the examples a *pinned* subset of the
   graded suite — a reference solution that passes the suite has necessarily reproduced the example outputs.
   The **worker's** duty (and the **reviewer's** manual check against the source, since the harness can't) is
   that `## Examples` faithfully carry the source's published I/O — decision 3 keeps the source path readable, so
   the reviewer has it. Chain: source examples → `## Examples` (worker fidelity, reviewer-checked) → `## Tests`
   (harness-enforced `⊆`) → all five solutions green. Worker-invented cases fill the rest to the ≥ 6 / ≥ 3
   floors; the example-derived ones are the cases a wrong solution cannot quietly agree with itself on.
6. **Cross-language determinism (authoring rule, not a per-exercise flag).** One `expected` value must match all
   five languages' serialised output. Floats (Rust `LeetJson` f64 text vs JS/Java), maps/objects, and unordered
   collections (`HashMap` iteration order) do **not** serialise identically across the five envs — so an exercise
   whose natural output is one of these goes red in at least one language and the harness catches it. The worker
   re-encodes to a deterministic form (integer, rational, fixed-precision string, or sorted keys) or ESCALATEs.
   **E42 is the first instance of this rule, not the only one** — §F.1 pre-flags the known offenders (E10, E14,
   E17, E24, E38, E42), but the worker applies the rule to every exercise, not just the flagged rows.

**Security note:** the harness executes reference-solution code and (Phase 2) react check code through the real
runner. It is a subprocess + filesystem surface; it inherits the runner's containment (temp dir `cwd`, argv
arrays, no command-string interpolation). It never joins a raw exercise title into a path — the file path comes
from `readdir` of the validated vault root.

### D.7 Correctness residual + the optional independent-recompute cross-check

The pin (§D.5) anchors only the example-derived cases; the ~6–7 **worker-invented** cases per exercise carry
`expected` values the same worker computed alongside the solutions, so the harness confirms self-consistency,
not correctness. Past the pin, **the reviewer is the only correctness gate** — at Phase-1 scale (55 exercises ×
~7 invented cases ≈ 385 hand-authored expecteds, one reviewer per wave) that is a real miss-rate risk. This is a
scale risk, not a plan defect: with one authoring agent and no pre-existing answer key, no cheaper automated
oracle than the pin exists.

**Independent-recompute cross-check (opt-in per wave; the orchestrator's escalation when a wave's exercises are
ambiguous or thin-example).** A **second agent** — the *recompute worker* — is dispatched per exercise and reads
**only**: the source `.md`, the migrated problem statement, and the `## Tests`/`## Final Tests` **inputs**. It
**never sees** the reference solutions or the stored `expected` values (that isolation is what makes the check
*independent* — seeing either collapses it into copying). It computes each input's expected output from the prose
alone and emits an `{ input → expected }` map. A **pure diff** (a tiny `vscode`-free helper, or the harness in a
`--expecteds <json>` compare mode — pick at T0.1 time) compares its map to the artifact's:

- **All match** → strong two-independent-derivations signal; the reviewer only sanity-reads.
- **Any mismatch** → surfaced to the reviewer as a **focused diff**: either the migration worker misread or the
  recompute worker did. The reviewer adjudicates *only the disagreeing cases*, not all 9 — turning "read 9 whole
  exercises" into "read the handful of expecteds two agents disagreed on".

Cost: **+1 agent pass per exercise** in the waves where it runs. Wire it into the §J wave loop as a pre-review
step: migration worker → harness green → recompute worker → diff → (mismatches become `CHANGES` to the migration
worker, same 2-round cap) → reviewer.

`ponytail:` two LLM agents can share the *same* misread on genuinely ambiguous prose (correlated error), so this
**reduces** the miss rate, it does not zero it — the reviewer stays the final gate. Enable it by default for the
Math / Matrices / Trees-Graphs-DP waves (logic-dense, easy to misread); the Strings waves with concrete
examples that span the logic can rely on the pin alone. The orchestrator records per-wave whether it ran.

---

## E. Target file shape (per migrated exercise)

Produced by re-shaping the source, **not** copying it. The source `## Code start:` (a `class Main` + `Scanner`
stdin harness) is a *hint to the original signature only* — it is **discarded**, because the runner forbids a
candidate that reads stdin (`buildExecutable` normalises to a bare declaration). The setup written is a bare
function stub per the format's `# Setup` rules.

```
CoderByte/<Topic>/<Name>.md
```

Topic folders (the picker browses this tree): `Strings`, `Arrays`, `Matrices`, `Math`, `Trees`, `Graphs`,
`DP`, `Geometry`, `Simulation`, `Misc`, and `React` (Phase 3). The worker assigns the best-fit topic; when two
fit, pick the more specific. Frontmatter, description (Markdown), `## Examples` (**≥ 2**), `## Tests`
(**≥ 6**, public), `## Final Tests` (**≥ 3**, hidden), `# Setup` (bare stub per language), `# Solutions` (the
reference solution per language, each proven green). `status: unsolved`; the extension owns `status` thereafter.

`## Examples` use the ` ```example ` fence info-string with `input:`/`output:` lines (`extractExamples` parses
only `example`-tagged fences — a plain ` ``` ` block is not an example). The two `## Tests`/`## Final Tests`
suites use ` ```json ` arrays of `{ "input": {…}, "expected": … }`.

**Essence-preservation rule:** keep the original problem statement and objective. Only the *I/O encoding* may be
normalised so the runner can grade it — e.g. CoderByte's "return the string `true`/`false`" stays a returned
string, a tree given as a preorder string array stays `string[]` input. Do **not** re-scope the problem.

**Ground-truth pin (§D.5):** the source's published example I/O pairs are re-encoded here, but their input →
output mapping is **carried through unchanged** and must reappear as pinned `## Tests` cases. Re-encoding is
allowed to change the *shape* (stdin string → a `params` object, `"true"` → the exact returned string); it must
**not** change which output a given input produces. That mapping is the one piece of ground truth in the file.

**Deterministic output (§D.6):** when re-encoding a float, map/object, or unordered result, choose an encoding
that serialises identically across all five envs (integer, rational, fixed-precision string, or sorted keys) —
Rust `LeetJson` and JS/Java do not agree on raw float text or `HashMap` order. If no such encoding preserves the
essence, ESCALATE (as E42 does).

---

## F. Exercise inventory (the Phase-1 + Phase-3 task rows)

Function name is the CoderByte convention (PascalCase of the title, named in the problem's first sentence) —
**the worker confirms it against the source prose** and uses `functions:` overrides only if a language needs a
different name. `params`/`returns`/tests are derived by the worker from the prose (the source is untrusted
input; parse defensively). Topic is a suggestion.

**Per-language authoring constraints (apply to every F.1 row):**

- **TypeScript is strip-only** (spike §6 · `typescriptFunctionEnv`): the TS reference solution must contain
  **no** non-erasable syntax — no `enum`, `namespace`, parameter properties, or decorators. Those throw straight
  out of `stripTypeScriptTypes` and the case reports an error, not a pass. Plain typed functions only.
- **Rust function name**: `functionNameFor` calls the fn by the artifact's `function` value, so a PascalCase
  name like `ABCheck` reaches Rust as `fn ABCheck` — which **compiles with a `non_snake_case` warning**, not an
  error (no `#![deny(warnings)]` in the harness), so it still grades green. Prefer a `functions.rust`
  snake_case override (`ab_check`) to keep the output clean, but it is not required for green.
- **Determinism (§D.6)** applies per row even where the Notes column is silent.

### F.1 Function exercises — Phase 1, "all 5 green" (55)

| id | Source `.md` | Topic | function | Notes / ceiling |
|----|--------------|-------|----------|-----------------|
| E01 | AB Check | Strings | `ABCheck` | returns string `"true"`/`"false"` |
| E02 | Alphabet Run Encryption | Strings | `AlphabetRunEncryption` | |
| E03 | Array Addition | Arrays | `ArrayAddition` | `int[]` → string `"true"`/`"false"`; negatives |
| E04 | Array Couples | Arrays | `ArrayCouples` | |
| E05 | Array Rotation | Arrays | `ArrayRotation` | |
| E06 | Binary Converter | Math | `BinaryConverter` | string ↔ int |
| E07 | Binary Search Tree LCA | Trees | `BinarySearchTreeLCA` | `string[]` (preorder + 2 vals) → int |
| E08 | Bracket Combinations | Math | `BracketCombinations` | Catalan; `int` → `int` |
| E09 | Bracket Matcher | Strings | `BracketMatcher` | |
| E10 | Calculator | Math | `Calculator` | expression string → number |
| E11 | City Traffic | Graphs | `CityTraffic` | verify input encoding (`int[][]`) |
| E12 | Codeland Username Validation | Strings | `CodelandUsernameValidation` | → string `"true"`/`"false"` |
| E13 | Coin Determiner | DP | `CoinDeterminer` | |
| E14 | Convex Hull Points | Geometry | `ConvexHullPoints` | `int[][]`; **output ordering must be deterministic** |
| E15 | Correct Path | Graphs | `CorrectPath` | |
| E16 | Dash Insert II | Strings | `DashInsertII` | |
| E17 | Division | Math | `Division` | GCD; verify return type |
| E18 | Fibonacci Checker | Math | `FibonacciChecker` | |
| E19 | Gas Station | Arrays | `GasStation` | greedy; → string |
| E20 | LCS | DP | `LCS` | longest common substring/subsequence — confirm which |
| E21 | Letter Changes | Strings | `LetterChanges` | |
| E22 | Letter Count | Strings | `LetterCount` | |
| E23 | Matrix Border | Matrices | `MatrixBorder` | `int[][]` |
| E24 | Matrix Determinant | Matrices | `MatrixDeterminant` | `int[][]` → int; **watch integer overflow / float** |
| E25 | Max Subarray | Arrays | `MaxSubarray` | Kadane |
| E26 | Maximal Rectangle | Matrices | `MaximalRectangle` | `int[][]` → int |
| E27 | Maximal Square | Matrices | `MaximalSquare` | `int[][]` → int |
| E28 | Min Window Substring | Strings | `MinWindowSubstring` | |
| E29 | Missing Digit | Math | `MissingDigit` | |
| E30 | Number Encoding | Strings | `NumberEncoding` | |
| E31 | Number Search | Strings | `NumberSearch` | |
| E32 | Overlapping Ranges | Math | `OverlappingRanges` | → string `"true"`/`"false"` |
| E33 | Palindrome | Strings | `Palindrome` | → string |
| E34 | Palindrome Two | Strings | `PalindromeTwo` | |
| E35 | Parallel Sums | Arrays | `ParallelSums` | |
| E36 | Pattern Chaser | Strings | `PatternChaser` | |
| E37 | Pentagonal Number | Math | `PentagonalNumber` | `int` → `int` |
| E38 | Polynomial Expansion | Math | `PolynomialExpansion` | string algebra — deterministic formatting |
| E39 | Prime Checker | Math | `PrimeChecker` | |
| E40 | Queen Check | Matrices | `QueenCheck` | |
| E41 | Quick Knight | Graphs | `QuickKnight` | BFS |
| E42 | RREF Matrix | Matrices | `RREFMatrix` | **CEILING: floating-point 2D output** — cross-language float formatting is not deterministic (Rust `LeetJson` f64 vs JS/Java). Worker must pick an integer/rational or fixed-precision-string encoding, or **ESCALATE** if none preserves essence. |
| E43 | Roman Numeral Reduction | Strings | `RomanNumeralReduction` | |
| E44 | Shortest Path | Graphs | `ShortestPath` | `string[]` |
| E45 | String Scramble | Strings | `StringScramble` | → string `"true"`/`"false"` |
| E46 | Sudoku Quadrant Checker | Matrices | `SudokuQuadrantChecker` | `int[][]` |
| E47 | Swap Case | Strings | `SwapCase` | |
| E48 | Swap II | Strings | `SwapII` | |
| E49 | Switch Sort | Arrays | `SwitchSort` | |
| E50 | Symmetric Matrix | Matrices | `SymmetricMatrix` | `int[][]` → string/bool |
| E51 | Symmetric Tree | Trees | `SymmetricTree` | `string[]` → string/bool |
| E52 | Tetris Move | Simulation | `TetrisMove` | |
| E53 | Tree Constructor | Trees | `TreeConstructor` | `string[]` → string `"true"`/`"false"` |
| E54 | Wildcard Characters | Strings | `WildcardCharacters` | |
| E55 | Wildcards | Strings | `Wildcards` | confirm distinct from E54 |

### F.2 Reserved exercise — Phase 1 (1)

| id | Source `.md` | Topic | Handling |
|----|--------------|-------|----------|
| E56 | SQL Contains Letter | Misc | Reserved `test.type` (no env). Worker sets a reserved type value so `languagesForType()` is `[]`; keeps the query prose + the example table; `## Tests` may hold the expected result rows for documentation. Panel explains "no environment". **Orchestrator picks the reserved token** (existing reserved value, e.g. `stdin-stdout`, vs a new `sql` reserved row in `TEST_TYPES`) — a **human-gate decision** because a new reserved token is a format change and touches `ARTIFACT_LEETCODE_FILE_FORMAT.md`. |

### F.3 React exercises — Phase 3 (4)

Graded through the Phase-2 `project`/react env. Each is DOM-behavioural; the graded checks are `dom-assert`
(render, fire events, assert DOM) and, where the exercise dictates, `css-assert`. Languages: **javascript +
typescript only** (decision: libs-backed exercises run only in the corresponding languages).

**`css-assert` ceiling — jsdom has no layout engine.** jsdom does not compute layout: `getComputedStyle` returns
**declared/inline** style properties (a set `style.color`, a `className` that maps to a declared rule), never
resolved geometry (width/height from the box model, flex/grid positions, visibility that depends on layout).
`css-assert` is therefore scoped to **declared-style assertions only** — presence of a class, a declared CSS
property value, an inline style — and **never** rendered geometry. Encode each React exercise's essence in
`dom-assert` (structure + behaviour) wherever possible; reach for `css-assert` only for a declared property, and
carry a `ponytail:` comment naming the jsdom-no-layout ceiling and "swap jsdom for a layout-capable headless
browser if geometry grading is ever required". A DOM/behavioural encoding of the four exercises' essence (§F.3
grades below) does not need layout, so this ceiling does not block Phase 3.

| id | Source `.md` | Grades (essence) |
|----|--------------|------------------|
| E57 | React Tic Tac Toe | click square → X/O alternation; winner detection (row/col/diag); reset; no-override of a filled square. |
| E58 | React Phone Book | form (first/last/phone) → submit appends to a list sorted by last name; empty-field guard; prepopulated defaults. |
| E59 | React Letter Tiles | 26 uppercase tiles; click appends to `#outputString`; 3 consecutive identical letters collapse to `_`. |
| E60 | React Context API | toggle button cycles favourite language via `React.createContext` + `Context.Provider`; default = array[0]. |

---

## G. Phases and tasks

Gate command (every wave; from `CREATING_A_PLAN.md` §6):

```bash
rm -rf dist && pnpm compile && pnpm lint && \
  node node_modules/.pnpm/mocha@*/node_modules/mocha/bin/mocha.js --ui tdd "dist/test/**/*.test.js"
# then, always:
npx tsc --noEmit
```

### Phase 0 — readiness (must land before Phase 1)

Delivers the harness and de-risks Phase 1 by driving a type-diverse pilot end to end and fixing whatever
execution defects surface (the human's "fix correct execution"). No specific bug is asserted up front — Phase 0
**discovers** them via the pilot and fixes each with a failing test first.

Wave 0 (workers parallel; orchestrator lands the mocha-wrapper wire-up + any shared-table row):

#### T0.1 — Pure verification helper
- **Owns:** `src/services/exercise-verify.helpers.ts`, `test/exercise-verify.test.ts`
- **Reads:** `src/services/leetcode-parser.service.ts`, `src/services/leetcode-runner.service.ts`, `src/services/test-envs/env.registry.ts`, `ARTIFACT_LEETCODE_FILE_FORMAT.md`
- **Depends on:** none
- **Test first:** `test/exercise-verify.test.ts` — a valid inline fixture (≥2 examples all mirrored in the public suite, ≥6 public, ≥3 final, one green reference solution in one language) returns `{ ok: true }`; fixtures that each break **one** rule return `ok: false` with the reason: 1 example; a failing reference solution; an `## Examples` pair **absent** from `## Tests` (the §D.5 `⊆` check); a `## Tests` input whose keys don't match `params`. First failing assertion: `verifyExercise(goodMd).ok === true`.
- **Done when:** the pure structural + run checks in §D (1–6) pass/fail per fixture, including the `## Examples ⊆ ## Tests` pin (§D.5); `vscode`-free. **Also exposes the §D.7 expecteds-diff** — a pure `compareExpecteds(artifactCases, recomputed)` that returns the mismatching `{ index, input, artifact, recomputed }` rows (empty = agree), unit-tested against an agree fixture and a one-mismatch fixture. (Surfaced as `--expecteds <json>` on the CLI in T0.2.)
- **Gate:** the gate above. **Security-critical** (runs solution code via `runSuite`): Test-first includes a hostile fixture — a reference solution that `throw`s / spins — and asserts the harness reports failure without hanging (per-suite timeout). Gate names the **reviewer's manual security trace**.

#### T0.2 — Harness CLI + skip-clean mocha wrapper
- **Owns:** `scripts/verify-exercise.mjs`, `test/coderbyte-migration.test.ts`
- **Reads:** `src/services/exercise-verify.helpers.ts` (T0.1), `dist/` layout
- **Depends on:** T0.1
- **Test first:** `test/coderbyte-migration.test.ts` asserts that when `VAULT_CODERBYTE` (or the default vault path) does not exist, the walk yields **0** cases and the suite is green (portability of the committed gate). First failing assertion: absent-path → empty case list, no throw.
- **Done when:** `node scripts/verify-exercise.mjs <file>` exits 0 on a green exercise, non-zero with a readable reason otherwise; the wrapper skips cleanly when the vault is absent. `--expecteds <json>` (§D.7) prints the recompute mismatches from `compareExpecteds` and exits non-zero if any, 0 if the maps agree.
- **Gate:** the gate above. **Security-critical** (filesystem walk of an external path): Test-first includes a path outside the vault root and asserts it is not walked. Gate names the reviewer's manual trace.

#### T0.3 — Pilot migration (type-diverse), fix execution defects
- **Owns:** vault files `CoderByte/Strings/AB Check.md`, `CoderByte/Arrays/Array Addition.md`, `CoderByte/Matrices/Symmetric Matrix.md`, `CoderByte/Trees/Symmetric Tree.md`; **plus** any `src/services/**` fix a defect requires, each with its own failing test in `test/`.
- **Reads:** the four source `.md` files, `ARTIFACT_LEETCODE_FILE_FORMAT.md`, the harness.
- **Depends on:** T0.1, T0.2
- **Test first:** for each execution defect found, a failing `test/*.test.ts` reproducing it (`vscode`-free) before the fix. If **no** defect surfaces, the pilot's proof is the harness green on all four.
- **Done when:** `node scripts/verify-exercise.mjs` is green for all four pilot exercises (all 5 languages), and every fix has a regression test.
- **Gate:** the gate above **and** the four harness runs green. **Security-critical** (authoring `.md` = untrusted input shape; touches the runner): reviewer manual trace named.

> **Orchestrator note:** T0.3 is the one Phase-0 task that may edit shared `src/services/**` files. Its fixes
> to shared tables/registries are **orchestrator integration hunks**, not worker edits (per template). If the
> pilot needs a `LANGUAGES`/`constants`/registry row, the orchestrator lands it.

### Phase 1 — migrate the 55 function exercises + SQL (waves of ~9)

Every Phase-1 migration task has the **same shape** (template below); the plan does not repeat it 56 times. The
orchestrator expands *template + inventory row* per dispatch. Each task owns exactly one vault `.md` file →
tasks are inherently disjoint (no shared repo file after Phase 0). Batched into waves by topic only for review
manageability.

**Migration-task template** (parametrised by an F.1/F.2 row `<id, source, topic, fn, notes>`):

- **Owns:** `CoderByte/<Topic>/<SourceName>.md` (in the vault; **not** a repo path)
- **Reads:** the source `.md`, `ARTIFACT_LEETCODE_FILE_FORMAT.md`, `scripts/verify-exercise.mjs`, the five `# Setup` conventions in the format spec.
- **Depends on:** Phase 0 complete (all of T0.1–T0.3). **No same-wave dependency.**
- **Test first:** the harness *is* the test. Before writing solutions, write the target skeleton (frontmatter + ≥2 examples + ≥6 public + ≥3 final, **with the source example I/O pairs pinned as public cases** per §D.5) and run the harness → it must fail on "no green reference solution", proving the suite is wired before any solution exists.
- **Done when:** `node scripts/verify-exercise.mjs "CoderByte/<Topic>/<SourceName>.md"` is green — parses, structural floors met (≥2 / ≥6 / ≥3), the source example I/O pairs are present as pinned cases (§D.5), output encoding is cross-language deterministic (§D.6), and **all five** reference solutions pass public + final. TS solution is strip-only (§F.1). (E56/SQL: reserved-type branch of §D.)
- **Gate:** the harness green for this file. The repo gate is unaffected (no repo file changed); the orchestrator still runs the full gate at wave close to catch accidental repo edits. **Security-critical** (source `.md` + authored test JSON = untrusted): the reference solutions must not read stdin; test JSON is well-formed; reviewer confirms no stdin-reading candidate and no path built from a title.

Waves (topic batches; each task = one F.1 row):

- **Wave 1 — Strings A:** E01 E02 E09 E12 E16 E21 E22 E28 E30
- **Wave 2 — Strings B:** E31 E33 E34 E36 E43 E45 E47 E48 E54 E55
- **Wave 3 — Arrays + Simulation:** E03 E04 E05 E19 E25 E35 E49 E52
- **Wave 4 — Math:** E06 E08 E10 E17 E18 E29 E32 E37 E38 E39
- **Wave 5 — Matrices:** E23 E24 E26 E27 E40 E46 E50 (E42 RREF handled separately — see below)
- **Wave 6 — Trees + Graphs + DP + Geometry + SQL:** E07 E11 E13 E14 E15 E20 E41 E44 E51 E53 E56

**E42 (RREF Matrix)** is dispatched **alone** and flagged **may-ESCALATE**: if no cross-language-deterministic
encoding of a floating-point RREF exists (Rust `LeetJson` f64 formatting vs JS/Java), the orchestrator decides
between a fixed-precision-string encoding, an integer/rational encoding, or dropping it to reserved — recorded
in the decisions table. This is the one function exercise where "all 5 green" may not be achievable as-is.

### Phase 2 — `project`/react runtime env (security-critical; large)

Closes the [`spike-findings.md`](../rust-multilang/spike-findings.md) gaps. **Several are format-grammar
decisions that must be made before workers dispatch** — the orchestrator resolves them at a human gate and
updates `ARTIFACT_LEETCODE_FILE_FORMAT.md` in the same change (doc-sync rule).

**Human-gate design decisions (orchestrator + human, before Phase-2 worker dispatch):**

1. **Case→check binding** (spike §1): widen `JSON_FENCE` to accept ` ```json check=<name> ` **or** move cases into `checks[].cases`. Decide grammar first — it changes the section reader.
2. **Per-check `params`/`returns`** (spike §2): `checks[].params`/`checks[].returns` nesting vs one-function-per-artifact rule.
3. **`.tsx`/`.jsx`/`.css` recognition** (spike §6): add `tsx`/`jsx` aliases + `css` handling to the cosmetic `LANG_ALIAS`/`LANG_EXT` tables (`constants.ts`) — **orchestrator integration hunk** (shared table). CSS is not a `LangId`; it is a file role in `## Files`, never a runnable language.
4. **`role: readonly` mechanism** (spike §7): read-only file mode vs render-in-panel.
5. **Bundler choice for JSX/TSX**: `stripTypeScriptTypes` cannot handle JSX (spike §6) — the env needs a real transform. Per-run `esbuild` (installed with the libs) is the ponytail default; `tsc` is the alternative. Decide before the render-driver task.
6. **Trust boundary**: a `project` react env installs and executes npm packages declared in the artifact `libs:` — **arbitrary code by design** (the format spec §9.3 states this trust class). Every `libs:` entry passes the existing `validateLibNames` allowlist ([`lib-spec.helpers.ts`](../../../src/services/lib-spec.helpers.ts)) before any install subprocess. Install/start are **argv arrays**, never command strings.
7. **Install strategy — shared cached `node_modules`** (resolved by this review): the fixed React toolchain (react + react-dom + jsdom + the chosen bundler) installs **once** into a persisted cache dir outside the repo (never `package.json` deps — decision 3 / §I forbidden files), and each run **reuses** it. Consequences to design at the gate: (a) the install runs behind its **own timeout, separate from the `runSuite` per-case cap** — the 60 s suite cap covers *grading*, not *installing*, and a cold install of the React toolchain will exceed it; (b) offline is tolerated **after** the first warm install; (c) the cache is keyed on the exact `libs:` set + versions so a new lib set re-installs rather than silently reusing the wrong tree; (d) `validateLibNames` still gates every artifact's `libs:` before its set is admitted to the cache — the cache is a performance layer, **not** a bypass of the allowlist. `ponytail:` global toolchain cache; per-artifact isolated installs only if a future exercise needs a conflicting version.
8. **`css-assert` scope — declared props only** (resolved by this review, §F.3): jsdom computes no layout, so `css-assert` grades declared/inline style and class presence, never rendered geometry. The check kind (T2.6) must reject or clearly no-op a geometry assertion rather than silently pass it; carry the ponytail ceiling comment.

Task cluster (each a §5 six-field task the orchestrator writes once decisions 1–6 are frozen; disjoint files):

- **T2.1** — `TEST_TYPES` `project` row flips reserved→runnable; `project` env skeleton `src/services/test-envs/project/` (registry wiring is an **orchestrator hunk**).
- **T2.2** — parser: case→check binding grammar (from decision 1) + `checks[]` shape + warn on known-but-unparsed keys (spike §5). **Updates `ARTIFACT_LEETCODE_FILE_FORMAT.md`.** Security-critical (parser on untrusted input).
- **T2.3** — `## Files` writer: materialise the file tree under the temp run dir, `path` normalised + containment-asserted (never absolute, never `..`), roles applied (decision 4). Security-critical (filesystem, user paths).
- **T2.4** — installer: `validateLibNames` gate → `npm install` (argv array) into a **shared cache dir keyed on the libs+versions set** (decision 7), reused across runs; its own install timeout, separate from the suite cap; offline tolerated once warm; libs allowlist enforced on every artifact before its set is admitted. Security-critical (subprocess + install).
- **T2.5** — JSX/TSX bundle + jsdom render driver (decision 5): transform component, mount in jsdom, expose event helpers.
- **T2.6** — `dom-assert` / `css-assert` check kinds: fire events, assert DOM; `css-assert` reads **declared/inline style + class presence only, never layout geometry** (decision 8, jsdom no-layout ceiling — carry the `ponytail:` comment); parse per-case outcomes through the existing sentinel protocol.
- **T2.7** — `build` check kind (spike §4): declared `argv` + optional `dir` (containment-asserted) exits 0.
- **T2.8** — panel + harness: render `project` results; extend `verifyExercise` with a `project` branch (render checks green).

### Phase 3 — migrate the 4 React exercises (depends on Phase 2)

One task per React exercise (E57–E60), same migration-task template but target `test.type: project`, languages
**js + ts only**, graded by `dom-assert`/`css-assert` checks that encode the exercise essence (§F.3). **Done
when:** the Phase-2-extended harness renders and grades each green. Security-critical (installs + executes
artifact-declared packages).

---

## H. Wave / integration table

| Wave | Phase | Worker tasks (parallel) | Orchestrator integration hunks | Gate |
|------|-------|-------------------------|-------------------------------|------|
| 0 | 0 | T0.1, T0.2, T0.3 | pilot's shared-table rows (if any) | full gate + 4 pilot harness greens |
| 1–6 | 1 | one per F.1/F.2 row (batched by topic) | none (vault-only files) — run full gate to catch stray repo edits | per-file harness green + full gate |
| E42 | 1 | E42 alone (may-ESCALATE) | RREF encoding decision | harness green **or** documented reserved |
| HG | 2 | — | human-gate decisions 1–6 + `ARTIFACT_LEETCODE_FILE_FORMAT.md` sync | — |
| 7–9 | 2 | T2.1–T2.8 (disjoint files, sub-batched) | `TEST_TYPES` row, env registration, `LANG_ALIAS`/`LANG_EXT` tsx/jsx/css rows | full gate |
| 10 | 3 | E57–E60 | none (vault-only) | per-file render harness green |

**No wave dispatches while a wave producing its inputs is still running. A red gate stops all dispatch.**

---

## I. Instance parameters (append to `CREATING_A_PLAN.md` §2 role templates)

- **Repo:** `/Users/nick/D3v/Dexsys/Extensions_Plugins/ObsidianArtifacts/obsidian-artifacts-leetcode-vscode`
- **Branch:** `feature/VSX-122_multilib-multilang-support`
- **Vault target:** `/Users/nick/N0t3s/L33tC0d3/CoderByte`  ·  **Source:** `/Users/nick/N0t3s/5tudy-N0t3s/Interviews/LeetCode/CoderByte - Leet`
- **Gate:** the §G block (`rm -rf dist && pnpm compile && pnpm lint && mocha …`, then `npx tsc --noEmit`). pnpm, never npm.
- **Harness:** `node scripts/verify-exercise.mjs "<file>"` (Phase-0 deliverable) — the per-exercise TDD instrument. **Precondition: `pnpm compile` first** (imports from `dist/`; the CLI asserts `dist/` and errors readably if absent).
- **Forbidden files (never edit):** golden snapshots (`test/leetcode-codegen-golden.test.ts` and any `*-golden*`); `ARTIFACT_LEETCODE_FILE_FORMAT.md` **except** in the tasks explicitly marked as updating it (T2.2, E56 if a new reserved token); `package.json` runtime deps — the extension ships **zero** runtime dependencies (per-run installs go into the temp run dir, never the repo manifest).
- **Report caps:** worker report ≤ 15 lines (caveman).
- **Skills every agent loads first (Skill tool):** `caveman`, `ponytail`, `mastering-typescript`. (Human instruction: caveman + ponytail in all agents and tasks.)

## J. Orchestrator protocol

1. **Read order:** this file → `CREATING_A_PLAN.md` (templates + process) → `progress.md`. Nothing else needed to start.
2. **Per-wave review loop** (`CREATING_A_PLAN.md` §2): orchestrator lands its own rows/hunks → dispatch workers (sonnet) in parallel → **(Phase-1 waves with the §D.7 cross-check enabled: after each artifact is harness-green, dispatch a recompute worker that sees inputs+prose only, diff its expecteds, feed mismatches back as `CHANGES` — same 2-round cap — before review)** → per task, pass task block + report + diff to the wave's single reviewer (opus, continued via SendMessage) → `CHANGES` back to the same worker, **max 2 rounds**, then `ESCALATE` to orchestrator → all `APPROVE` → integrate hunks → gate → ledger → next wave.
3. **Commit policy:** orchestrator commits **once per wave**; workers never commit. Migration waves touch **no repo files** (vault-only) — the "commit" for those waves is a ledger update + a note that the vault changed; only Phase 0 / Phase 2 waves produce repo commits.
4. **Red gate = full stop** on all dispatch until green.
5. **Human-gate stop-and-ask points:** the E56 reserved-token choice; the E42 RREF escalation; **Phase-2 design decisions 1–6** (decisions 7–8 are pre-resolved by the plan review — cached install, `css-assert` scope — and only need confirming, not deciding); and the decision to ship Phases 0–1 as their own PR before starting Phase 2.
6. **Security:** the orchestrator names the untrusted-input surface in every security-critical dispatch (all migration tasks, the harness, and every Phase-2 task) and never merges one on a worker self-report alone — the reviewer's manual trace is the check (no taint analyser exists in this repo; `CREATING_A_PLAN.md` §3.1).
7. **Doc-sync:** any task changing the `.md` grammar updates `ARTIFACT_LEETCODE_FILE_FORMAT.md` in the same change (T2.2; possibly E56). The parser wins if they disagree — the doc is the bug.

## K. Definition-of-done checklist (`CREATING_A_PLAN.md` §9)

- [x] Every phase names the existing authority it extends (`TEST_TYPES`, `LANGUAGES`, `LANG_ALIAS`/`LANG_EXT`, the env registry, `validateLibNames`, the parser + sections helpers) — no new parallel table.
- [x] Every concrete task has the six §5 fields; the 56 homogeneous migration tasks share one template + an inventory row (dispatchable by expansion).
- [x] Each wave's tasks own disjoint file sets (vault `.md` files are inherently disjoint; Phase-0/2 test files are named per task).
- [x] No task depends on a task in its own wave.
- [x] Plan names its companion files, declares itself their authority, contains the orchestrator protocol (§J) + instance parameters (§I); templates are **not** re-copied.
- [x] Shared-file wire-ups (registry registration, `TEST_TYPES`/`LANG_ALIAS`/`LANG_EXT` rows, pilot shared-table rows) are listed as **orchestrator integration hunks** in §H, not inside worker tasks.
- [x] Every untrusted-input task (all migrations, the harness, every Phase-2 task) is marked security-critical with a hostile input in Test-first and the **reviewer's manual security trace** named in its Gate — never `sonar-analyze` (§3.1).
- [x] Every `vscode`-free task names a test file + first failing assertion (T0.1, T0.2, T2.2…; migrations use the harness as the failing test).
- [x] `vscode`-coupled Phase-2 panel work (T2.8) names its F5 click-path — **to be filled when T2.8 is written** (post human-gate).
- [x] Deliberate simplifications carry a `ponytail:` comment naming the ceiling (E42 float encoding + the general §D.6 determinism rule, the shared toolchain-cache install boundary, the jsdom no-layout `css-assert` ceiling, the RREF/reserved fallback).
- [x] Any `.md` format change updates `ARTIFACT_LEETCODE_FILE_FORMAT.md` in the same change (T2.2; E56 if a new reserved token).
- [x] `progress.md` exists with every task at `todo`.
- [ ] PR checklist ends with `git rm -r docs` (see below) — enforced at PR time, not now.

## L. PR checklist (last commit before each PR)

- [ ] `git rm -r docs` — the PR diff contains no `docs/` path (branch-local plan, per `CREATING_A_PLAN.md` §1).
- [ ] Anything permanent promoted into `CLAUDE.md` / `ARTIFACT_LEETCODE_FILE_FORMAT.md` / JSDoc **before** the delete commit.
- [ ] Vault migration is **not** in the repo diff (decision 3) — confirm `git status` shows only extension + harness changes.
