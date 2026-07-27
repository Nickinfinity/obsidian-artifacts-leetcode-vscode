# Plan — Evaluation-run fixes (React env · Tetris · grader tooling · residual docs)

**Feature slug:** `eval-fixes`
**Branch:** `feature/VSX-122_multilib-multilang-support`
**Authority:** This file is the single entry point and the authority its companion derives from:

- `progress.md` — the ledger (one row per task; **orchestrator writes it, never a worker**).

**No `jira-tickets.md`** — per the human instruction, this work is tracked as bug/issue corrections, not
Jira stories. Each task is a defect or gap fix against shipped state, not a feature epic.

Read this file once, in full, alongside [`CREATING_A_PLAN.md`](../../../CREATING_A_PLAN.md) (the process; §2 holds the
orchestrator/reviewer/worker templates — **this plan never re-copies them**, it only appends the instance
parameters in §I below). The React phase (Phase B) **reuses**, not re-derives, two prior documents; read them
before dispatching Phase B: [coderbyte-migration/plan.md §Phase-2 + §F.3](../coderbyte-migration/plan.md) and
[rust-multilang/spike-findings.md](../rust-multilang/spike-findings.md).

---

## A. Where this plan comes from

The evaluation-system validation run ([eval-validation-findings.md](../coderbyte-migration/eval-validation-findings.md))
proved the **function**-type grader works end-to-end (6/6 blind independent solves passed the hidden finals across
all five runtimes; adversarial probes confirmed the sentinel isolation, per-case try/catch, and exact reject). It
also recorded five gaps. This plan fixes the four actionable ones and documents the fifth:

| Gap | Severity | This plan |
|-----|----------|-----------|
| **G1** — React / `project` type is completely unevaluable (`testEnvFor('project', …)===undefined`) | HIGH | **Phase B** — build the `project`/react runtime env. **Phase C** migrates the 4 React exercises onto it. |
| **G2** — Tetris blind solve never ran (infra kill), and its piece shapes live only in an image | LOW | **TA.2** — add text piece definitions to the prose (image-independent, difficulty intact) + complete the missing java blind-solve data point. |
| **G3** — no committed tool to grade an arbitrary external candidate | MEDIUM | **TA.1** — promote the scratchpad rig to `scripts/grade-candidate.mjs`. |
| **G4** — candidate global/module state persists across cases in a suite | LOW (by design) | **TA.3** — document the "pure per call" contract in the format spec. |
| **G5** — grader trusts author-supplied `expecteds`; blind solve is a usable oracle | INFO | **TA.3** — note the blind-independent-solve oracle in `CLAUDE.md`. |

**Scope split.** Phase A (G2–G5) is small, low-risk, and **shippable alone** — nothing in it depends on Phase B.
Phase B (the react env) is large and security-critical. Phase C depends on Phase B. Phase A may land as its own PR
before Phase B starts.

**Supersedes coderbyte-migration Phase 2 + Phase 3.** [coderbyte-migration/progress.md](../coderbyte-migration/progress.md)
still lists `T2.1–T2.8` and `E57–E60` as `todo` — that is the **same** react-env + react-migration work this plan
re-expands into `TB.1–TB.8` (§E) and Phase C (§F). **This plan is the single authority for it.** On adopting this
plan the orchestrator marks the coderbyte Phase-2/Phase-3 ledger rows `dropped → tracked in eval-fixes` so no task
is dispatched twice. coderbyte-migration's Phase 0 + Phase 1 (function migration, already `done`) are untouched.

---

## B. Tetris solvability finding (grounds TA.2 — no code change to the runner)

The Tetris reference (`Simulation/Tetris Move.md`) is **independently green** through `verify-exercise.mjs`, and its
model is a standard tetromino hard-drop simulation:

- 7 standard pieces (`I O T S Z L J`); distinct 90°-CW rotations enumerated and de-duplicated.
- Hard drop: the piece rests on the highest contact — `drop = max_col(height[col] − lowestPieceRowIn[col])`.
- Score: `completedRows = (full rows in [0..maxRow] after the drop) − min(heights)`. `min(heights)` is exactly the
  count of rows already full below the stack minimum, so this counts **newly** completed rows (the prose's
  "above the pre-drop minimum height" rule). Self-consistent and green.

**It is solvable from prose** by a solver who knows standard tetromino geometry. The **only** barrier to a
strictly text/blind solver is that the seven base orientations are shown **only** in `tetris-piece-board.png`, an
image an AI/text solver cannot read. The eval's Tetris agent was killed by a session limit before writing — an
infra miss, not a grader or design defect.

