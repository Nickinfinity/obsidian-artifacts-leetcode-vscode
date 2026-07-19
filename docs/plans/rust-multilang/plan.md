# Plan — Rust, Multi-Library, Multi-File, Running Servers

Branch: `feat/rust-multilang` · Process: [CREATING_A_PLAN.md](../../../CREATING_A_PLAN.md)
Ledger: [progress.md](progress.md) · Tickets: [jira-tickets.md](jira-tickets.md)

**Depth (agreed):** Phases 1–2 are task-level and agent-ready. Phases 3–4 are **contract-only**
— types, `.md` format, and service seams are designed; task breakdown waits until 1–2 land and
the real constraints are known. Planning phase 4 tasks today would be planning against fiction.

---

## 0. What this feature is

Four capabilities, ordered by how much of the existing architecture they disturb:

| # | Capability | Disturbance |
|---|---|---|
| 1 | **Rust** as a runnable language for `test.type: function` | None — the registry was built for this |
| 2 | **Libraries** per exercise, per language (lodash, numpy, serde_json) | Adds an install step to `EmittedProgram`; first user data reaching a subprocess argv |
| 3 | **Multi-file / multi-language** exercises (`.tsx` + `.css` + `.py`) | Breaks the one-temp-file challenge model and `EnvContext.code` |
| 4 | **Running servers** — boot a backend, inject its URL into the frontend invisibly | Breaks the zero-runtime-dependency invariant; adds process lifecycle |

### Invariants this feature deliberately changes

Both are load-bearing statements in `CLAUDE.md` and must be rewritten there, in the same
change that breaks them — not after.

1. **"No runtime dependencies."** Still true of the *extension* (it ships none). No longer
   true of a *run*: from Phase 2, a run may shell out to the user's local `npm`/`pip`/`cargo`.
   New wording: *the extension ships zero dependencies; an exercise may declare its own, which
   are installed into the run's temp directory using the user's local toolchain.*
2. **"One temp file per challenge."** From Phase 3 a challenge owns a temp *directory* with N
   files and N editor tabs.

### Decisions taken up front

- **Dependency policy (Phase 2/4):** shell out to the user's local toolchain. Requires network
  and local runtimes; `TestEnv.requires` / `detect()` already model the preflight.
- **Java libraries are out of scope** through Phase 2. There is no install path without Maven
  or Gradle, and inventing one is a phase of its own. `libs.java` parses and reports
  *"library-backed Java exercises are not supported yet"* — the honest, self-explaining
  failure this codebase already prefers for reserved test types.

---

## 1. Phase 1 — Rust function environment

Per `CLAUDE.md`, a runnable language is four rows. This phase is those four rows, one
pre-existing gap, and one enabling refactor.

**Pre-existing state, verified in the tree (not assumed):**