**Fix (TA.2), difficulty preserved:** add a text/ASCII rendering (or coordinate list) of the 7 base orientations to
the prose so shape identity no longer depends on the image. The algorithmic core — enumerate distinct rotations,
compute the hard-drop landing row, count completed lines — is **unchanged**, so the Hard difficulty is intact. The
image stays (it is the nicer rendering); the text is added beside it. Then complete G2 by having an independent
**java** blind solver reproduce the graded answer through `grade-candidate.mjs` (TA.1) — the one runtime the eval's
completed blind set never exercised.

---

## C. Instance parameters (append to `CREATING_A_PLAN.md` §2 role templates)

- **Repo:** `/Users/nick/D3v/Dexsys/Extensions_Plugins/ObsidianArtifacts/obsidian-artifacts-leetcode-vscode`
- **Branch:** `feature/VSX-122_multilib-multilang-support`
- **Vault:** `/Users/nick/N0t3s/L33tC0d3/CoderByte` (Tetris at `Simulation/Tetris Move.md`; Phase-C react files land in `React/`).
- **Gate** (every wave that touches repo files):
  ```bash
  rm -rf dist && pnpm compile && pnpm lint && \
    node node_modules/.pnpm/mocha@*/node_modules/mocha/bin/mocha.js --ui tdd "dist/test/**/*.test.js"
  npx tsc --noEmit          # always, after — IDE diagnostics go stale
  ```
  `rm -rf dist` is required, not hygiene (stale `dist/*.js` inflate the pass count). pnpm, never npm.
- **Harnesses:** `node scripts/verify-exercise.mjs "<file>"` (per-exercise verify) and, after TA.1,
  `node scripts/grade-candidate.mjs "<file>" <lang> <candidate>` (grade an arbitrary candidate). Both import from
  `dist/` → `pnpm compile` first; both assert `dist/` and error readably if absent.
- **Forbidden files (never edit):** golden snapshots (`test/*-golden*`); `package.json` runtime deps — the extension
  ships **zero** runtime dependencies (per-run installs go to a temp/cache dir, never the repo manifest);
  `ARTIFACT_LEETCODE_FILE_FORMAT.md` **except** in tasks explicitly marked as updating it (TA.3, TB.2).
- **Report caps:** worker report ≤ 15 lines (caveman).
- **Skills every agent loads first (Skill tool):** `caveman`, `ponytail`, `mastering-typescript`.

---

## D. Phase A — quick fixes (G2–G5)

### Wave A1 (parallel — disjoint files)

#### TA.1 — Promote the arbitrary-candidate grader to a committed CLI (G3)
- **Owns:** `scripts/grade-candidate.mjs`, `test/grade-candidate.test.ts`
- **Reads:** `scripts/verify-exercise.mjs` (the sibling CLI pattern), `src/services/leetcode-suite.helpers.ts`
  (`submitSuite`, `publicCount`), `src/services/test-envs/env.registry.ts` (`testEnvFor`),
  `src/services/leetcode-candidate.helpers.ts` (`buildExecutable`), `src/services/leetcode-runner.service.ts`
  (`runSuite`).
- **Depends on:** none.
- **Test first:** `test/grade-candidate.test.ts` (`vscode`-free) writes a minimal inline `function`-type `.md`
  fixture (one green js candidate) to a temp file, spawns `node scripts/grade-candidate.mjs <tmp.md> javascript
  <correct.js>` → **exit 0**; then spawns it with a deliberately wrong candidate → **exit 1**. First failing
  assertion: `spawnSync(... correct ...).status === 0`.
- **Done when:** `node scripts/grade-candidate.mjs <exercise.md> <lang> <candidate>` prints the per-case
  public+final table and a `VERDICT {…}` line, exits `0` solved / `1` not-solved / `2` bad-input / `3` no-env;
  asserts `dist/` exists first (readable error otherwise), mirroring `verify-exercise.mjs`.
- **Gate:** the §C gate. **Security-critical** — it runs an **external** candidate and takes an argv candidate
  **path** (never a path built from artifact content) through the real `runSuite`. Test-first includes a wrong
  candidate; the reviewer's manual trace confirms: candidate reaches the child as **file contents**, argv is
  operator input only, no artifact title is joined into a path, no `exec`/string-interpolated command.

#### TA.3 — Document the two grader residuals (G4, G5)
- **Owns:** `ARTIFACT_LEETCODE_FILE_FORMAT.md` (G4), `CLAUDE.md` (G5).
- **Reads:** [eval-validation-findings.md](../coderbyte-migration/eval-validation-findings.md) G4/G5.
- **Depends on:** none.
- **Test first:** none — documentation only (no `vscode`-free unit; no behaviour changes).
- **Done when:** (G4) the format spec states the candidate contract *"one process/context per suite — a candidate
  must be pure per call; module/global state persists across cases in a suite and must not be relied on"* beside the
  batch-protocol description; (G5) `CLAUDE.md` notes near the verification harness that *"one blind independent
  solve graded via `grade-candidate.mjs` is the §D.7 correctness cross-check's cheaper cousin — an independent
  solver passing the hidden finals is strong evidence the stored `expecteds` are correct."*
- **Gate:** the §C gate (no test-count change expected). Not security-critical (docs only). **Doc-sync:** this is
  one of the two tasks permitted to edit `ARTIFACT_LEETCODE_FILE_FORMAT.md`; it documents an existing contract, it
  does **not** change the grammar, so the parser is unaffected.

### Wave A2 (depends on TA.1)

TA.2 is **two workers with a strict internal order**, not one: the prose edit must land **first** so the blind
solver reads the image-free statement, then the file is re-blinded and an independent java worker solves it. They
are split into TA.2a → TA.2b so no single worker both authors the statement and solves it.

#### TA.2a — Tetris: add text piece definitions to the prose (G2, part 1)
- **Owns:** `CoderByte/Simulation/Tetris Move.md` (**vault**, not a repo path) — add a text/ASCII rendering (or
  coordinate list) of the 7 base orientations (`I O T S Z L J`) to the prose, beside the existing `![[…]]` image.
  Do **not** touch the frontmatter, `## Examples`, `## Tests`, `## Final Tests`, `# Setup`, or `# Solutions`.
- **Reads:** `Simulation/Tetris Move.md` (current), §B of this plan, `scripts/verify-exercise.mjs`.
- **Depends on:** TA.1 (grade harness needed by TA.2b, not by the edit itself; sequenced here so the wave is one unit).
- **Test first:** run `node scripts/verify-exercise.mjs "…/Simulation/Tetris Move.md"` **before** the edit to record
  the green baseline, then **after** — it must stay **green** (the reference suite is unchanged, so a still-green
  run proves the edit was prose-only). This is the failing→green anchor.
- **Done when:** verify stays green and the 7 base orientations are readable from text alone (image no longer the
  sole source of shape identity); difficulty intact (no change to any expected value or I/O mapping).
- **Gate:** verify green. Vault-only (no repo file change) → orchestrator runs the full §C gate at wave close to
  catch stray repo edits. **Security-critical** (authoring untrusted `.md` shape): reviewer confirms the prose edit
  changed no frontmatter, no example/test/final case, no `# Setup`/`# Solutions` fence.

#### TA.2b — Tetris: independent java blind-solve → grade (G2, part 2)
- **Owns:** nothing on disk that ships — produces a throwaway `<scratchpad>/sol-tetris.java` candidate only.
- **Reads:** a **blinded** copy of the TA.2a-updated statement — `# Solutions` and `## Final Tests` stripped (the
  `mkblind.mjs` stripper from the eval run; regenerate in the scratchpad if wiped, ~15 lines). The worker is
  **never shown** the reference solution or the hidden finals. Plus the candidate contract (bare static method, no
  stdin/main) and `scripts/grade-candidate.mjs` (TA.1).
- **Depends on:** TA.2a (blinds the *updated* file) **and** TA.1 (the grader).
- **Test first:** `spawn node scripts/grade-candidate.mjs "…/Tetris Move.md" java <candidate.java>` — the anchor is
  its exit code (0 = solved) computed against public **+ hidden final**, the hidden set the worker never saw.
- **Done when:** the independent java candidate grades **solved** (public + hidden final), forbidden from hardcoding
  visible cases. This closes G2's missing java data point and proves the exercise is solvable image-free — java is
  the one runtime the eval's completed blind set never exercised.
- **Gate:** grade-candidate exit 0. No repo/vault file changes → full §C gate at wave close for stray edits.
  **Security-critical** (runs candidate code): candidate is a **bare static method**, must **not** read stdin;
  reviewer confirms the candidate was written from the blinded statement, not the reference.

> **Orchestrator note (TA.2b):** the two workers must be different dispatches — the TA.2b worker gets the blinded
> copy only, never the vault path to the full file, so it cannot read `# Solutions`.

---

## E. Phase B — the `project` / react runtime env (G1)

This is the large, security-critical phase. It closes the [spike-findings.md](../rust-multilang/spike-findings.md)
§1–§8 gaps and flips `TEST_TYPES` `project` from `reserved` to `implemented`. **Design rationale is not re-derived
here** — read coderbyte-migration/plan.md §Phase-2 (decisions + T2.1–T2.8 outline) and spike-findings §1–§8. This
plan's job is to (a) resolve the open grammar decisions at a human gate and (b) expand the outline into
dispatchable six-field tasks.

**Authority it extends (no new parallel table):** `TEST_TYPES` (`constants.ts`, reserved→implemented row is an
**orchestrator hunk**), the env registry (`test-envs/env.registry.ts`, `project` registration — **orchestrator
hunk**), the parser + sections helpers, and the existing `validateLibNames` allowlist
([`lib-spec.helpers.ts`](../../../src/services/lib-spec.helpers.ts)) — which **already ships** and needs no change.