- `PRIMITIVES` already maps `int/float/string/bool` → `i32/f64/String/bool`
  ([leetcode-codegen.service.ts:8-11](../../../src/services/leetcode-codegen.service.ts#L8-L11)) ✅
- `TYPE_SYNTAX.rust` already maps `Vec<T>` / `HashMap<K, V>`
  ([leetcode-codegen.service.ts:44](../../../src/services/leetcode-codegen.service.ts#L44)) ✅
- `LANG_ALIAS.rs → rust` and `LANG_EXT.rust → rs` already exist
  ([constants.ts:31](../../../src/types/constants.ts#L31), [constants.ts:71](../../../src/types/constants.ts#L71)) ✅
- `jsonToLiteral` has **no** Rust branch — arrays would emit `[1, 2]`, a fixed-size
  `[i32; 2]`, not the `Vec<i32>` the type mapping promises ❌ **This is the real gap.**
- `LANG_CODEGEN` has no Rust row; `LangId` has no `'rust'` member ❌

### T0 — Extract per-language codegen into siblings (enabling refactor)

`leetcode-codegen.service.ts` is 355 lines holding two tables *and* six template functions.
Adding Rust's boilerplate + harness pushes it past 500 — the `CLAUDE.md` split threshold — and,
more immediately, it forces T2 and T3 to fight over one file. Extracting first is what makes
the rest of the phase parallel.

- **Owns:** `src/services/codegen/java.codegen.ts`, `src/services/codegen/python.codegen.ts`,
  `src/services/codegen/javascript.codegen.ts`, and the deletions from
  `src/services/leetcode-codegen.service.ts`
- **Reads:** `test/leetcode-codegen-golden.test.ts`
- **Depends on:** none
- **Test first:** none written — this is behaviour-preserving. The **golden net already
  exists** (`test/leetcode-codegen-golden.test.ts`) and must pass **byte-identical, untouched**.
  Editing a golden assertion during this task invalidates the task.
- **Done when:** `leetcode-codegen.service.ts` retains only `PRIMITIVES`, `JAVA_BOX`,
  `TYPE_SYNTAX`, `LANG_CODEGEN`, `mapType`, `jsonToLiteral`, `injectSolution`, and the public
  `generateBoilerplate` / `generateTestHarness` entry points; every per-language template lives
  in its own sibling; golden test passes with zero diff to the test file.
- **Gate:** full gate, test count unchanged.

> **Orchestrator, serial.** Every later task reads this layout.

### T1 — Add `rust` to the language registry

- **Owns:** `src/types/languages.ts`, plus the minimal fix at every site the widened `LangId`
  breaks
- **Reads:** `src/types/constants.ts`, `src/services/leetcode-bigo.service.ts`,
  `src/services/practice-mode.service.ts`
- **Depends on:** T0
- **Test first:** `test/leetcode-languages.test.ts` — assert `LANGUAGES.rust.detectCmd ===
  'rustc --version'`, `LANGUAGES.rust.fileExt === LANG_EXT.rust`, and that every
  `LANGUAGES.rust.aliases` entry resolves through `LANG_ALIAS`. The existing consistency test
  should catch drift automatically; if it does not, that is a bug in the consistency test and
  is fixed here.
- **Done when:** `npx tsc --noEmit` is clean with `'rust'` in the union.
- **Gate:** full gate.

Entry: `{ id: 'rust', displayName: 'Rust', fileExt: 'rs', commentPrefix: '//', detectCmd:
'rustc --version', aliases: ['rs'] }`.

> **Orchestrator, serial.** Widening `LangId` breaks every `Record<LangId, …>` at once —
> `LANG_CODEGEN` is the known one; **grep for the rest rather than trusting this list.** Fan-out
> starts only after `tsc` is green.

### T2 — Rust literals in `jsonToLiteral`

- **Owns:** `src/services/leetcode-codegen.service.ts` (the `jsonToLiteral` family only),
  `test/leetcode-typemap.test.ts`
- **Reads:** `src/services/codegen/*.codegen.ts`
- **Depends on:** T1
- **Test first:** `test/leetcode-typemap.test.ts` —
  `assert.strictEqual(jsonToLiteral([1, 2], 'rust'), 'vec![1, 2]')` fails today (returns `[1, 2]`).
- **Done when:** arrays → `vec![…]` (nested: `vec![vec![1, 2]]`), strings →
  `String::from("…")`, objects → `HashMap::from([(String::from("k"), v), …])`, booleans and
  numbers unchanged, `null` → `None`.
- **Gate:** full gate.

**Two ceilings, both `ponytail:`-commented at the emit site:**

- `[]` emits `vec![]`, which Rust cannot type-infer standalone. Upgrade path: thread the
  declared param type from `parsed.params` into the literal emitter. Not now — no exercise
  needs it yet, and threading the type touches all four languages.
- Strings emit `String::from(…)` to match what `TYPE_SYNTAX` declares. A solver taking `&str`
  gets a compile error rather than a `validate` message; the compile error names the type
  mismatch clearly enough.

### T3 — Rust codegen row

- **Owns:** `src/services/codegen/rust.codegen.ts`, the `LANG_CODEGEN.rust` row,
  `test/leetcode-codegen.test.ts`, new golden cases in `test/leetcode-codegen-golden.test.ts`
- **Reads:** the three sibling codegen modules
- **Depends on:** T1
- **Test first:** `test/leetcode-codegen.test.ts` — `generateBoilerplate(parsed, 'rust')`
  contains `fn <name>(`, the mapped signature from `mapType`, and exactly one
  `SOLUTION_MARKER`.
- **Done when:** boilerplate is a runnable stdin wrapper (`std::io::stdin().read_line`)
  carrying `<<SOLUTION>>`; harness is `assert_eq!`-based over the parsed cases; golden cases
  are **added**, never edited.
- **Gate:** full gate, test count strictly up.

### T4 — `function × rust` test environment

- **Owns:** `src/services/test-envs/function/rust.env.ts`, the registration line in
  `src/services/test-envs/env.registry.ts`, `test/function-env-rust.test.ts`
- **Reads:** `make-function-env.ts`, `python.env.ts` (closest model), `sentinel.helpers.ts`
- **Depends on:** T1, T2
- **Test first:** `test/function-env-rust.test.ts` — `emit(ctx)` returns files
  `['solution.rs', 'runner.rs']`, `compile === 'rustc -O runner.rs -o runner'`,
  `run === './runner'`.
- **Done when:** the env is registered and `languagesForType('function')` returns
  `['java', 'javascript', 'python', 'rust']`.
- **Gate:** full gate **plus** an end-to-end run of a two-case Rust exercise via F5.

**Design — decided here so the agent does not have to invent it:**

| Concern | Decision |
|---|---|
| Linking | `runner.rs` declares `mod solution;`; `rustc` pulls `./solution.rs` as a second unit. Same shape as Java's two compilation units — candidate written **verbatim**, never spliced. |
| Visibility | Items in a `mod` need `pub`. `candidateContent` rewrites a leading `fn <name>` → `pub fn <name>` with one anchored regex. Demanding `pub` from the solver is a hostile contract for a detail the driver invented. |
| `validate` | Reject a candidate with no top-level `fn <name>(`: *"Rust setup must define a top-level `fn <name>(…)` — not a method inside an `impl` block."* Mirrors the Python env's message shape. |
| Serialization | `{:?}` Debug formatting, **no serde**. Covers integers, floats, `bool`, `String`, `Vec`, nested `Vec`, and `HashMap<String, _>` — all of which Debug-print as valid JSON, and `canonicalJson` sorts `HashMap`'s random key order on the extension side. `ponytail:` comment naming the ceiling (no structs, no enums) and the upgrade path (serde_json, once Phase 2 gives Rust a dependency path). |
| Per-case isolation | `std::panic::catch_unwind(AssertUnwindSafe(…))`, message recovered by downcasting the payload to `&str` / `String`. Install a no-op `panic::set_hook` so a failing case does not spray the default panic banner. |
| Timing | `Instant::now()` / `elapsed().as_millis()`. |
| Flushing | `io::stdout().flush()` after every sentinel line — Rust block-buffers a piped stdout, and a timeout-kill would discard lines already produced. This is the same reason Python and Java flush. |

### T5 — Big-O heuristic: Rust patterns

- **Owns:** `src/services/leetcode-bigo.helpers.ts`, `test/leetcode-bigo.test.ts`
- **Reads:** `src/services/leetcode-bigo.service.ts`
- **Depends on:** T1
- **Test first:** a Rust `for i in 0..n { for j in 0..n { … } }` sample classifies as `O(n²)`.
- **Done when:** Rust loop/recursion forms are recognised, or — if the heuristic proves
  language-agnostic on inspection — the task is closed as `dropped` with that finding recorded
  in the ledger. **Verify before writing; do not add a Rust branch to a matcher that never
  needed one.**
- **Gate:** full gate.

### T6 — Documentation

- **Owns:** `ARTIFACT_LEETCODE_FILE_FORMAT.md`, `CLAUDE.md`
- **Depends on:** T1–T5
- **Test first:** n/a
- **Done when:** the language table lists Rust; the capability matrix shows
  `function × rust`; `CLAUDE.md`'s "adding a runnable language = four rows" section names the
  new `src/services/codegen/` layout from T0.
- **Gate:** `pnpm lint`; manual read-through against the tree.

### T7 — F5 manual pass

- **Depends on:** T1–T6
- **Click-path:** Open LeetCode Exercise → pick a `function` artifact → language selector shows
  **Rust** → Solve It → temp file opens as `.rs` with the Rust starter → write a passing
  solution → Run Tests (public suite green) → break one case → Run Tests (one red, others
  still green — proves per-case `catch_unwind`) → fix → Submit → `status: solved` +
  `<!-- meta: … -->` written, clock stopped, editor settings restored.
- **Also verify:** with `rustc` absent from `PATH`, the panel says *"Install Rust to run
  tests"* rather than failing inside a compiler.

---

## 2. Phase 2 — Libraries per exercise, per language

### Artifact format

```yaml
libs:
  javascript: ["lodash@4.17.21"]
  python:     ["numpy"]
  rust:       ["serde_json@1"]
```

Optional; absent means today's behaviour exactly. Keyed by canonical `languageId`, so an
exercise solvable in three languages declares three dependency sets and a run installs only
the selected language's.

### ⚠️ Security — the reason this phase is not a one-liner

Library names come from a `.md` file, which `CLAUDE.md` classes as **untrusted input**. This is
the first point where user data reaches a subprocess as anything other than file contents.

1. **Argv array, never a command string.** `EmittedProgram.install` is
   `{ cmd: string; args: string[] }` and the runner executes it with `execFile`, not `exec`.
   `CLAUDE.md`'s standing rule — *"if a path ever must enter a command, switch that call to an
   argument array rather than escaping"* — is now mandatory, not hypothetical.
2. **Allowlist before that.** Every declared name must match
   `^@?[a-zA-Z0-9][a-zA-Z0-9._/-]*(@[a-zA-Z0-9.^~*+-]+)?$`. Anything else is rejected at parse
   time with a user-facing message. Defence in depth: argv already neuters shell metacharacters;
   the allowlist also stops `--flag`-shaped names and path traversal.
3. **No flag injection.** A name starting with `-` is rejected by the allowlist; the install
   argv additionally terminates options with `--` before the package list where the tool
   supports it.

### T8 — Parse and type the `libs:` block

- **Owns:** `src/types/leetcode.types.ts` (`LibSpec`, `ParsedLeetCode.libs`),
  `src/services/leetcode-parser.helpers.ts`, `test/leetcode-parser.test.ts`
- **Depends on:** Phase 1 complete
- **Test first:** parsing a `libs:` block yields `{ javascript: ['lodash@4.17.21'] }`; a
  malformed block degrades to `{}` and never throws.
- **Done when:** `libs` is on `ParsedLeetCode`, defaults to `{}`, and unknown language keys are
  dropped with a parse warning rather than a crash.
- **Gate:** full gate.

### T9 — Library-name allowlist

- **Owns:** `src/services/lib-spec.helpers.ts`, `test/lib-spec.test.ts`
- **Depends on:** T8
- **Test first:** `validateLibNames(['lodash@4', '--target=/etc'])` returns a rejection naming
  the second entry. Cover `;rm -rf /`, `../../etc/passwd`, `-rf`, and an empty string.
- **Done when:** pure, `vscode`-free, exported, and the parser calls it.
- **Gate:** full gate + `sonar-analyze` on the new file (security hotspot expected here —
  it must come back clean).

### T10 — Install step in the emit contract and runner

- **Owns:** `src/services/test-envs/env.types.ts`, `src/services/leetcode-runner.service.ts`,
  `test/leetcode-runner.test.ts`
- **Depends on:** T9
- **Test first:** an env returning `install` has it executed **before** `compile`; a failing
  install fills every case with `install error: …`, exactly as a compile error does today.
- **Done when:** `EmittedProgram.install?: { cmd: string; args: string[] }`; run via
  `execFile` with `cwd` = temp dir and its **own** budget (installs are slow — a 120 s install
  ceiling, separate from the suite's `cases × timeoutMs`, so a big `numpy` download does not
  consume the grading budget).
- **Gate:** full gate.

### T11 — Library cache

- **Owns:** `src/services/lib-cache.service.ts`, `test/lib-cache.test.ts`
- **Depends on:** T10
- **Test first:** the cache key is a SHA-256 of `langId` + the **sorted** package list, so
  ordering in the `.md` cannot produce a second cache entry for the same dependency set.
- **Done when:** installs land under `globalStorageUri/libcache/<key>/` and are reused across
  runs; a cache hit skips the install entirely.
- **Gate:** full gate.
- **`ponytail:` ceiling:** no eviction, ever. Upgrade path: LRU by access time once the
  directory is measurably large. Do not build it now.

### T12 — JavaScript libraries

- **Owns:** `src/services/test-envs/function/javascript.env.ts`,
  `test/function-env-javascript.test.ts`
- **Depends on:** T11
- **Test first:** a candidate calling `require('lodash')` resolves inside the `vm` sandbox.
- **Done when:** install is `npm install --no-save --prefix .` and the sandbox is given a
  `require` built with `module.createRequire()` rooted at the temp dir. **This is the sharp
  edge of the phase** — the current env deliberately runs the candidate in a bare `vm` context
  with no `require` at all, so this widens the sandbox. Widen it to `require` only; do not hand
  the sandbox `process`, `fs`, or `child_process`.
- **Gate:** full gate + F5.

### T13 — Python libraries

- **Owns:** `src/services/test-envs/function/python.env.ts`, `test/function-env-python.test.ts`
- **Depends on:** T11
- **Test first:** the emitted `runner.py` prepends `_libs` to `sys.path`.
- **Done when:** install is `pip install --target _libs`, into a subdirectory so the install
  never collides with `sol.py` or `runner.py`.
- **Gate:** full gate + F5.

### T14 — Rust libraries (Cargo path)

- **Owns:** `src/services/test-envs/function/rust.env.ts`, `test/function-env-rust.test.ts`
- **Depends on:** T11, Phase 1 T4
- **Test first:** with no `libs.rust`, `emit` still returns the bare `rustc` shape from T4
  **unchanged**; with libs, it returns a `Cargo.toml` + `src/main.rs` + `src/solution.rs`
  layout and `cargo build`/`cargo run`.
- **Done when:** both paths pass; the bare path's golden assertions are untouched.
- **Gate:** full gate + F5.
- **Note:** this is the point where Rust can adopt `serde_json` and retire the `{:?}` Debug
  ceiling from Phase 1 T4 — **for library-backed exercises only.** The bare path keeps Debug
  formatting because it still has no dependency to spend.

### T15 — Java libraries: explicit non-support

- **Owns:** `src/services/test-envs/function/java.env.ts`, `test/function-env-java.test.ts`
- **Depends on:** T8
- **Test first:** `validate` on an artifact declaring `libs.java` returns *"Library-backed Java
  exercises are not supported yet — remove `libs.java` or solve this in another language."*
- **Done when:** the message reaches the panel through the existing contract-violation path,
  so no file is written and nothing runs.
- **Gate:** full gate.

### T16 — Panel: declared libraries

- **Owns:** `src/ui/panels/leetcodePreview.panel.ts`, `src/ui/leetcode-preview.css`
- **Depends on:** T8
- **Test first:** n/a (`vscode`-coupled). Any pure rendering helper extracted here **is** unit
  tested.
- **Done when:** the selected language's libraries render as chips near the test-count line,
  every value through `escHtml`.
- **F5 click-path:** open a `libs:`-bearing artifact → chips show for the selected language →
  switch language → chips swap → select a language with no libs → no empty chip row.

### T17 — Documentation

- **Owns:** `ARTIFACT_LEETCODE_FILE_FORMAT.md`, `CLAUDE.md`
- **Depends on:** T8–T16
- **Done when:** `libs:` is specified with its allowlist rule; `CLAUDE.md`'s "No runtime
  dependencies" paragraph is rewritten per §0; the install step appears in the runner section.

---

## 3. Phase 3 — Multi-file / multi-language exercises (contract only)

**Goal:** an exercise opens N editor tabs — `App.tsx` + `styles.css`, or `main.py` +
`schema.sql` — and grades the whole directory.

### Format

A `## Files` section; each fence's info-string carries a path and a role.

````markdown
## Files

```tsx path=src/App.tsx role=editable
export default function App() { /* solution here */ }
```

```css path=src/styles.css role=editable
```

```json path=package.json role=hidden
{ "name": "exercise" }
```
````

Roles: `editable` (written, opened in a tab) · `readonly` (written, opened, restricted) ·
`hidden` (written, never opened — scaffolding the solver should not see).

### Types

```ts
type FileRole = 'editable' | 'readonly' | 'hidden';

interface ExerciseFile {
  /** POSIX-relative path inside the run directory. Never absolute, never `..`. */
  path: string;
  /** Canonical languageId, resolved from the fence info-string. */
  langId: string;
  role: FileRole;
  content: string;
}
```

### Seams that move

| Seam | Today | Becomes |
|---|---|---|
| `EnvContext` | `code: string` | `files: ExerciseFile[]`, with `code` kept as a derived getter so the four `function` envs need **no** change |
| `ChallengeSession` | one `tempFile: Uri` | `runDir: Uri` + `files: ExerciseFile[]` |
| Solve It | write one file, open one editor | write the tree, open every non-`hidden` file |
| Submit | read the live buffer | read every `editable` buffer, falling back to disk |
| `discardChallenge` | delete one file | delete the run directory |
| Test type | — | new `project` id in `TEST_TYPES` |

### Security

Path traversal is the whole risk surface. Every `path` is normalised and asserted to stay
inside `runDir` **before** any write; absolute paths, `..` segments, and symlink targets are
rejected at parse time. `CLAUDE.md` already forbids joining a raw user string into a path —
this is that rule with a new, larger attack surface.

### Open questions to settle before task breakdown

1. Does `buildExecutable`'s candidate normalisation still apply, or is it `function`-only?
   (Current read: `function`-only — a `project` env grades a tree and never needs a bare
   declaration.)
2. Does Run Tests read every dirty buffer, or save-then-grade-from-disk? Reading buffers is
   truer to the current model; saving is far simpler with N tabs.
3. Does PracticeMode need per-file scope? (Current read: no — it is global scope already.)

---

## 4. Phase 4 — Running servers (contract only)

**Goal:** the exercise is a frontend consuming an API. The extension boots the backend, learns
its URL, and injects that URL into the frontend's config as a `hidden` file. The solver sees
the endpoint contract and the consumer code — never the wiring.

### Format

```yaml
test:
  type: service
services:
  - name: api
    dir: server
    install: ["npm", "ci"]
    start:   ["npm", "run", "dev"]
    readyRegex: "listening on (https?://\\S+)"
    exposeAs: API_URL
  - name: web
    dir: client
    install: ["npm", "ci"]
    start:   ["npm", "run", "dev"]
    readyRegex: "ready on (https?://\\S+)"
    dependsOn: [api]
```

- `install` / `start` are **argv arrays** from the first line written — never strings. Same
  rule as Phase 2 T9, and the allowlist applies to `argv[0]`.
- `readyRegex` capture group 1 is the URL. **Never assume a port** — let the framework choose
  and read back what it chose. A hardcoded port collides with whatever the user is already
  running.
- `exposeAs` names the variable written into every dependent service's generated env file
  (`.env.local` for Node, `.env` for Python), emitted as a `hidden` file per Phase 3.
- `dependsOn` orders the boot. A cycle is a parse error.

### Lifecycle

Boot in dependency order → wait for `readyRegex` or a per-service ready timeout → write the
dependents' env files → run the grading driver → **tear everything down**.

Teardown must fire on: successful Submit, failed Submit, End Challenge, panel dispose,
`deactivate()`, and extension-host crash-restart. This is the phase's real difficulty — an
orphaned dev server holding a port outlives the window that spawned it. Kill the **process
group**, not the pid; a Node dev server forks children that survive a pid-level kill.

### Grading

`fetch`-based assertions against the captured URLs from a generated Node driver. **No headless
browser** — Playwright is a ~300 MB install the extension has no path to provide, and the
zero-install-of-*extension*-dependencies rule still holds. Real DOM assertions are a later
phase with its own decision, not a footnote in this one.

### Open questions to settle before task breakdown

1. Where does the install budget live? A cold `npm ci` on Next.js is minutes, far beyond any
   grading timeout. Likely a separate "preparing exercise" phase in the panel with its own
   progress reporting and its own cancellation.
2. Do services share the Phase 2 lib cache, or does `node_modules` per exercise get its own?
3. What does the timer do while a server boots? Grading time is not solving time — the clock
   almost certainly must pause, which the current `LeetCodeTimer` cannot do.
4. Ready-detection fallback when `readyRegex` never matches: fail with the captured stdout, or
   poll the URL? (Current read: fail loudly with stdout — a silent poll hides misconfiguration.)

---

## 5. Waves and dispatch

Every wave: dispatch → wait for all → run the gate → update `progress.md` → dispatch the next.
Tasks within a wave own **disjoint** files. Registry and shared-table edits are **orchestrator
only** — that is what T0 and T1 are.

| Wave | Tasks | Agents | Note |
|---|---|---|---|
| 0 | T0 | orchestrator | Codegen split. Golden net must pass untouched. |
| 1 | T1 | orchestrator | Widen `LangId`; `tsc` green before any fan-out. |
| 2 | T2 · T3 · T5 | 3 × sonnet | Disjoint only because T0 happened. |
| 3 | T4 | 1 × sonnet | Needs T2's literals. |
| 4 | T6 · T7 | 1 × sonnet + human | Docs, then F5. |
| 5 | T8 · T9 | 2 × sonnet | Phase 2 opens. |
| 6 | T10 · T11 | 2 × sonnet | Contract, then cache. |
| 7 | T12 · T13 · T14 · T15 | 4 × sonnet | One env each — naturally disjoint. |
| 8 | T16 · T17 | 1 × sonnet + human | Panel, docs, F5. |

**Every agent, every wave:** `caveman` · `ponytail` · `mastering-typescript` · `sonar-analyze`.
Order inside a task: design types → failing test → smallest implementation → Sonar → gate →
report.

### Gate

```bash
rm -rf dist && pnpm compile && pnpm lint && \
  node node_modules/.pnpm/mocha@*/node_modules/mocha/bin/mocha.js --ui tdd "dist/test/**/*.test.js"
```

`rm -rf dist` is required — `tsc` leaves orphaned `dist/*.js`, and a stale compiled test
inflates the count. Baseline at branch point: **509 passing**. Record the count in the ledger
on every run; a drop is a blocker until explained.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Widening `LangId` breaks `Record<LangId, …>` in files this plan did not name | T1 is serial and its done-condition is `tsc --noEmit` clean — the compiler enumerates them, not this document |
| Rust `{:?}` output is not valid JSON for some return shape | Ceiling documented at the emit site; structs/enums are out of scope until serde arrives in T14 |
| `npm install` inside a test run is slow enough to feel broken | T11 cache + T10's separate install budget + panel progress |
| Widening the JS `vm` sandbox with `require` re-opens escape paths | T12 grants `require` **only**; no `process`, `fs`, or `child_process`. `sonar-analyze` on that diff specifically |
| Phase 3/4 contracts drift from what Phases 1–2 actually build | Contracts are re-read and amended before their task breakdown — they are a starting position, not a commitment |
| Orphaned dev servers survive teardown (Phase 4) | Kill the process group; teardown wired to all six exit paths listed in §4 |
| Plan documents leak into `develop`/`main` | `git rm -r docs` is the final commit before the PR; it is on the PR checklist in `progress.md` |

---

## 7. PR checklist

- [ ] Gate green, test count recorded and up
- [ ] `npx tsc --noEmit` clean
- [ ] `sonar-analyze` clean on every non-trivial diff
- [ ] F5 manual pass done for every `vscode`-coupled task
- [ ] `ARTIFACT_LEETCODE_FILE_FORMAT.md` updated in the same change as any format change
- [ ] `CLAUDE.md` invariants from §0 rewritten
- [ ] Jira tickets created from `jira-tickets.md`, keys filled in
- [ ] Anything worth keeping promoted out of `docs/` into `CLAUDE.md` / the format spec / JSDoc
- [ ] **`git rm -r docs` committed — the PR diff contains no `docs/` path**