**`LANG_ALIAS`/`LANG_EXT` `tsx`/`jsx`/`css` rows already ship** — [constants.ts](../../../src/types/constants.ts)
carries `jsx: 'javascriptreact'` (L24), `tsx: 'typescriptreact'` (L26), `css: 'css'` (L85) and their reverse
`LANG_EXT` rows. **No orchestrator hunk on these tables is needed** (an earlier draft, and coderbyte-migration
§Phase-2 decision 3, listed one — that is stale; trust the tree, CLAUDE.md). What is **not** yet settled is which
language ids the `project` env registers under: `jsx`/`tsx` resolve to `javascriptreact`/`typescriptreact`, which
are **not** runnable `LangId`s, so TB.1 decides whether `project` registers `javascript`/`typescript` (and maps
`.jsx`/`.tsx` files onto them at bundle time) — a registration decision, not a cosmetic-table edit.

### E.1 Human gate HG-B (orchestrator + human, **before** any TB worker dispatch)

Four open grammar/mechanism decisions block the parser and driver shape (spike §1, §2, §6, §7). Recommended
defaults are given; the human confirms or overrides, and the orchestrator updates
`ARTIFACT_LEETCODE_FILE_FORMAT.md` in the same change (doc-sync). Decisions **7 and 8 from the prior plan are
already resolved** (shared cached `node_modules`; `css-assert` = declared/inline style + class presence only, never
layout geometry — jsdom has no layout engine) and only need confirming.

| # | Decision (spike ref) | Recommended default | Alternative |
|---|---|---|---|
| 1 | Case→check binding (§1) — the fence regex `/```json\r?\n…/` forbids ` ```json check=api ` today | **Widen `JSON_FENCE` to accept a `check=<name>` attribute and take *all* json fences** (each binds to its named check) | Move cases into `checks[].cases` in frontmatter |
| 2 | Per-check `params`/`returns` (§2) | **Zero-or-one `function` check per `project`** — a project may be graded entirely by `dom-assert`/`css-assert`/`build`; artifact-level `params`/`returns` are **optional**, present only when a function check exists. **E57–E60 have none.** So `verifyExercise`'s `project` branch (TB.1/TB.8) must **not** apply the function structural floor (`params`/`returns`, the 6/3 counts). | `checks[].params`/`checks[].returns` nesting |
| 4 | `role: readonly` mechanism (§7) | **Write `readonly` files with a read-only file mode** | Keep them `hidden` and render content in the panel |
| 5 | JSX/TSX bundler (§6) — `stripTypeScriptTypes` cannot handle JSX | **Per-run `esbuild`** (installed with the libs; ponytail default) | `tsc` |

Decision 3 (`tsx`/`jsx`/`css` recognition) is **already resolved in the tree** — the `LANG_ALIAS`/`LANG_EXT` rows
ship today (see the authority note above); it is neither a fork nor a pending hunk. CSS remains a file role in
`## Files`, never a `LangId`. The live sub-question — which runnable id the `project` env registers `.jsx`/`.tsx`
under — is owned by TB.1, not this gate. Decision 6 (trust boundary) is settled: every `libs:` entry passes
`validateLibNames` before any install subprocess; install/start are **argv arrays**, never command strings.

### E.2 TB tasks (each expanded from the T2.x outline; disjoint files per wave)

#### TB.1 — `project` domain types + env skeleton
- **Owns:** `src/types/leetcode.types.ts` **only for the additive** `ProjectCheck`/`FileSpec`/`LibSpec` types +
  `files`/`libs`/`checks` fields on the parsed shape (DDD: named type before behaviour), `test/project-types.test.ts`,
  `src/services/test-envs/project/project.env.ts` (skeleton: `validate`/`emit`/`parse` stubs that compile).
- **Reads:** `src/services/test-envs/env.types.ts`, `env.registry.ts`, `make-function-env.ts` (shape reference),
  `src/services/exercise-verify.helpers.ts` (the `reserved` branch this flip changes — see the guard below),
  `src/types/languages.ts` (`LangId` — `javascriptreact`/`typescriptreact` are **not** members), spike §2–§3.
- **Depends on:** HG-B (grammar frozen).
- **Registration decision (from §E.1, decision 3 sub-question):** the `project` env registers under the runnable
  ids **`javascript` + `typescript`** (a `.jsx`/`.tsx` file maps onto them at bundle time, decision 5); it does
  **not** register `javascriptreact`/`typescriptreact`, which are display ids with no runtime. `languagesForType('project')`
  therefore returns `['javascript', 'typescript']`.
- **Test first:** `test/project-types.test.ts` — a `satisfies`-checked literal of a `ProjectCheck` union
  (`kind: 'function' | 'build' | 'dom-assert' | 'css-assert'`) narrows correctly; first failing assertion: the
  discriminant narrows a `kind: 'build'` check to expose `argv`/`dir` and nothing else.
- **Done when:** the types compile `vscode`-free and the env skeleton registers a shape `testEnvFor('project', …)`
  can later return. **The `TEST_TYPES` reserved→implemented flip, the `env.registry.ts` registration, AND the
  `verifyExercise` `project` guard (below) are orchestrator hunks**, landed together at wave close — not this
  worker's edit.
- **⚠ Orchestrator hunk landed WITH the flip — the guard (fixes the latent break):** the moment `project` flips to
  `implemented`, `languagesForType('project')` stops being `[]`, so `verifyExercise`
  ([exercise-verify.helpers.ts:71](../../../src/services/exercise-verify.helpers.ts#L71)) would compute
  `reserved = false` and route a `project` artifact through the **function** floors (`checkStructure`'s
  `params`/`returns` + 6/3 counts, then `checkSolutionsGreen`'s function-suite `runSuite`) — wrong for a
  check-graded project, and it stays wrong until TB.8. So the B1 hunk **also** adds an early
  `if (parsed.test.type === 'project') return verifyProjectExercise(parsed)` branch that skips the function floor.
  `verifyProjectExercise` is a **structural-only stub here** (files/libs/checks present, no function floor,
  no run); TB.8 fills its real check-grading. Without this, B1–B5 ship a `verifyExercise` that mis-grades project.
- **Gate:** the §C gate. Not itself security-critical (types + stubs), but every downstream TB task is.

#### TB.2 — Parser: `## Files`, `libs:`, `checks:`, case→check binding, unknown-key warning
- **Owns:** a **new** `src/services/project-parser.helpers.ts` (decided, not deferred:
  [leetcode-parser.helpers.ts](../../../src/services/leetcode-parser.helpers.ts) is already **431L**, at the
  CLAUDE.md size ceiling — do not grow it; the `project` grammar is its own concern), `test/project-parser.test.ts`,
  and **updates** `ARTIFACT_LEETCODE_FILE_FORMAT.md` (the `project` grammar from HG-B decisions 1–2). The one-line
  call site that dispatches `test.type: 'project'` into the new helper from `leetcode-parser.service.ts` is an
  **orchestrator hunk** (shared entry file), not this worker's edit.
- **Reads:** `leetcode-sections.helpers.ts` (`JSON_FENCE`, `sectionBounds`), spike §1, §2, §5, TB.1 types.
- **Depends on:** TB.1.
- **Test first:** `test/project-parser.test.ts` — a `project` artifact with a `## Files` tree, `libs:`, and two
  ` ```json check=<name> ` suites parses into `checks[]` with cases bound by name; a typo'd known key
  (`servcies:`) yields a warning, not silent drop (spike §5); a malformed `checks:` degrades via `safeJsonParse`
  to a documented default, never a throw. First failing assertion: `parsed.checks.length === 2` with correct
  per-check case counts.
- **Done when:** the grammar parses per the HG-B decisions; the format spec matches the parser (parser wins if they
  disagree — the doc is the bug). **Security-critical** (parser on untrusted `.md`): Test-first includes a hostile
  fixture — unguarded-parse bait (`checks:` = `"not json"`), an oversized/prototype-polluting key — asserting
  `safeJsonParse` containment and no `__proto__` reach-through. Gate names the reviewer's manual trace.

#### TB.3 — `## Files` writer (filesystem containment)
- **Owns:** `src/services/test-envs/project/files.writer.ts`, `test/project-files-writer.test.ts`.
- **Reads:** TB.1 types, the runner's `mkdtemp` pattern, `path` containment idioms already used for attempts.
- **Depends on:** TB.2.
- **Test first:** `test/project-files-writer.test.ts` — materialises a file tree under a temp run dir; a `path`
  that is absolute, or contains `..`, or escapes the run root is **rejected before any write**. First failing
  assertion: `writeFiles(runDir, [{path:'../../etc/x', …}])` throws/returns error and writes nothing.
- **Done when:** every declared file lands under the run dir with its `role` applied (decision 4); no path escapes.
  **Security-critical** (filesystem, user-influenced paths): every `path` normalised and containment-asserted
  before any write; hostile-path fixture in Test-first; reviewer trace named.

#### TB.4 — Per-run installer (subprocess + shared cache)
- **Owns:** `src/services/test-envs/project/lib-installer.ts`, `test/project-lib-installer.test.ts`.
- **Reads:** `lib-spec.helpers.ts` (`validateLibNames`, already ships), coderbyte-migration decision 7 (shared
  cache), TB.1 types.
- **Depends on:** TB.2.
- **Test first:** `test/project-lib-installer.test.ts` — `validateLibNames` gate rejects a flag-shaped
  (`--target=/etc`) and traversal-shaped (`../../x`) lib **before** any subprocess; the install command is built as
  an **argv array** (asserted structurally), never a string; the cache key is a function of the exact libs+versions
  set (a different set → a different key). First failing assertion: an invalid lib name yields no `execFile` call.
- **Done when:** valid libs install once into a persisted cache dir **outside the repo** (never `package.json`),
  keyed on libs+versions, reused across runs, behind an **install timeout separate from the `runSuite` per-case
  cap**; offline tolerated once warm; `ponytail:` comment names the global-cache ceiling + "per-artifact isolated
  installs only if a future exercise needs a conflicting version". **Security-critical** (subprocess + install):
  argv arrays via `execFile`, allowlist enforced on every artifact's set before admission to the cache (the cache
  is a perf layer, **not** an allowlist bypass); reviewer trace named.
- **⚠ Cache dir must resolve in BOTH run contexts** — the `project` env's `emit` runs inside the extension **and**
  inside the headless `verify-exercise.mjs` / `grade-candidate.mjs` CLIs, which have **no** `globalStorageUri`. So
  the cache path is **not** derived from a `vscode` context: resolve it context-free, e.g.
  `path.join(os.tmpdir(), 'obsidian-leetcode-libcache')` (or an env-var override), computed the same way in both.
  The installer function takes no `vscode` argument. Test-first asserts the resolver is pure (`vscode`-free) and
  stable across calls.

#### TB.5 — JSX/TSX bundle + jsdom render driver
- **Owns:** `src/services/test-envs/project/render.driver.ts`, `test/project-render-driver.test.ts`.
- **Reads:** HG-B decision 5 (esbuild), spike §6, TB.3 (file layout), TB.4 (installed libs).
- **Depends on:** TB.3, TB.4.
- **Test first:** `test/project-render-driver.test.ts` — a trivial component bundles (esbuild) and mounts in jsdom;
  the driver exposes event helpers (click/change) and a DOM query surface; a non-erasable/broken component reports
  a **per-case error** through the sentinel protocol, never crashing the child. First failing assertion: a mounted
  `<button>` is queryable and clickable, its handler observed.
- **Done when:** components transform + mount + accept fired events; output flows through the `__LEET__` sentinel.
  **Security-critical** (executes bundled artifact code): runs in the run dir `cwd`, argv-array commands; reviewer
  trace named.

#### TB.6 — `dom-assert` / `css-assert` check kinds
- **Owns:** `src/services/test-envs/project/checks.ts`, `test/project-checks.test.ts`.
- **Reads:** TB.5 driver, `sentinel.helpers.ts`, HG-B decision 8 (css-assert declared-only), spike §8.
- **Depends on:** TB.5.
- **Test first:** `test/project-checks.test.ts` — a `dom-assert` fires an event and asserts resulting DOM
  (pass/fail per case, `__LEET__` line each); a `css-assert` reads a **declared/inline** style or class presence
  and **rejects or clearly no-ops a layout-geometry assertion** (jsdom computes no layout) rather than silently
  passing it. First failing assertion: a geometry assertion (`width` from box model) is refused with a readable
  message. Carry the `ponytail:` jsdom-no-layout ceiling comment ("swap for a layout-capable headless browser if
  geometry grading is ever required").
- **Done when:** both check kinds grade through the sentinel, `css-assert` scoped to declared props only.
  **Security-critical** (grades untrusted component behaviour): reviewer trace named.

#### TB.7 — `build` check kind
- **Owns:** `src/services/test-envs/project/build.check.ts`, `test/project-build-check.test.ts`.
- **Reads:** spike §4 (`argv` + optional `dir`), TB.3 (containment idiom).
- **Depends on:** TB.2.
- **Test first:** `test/project-build-check.test.ts` — a declared `argv` runs with the run dir (or a
  containment-asserted `dir` subtree) as `cwd`, exit 0 → pass; a `dir` with `..` is rejected. First failing
  assertion: `dir: '../..'` rejected before spawn.
- **Done when:** `build` runs the declared argv (array), optional `dir` containment-asserted, exit code = verdict.
  **Security-critical** (subprocess + user path): argv array, `dir` normalised+contained; reviewer trace named.

#### TB.8 — Panel + harness `project` branch (`vscode`-coupled)
- **Owns:** `src/ui/panels/leetcodePreview.panel.ts` (project-results render branch only),
  `src/services/exercise-verify.helpers.ts` (**completes** the `verifyProjectExercise` branch TB.1 stubbed — real
  check-grading now), `test/exercise-verify.test.ts` (project fixture — the pure part), and a **minimal committed
  smoke fixture** `test/fixtures/project-smoke.md` (a one-component `project` exercise with a single `dom-assert`)
  used by the F5 pass — because **no migrated React exercise exists yet** (E57–E60 land at Phase C, *after* this
  wave), so the F5 path cannot depend on one.
- **Reads:** TB.1–TB.7, the existing function-branch render, TB.1's `verifyProjectExercise` stub.
- **Depends on:** TB.6, TB.7.
- **Test first (pure part):** `test/exercise-verify.test.ts` — a green `project` fixture (render checks pass)
  returns `{ ok: true }`; a fixture whose check fails returns `ok: false` with the reason. First failing assertion:
  `verifyExercise(greenProjectMd).ok === true`.
- **F5 click-path (`vscode` part):** open **`test/fixtures/project-smoke.md`** (the committed smoke fixture, not a
  migrated exercise) → the panel shows `project` check results (dom-assert/css-assert/build), not "no environment"
  → Solve It → Run Tests renders per-check pass/fail → Submit grades public+final and ends the run. (The panel
  render branch is verified by F5 only; the pure `verifyExercise` branch by the unit test above.) The real
  E57–E60 exercises are the Phase-C acceptance, not this task's F5.
- **Done when:** `verifyExercise` grades a `project` exercise green/red (function floor **not** applied — HG-B
  decision 2), and the panel renders project results under F5. **Security-critical** (webview interpolation of
  check output): every interpolated value through `escHtml`, CSP/nonce/`localResourceRoots` intact; reviewer trace named.

**Orchestrator integration hunks (Phase B, landed at wave close — never a worker edit):** at **B1**, together —
`TEST_TYPES` `project` reserved→implemented (`constants.ts`) · `project` env registration (`env.registry.ts`) ·
the `verifyExercise` `project` guard routing to TB.1's stub (`exercise-verify.helpers.ts`) · the
`leetcode-parser.service.ts` dispatch line into TB.2's `project-parser.helpers.ts`. **No `LANG_ALIAS`/`LANG_EXT`
hunk** — the `tsx`/`jsx`/`css` rows already ship (§E authority note).

---

## F. Phase C — migrate the 4 React exercises (depends on Phase B)

One task per React exercise, same migration-task template as coderbyte-migration §Phase-1 but `test.type: project`,
languages **javascript + typescript only**, graded by `dom-assert`/`css-assert` checks encoding each essence
([coderbyte-migration §F.3](../coderbyte-migration/plan.md)). Vault-only files under `React/`.

| id | Source `.md` | Grades (essence) |
|----|--------------|------------------|
| E57 | React Tic Tac Toe | click square → X/O alternation; winner (row/col/diag); reset; no-override of a filled square. |
| E58 | React Phone Book | form → submit appends to a list sorted by last name; empty-field guard; prepopulated defaults. |
| E59 | React Letter Tiles | 26 uppercase tiles; click appends to `#outputString`; 3 consecutive identical letters collapse to `_`. |
| E60 | React Context API | toggle cycles favourite language via `React.createContext` + `Provider`; default = array[0]. |

**Per task** — **Owns:** `CoderByte/React/<Name>.md` (vault). **Test first / Done when:** the Phase-B-extended
`verify-exercise.mjs` renders and grades each **green** (all declared checks pass, public + final). **Security-critical**
(installs + executes artifact-declared packages): reviewer confirms `libs:` passes `validateLibNames`, no path
built from a title. **Depends on:** Phase B complete.

---

## G. Wave / integration table

| Wave | Phase | Worker tasks (parallel) | Orchestrator hunks | Gate |
|------|-------|-------------------------|--------------------|------|
| A1 | A | TA.1, TA.3 | none | full §C gate |
| A2 | A | **TA.2a** (prose) → **TA.2b** (blind java, sequential) | none (vault-only; run full gate to catch stray repo edits) | TA.2a verify green · TA.2b grade-candidate exit 0 · full gate |
| HG-B | B | — | HG-B decisions 1,2,4,5 + `ARTIFACT_LEETCODE_FILE_FORMAT.md` sync | — |
| B1 | B | TB.1 | `TEST_TYPES` flip + `env.registry` registration + **`verifyExercise` `project` guard** + parser dispatch line (all together — see TB.1 ⚠) | full gate |
| B2 | B | TB.2 | none | full gate |
| B3 | B | TB.3, TB.4, TB.7 | none | full gate |
| B4 | B | TB.5 | **none** — `tsx`/`jsx`/`css` alias rows already ship (§E note) | full gate |
| B5 | B | TB.6 | none | full gate |
| B6 | B | TB.8 | none | full gate + F5 click-path (on committed `project-smoke.md`) |
| C | C | E57–E60 | none (vault-only) | per-file render harness green |

**No wave dispatches while a wave producing its inputs still runs. A red gate stops all dispatch.** **A2 is a
two-worker sequence, not a parallel pair** — TA.2b needs TA.2a's edited-then-reblinded statement.

---

## H. Orchestrator protocol

1. **Read order:** this file → `CREATING_A_PLAN.md` (templates + process) → coderbyte-migration/plan.md §Phase-2 +
   spike-findings.md (Phase B only) → `progress.md`.
2. **Per-wave review loop** (`CREATING_A_PLAN.md` §2): orchestrator lands its own hunks → dispatch workers (sonnet)
   parallel → per task pass task block + report + diff to the wave's single reviewer (opus, continued via
   SendMessage) → `CHANGES` back to the same worker, **max 2 rounds**, then `ESCALATE` to orchestrator → all
   `APPROVE` → integrate hunks → gate → ledger → next wave.
3. **Commit policy:** orchestrator commits **once per wave**; workers never commit. Vault-only waves (A2, C) touch
   no repo files — their "commit" is a ledger update + a note that the vault changed.
4. **Red gate = full stop** on all dispatch until green.
5. **Human-gate stop-and-ask:** HG-B decisions 1,2,4,5 (decisions 7,8 pre-resolved — confirm only); and the choice
   to ship Phase A as its own PR before Phase B.
6. **Security:** the orchestrator names the untrusted-input surface in every security-critical dispatch (TA.1,
   TA.2a, TA.2b, TB.2–TB.8, E57–E60) and never merges one on a worker self-report alone — the reviewer's manual
   trace is the check (no taint analyser exists in this repo; `CREATING_A_PLAN.md` §3.1).
7. **Doc-sync:** TA.3 and TB.2 are the only tasks permitted to edit `ARTIFACT_LEETCODE_FILE_FORMAT.md`; the parser
   wins if doc and parser disagree — the doc is the bug.

---

## I. Definition-of-done checklist (`CREATING_A_PLAN.md` §9)

- [x] Every phase names the **existing** authority it extends (`TEST_TYPES`, `LANG_ALIAS`/`LANG_EXT` — **already
      carry the `tsx`/`jsx`/`css` rows**, env registry, parser+sections helpers, `validateLibNames`) — no new
      parallel table, and no hunk on a table that already ships.
- [x] Every concrete task has the six §5 fields; the 4 homogeneous Phase-C tasks share one template + a row.
- [x] Each wave's tasks own disjoint file sets (test files + docs included); TB.2 owns a **new**
      `project-parser.helpers.ts` (not the 431L parser helpers), named at plan time not dispatch.
- [x] No task depends on a task in its own wave. **Exception, made explicit:** A2 is a **sequence** (TA.2a → TA.2b),
      not a parallel pair — TA.2b consumes TA.2a's output; §G marks it.
- [x] Plan names its companion (`progress.md`), declares itself its authority, contains the orchestrator protocol
      (§H) + instance parameters (§C); templates are **not** re-copied; Phase B references prior plans, not a
      re-derivation; **supersedes coderbyte-migration Phase 2+3** (§A) — one authority for the react work.
- [x] Shared-file wire-ups are **orchestrator integration hunks** in §G, not inside worker tasks — at **B1**:
      `TEST_TYPES` flip, env registration, the **`verifyExercise` `project` guard** (closes the B1–B5 latent break),
      and the parser dispatch line. **No `LANG_ALIAS`/`LANG_EXT` hunk** (rows already ship).
- [x] Every untrusted-input task (TA.1, **TA.2a, TA.2b**, TB.2–TB.8, E57–E60) is marked security-critical with a
      hostile input in Test-first and the **reviewer's manual security trace** named — never `sonar-analyze` (§3.1).
- [x] Every `vscode`-free task names a test file + first failing assertion (TA.1, TB.1–TB.7, TB.8 pure part).
- [x] The one `vscode`-coupled task (TB.8) names its F5 click-path — on a **committed** `project-smoke.md` fixture,
      because no migrated React exercise exists at B6 (E57–E60 land at Phase C).
- [x] Deliberate simplifications carry a `ponytail:` comment naming the ceiling (TB.4 global cache, TB.6 jsdom
      no-layout, TB.2 zero-or-one-function-per-project rule).
- [x] Any `.md` format change updates `ARTIFACT_LEETCODE_FILE_FORMAT.md` in the same change (TA.3 doc-only, TB.2
      grammar).
- [x] `progress.md` exists with every task at `todo`.
- [ ] PR checklist ends with `git rm -r docs` (see §J) — enforced at PR time, not now.

---

## J. PR checklist (last commit before each PR)

- [ ] `git rm -r docs` — the PR diff contains no `docs/` path (branch-local plan, `CREATING_A_PLAN.md` §1).
- [ ] Anything permanent promoted into `CLAUDE.md` / `ARTIFACT_LEETCODE_FILE_FORMAT.md` / JSDoc **before** the
      delete commit (TA.3's G4/G5 notes are the intentional promotions).
- [ ] Vault migration (Tetris prose, React files) is **not** in the repo diff — confirm `git status` shows only
      extension + script + doc changes.
