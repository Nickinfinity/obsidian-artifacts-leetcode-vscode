# Jira tickets — Rust, Multi-Library, Multi-File, Running Servers

Plan: [plan.md](plan.md) · Ledger: [progress.md](progress.md)

> **The Atlassian connector is not authorized in this session, so nothing below has been
> created.** This file is the deliverable: ready-to-create specs, in creation order. Authorize
> the connector (claude.ai connector settings, or `/mcp` in an interactive session), then they
> get created in one pass and the `<KEY>` placeholders are filled in here.
>
> **Never fabricate a ticket key.** A `<KEY>` placeholder is correct until the ticket exists.

Existing context: extension epic **VSX-35**, migration stories **VSX-64…68**. The four epics
below link to VSX-35 with `Relates to` — Jira has no native epic nesting without Advanced
Roadmaps, so parenthood is expressed as a link, not a hierarchy.

Estimates are story points on a Fibonacci scale, sized against this repo's own history: the
services DRY refactor (467 → 509 tests) was roughly a 13.

---

## Epic 1 — Rust as a runnable language

| Field | Value |
|---|---|
| Type | Epic |
| Key | `<EPIC-1>` |
| Summary | Rust support for `test.type: function` exercises |
| Links | Relates to VSX-35 |
| Estimate | 13 |

**Description**

Add Rust as the fourth runnable language: solvers select Rust in the preview panel, get a Rust
starter file, and run the public and final suites against a local `rustc`. Rust is already
type-mappable (`PRIMITIVES`, `TYPE_SYNTAX`) and already resolves as a fence alias — it is not
runnable because it has no `LangId` membership, no `LANG_CODEGEN` row, no test environment, and
no `jsonToLiteral` branch.

**Acceptance criteria**

- `languagesForType('function')` returns `['java', 'javascript', 'python', 'rust']`.
- A solver completes Solve It → Run Tests → Submit in Rust end to end.
- A failing case fails **alone**; the rest of the suite still reports.
- With `rustc` absent from `PATH`, the panel says *"Install Rust to run tests"* rather than
  failing inside a compiler.
- Gate green with a strictly higher test count than the 509 baseline.

---

### `<KEY>` — Extract per-language codegen into sibling modules

| Field | Value |
|---|---|
| Type | Story · Parent `<EPIC-1>` · Points 3 |

**Description**

`leetcode-codegen.service.ts` is 355 lines holding two dispatch tables and six per-language
template functions. Rust's boilerplate and harness push it past the 500-line split threshold in
`CLAUDE.md`, and — more immediately — force two otherwise-parallel tasks to contend for one
file. Extract `java` / `python` / `javascript` templates into `src/services/codegen/*.codegen.ts`,
leaving the service holding the tables and the shared `mapType` / `jsonToLiteral` /
`injectSolution` logic.

**Acceptance criteria**

- Behaviour-preserving: `test/leetcode-codegen-golden.test.ts` passes **byte-identical and
  unmodified**. Editing a golden assertion during this story invalidates it.
- Test count unchanged.
- Gate green.

---

### `<KEY>` — Register `rust` in the language registry

| Field | Value |
|---|---|
| Type | Story · Parent `<EPIC-1>` · Points 2 |

**Description**

Add `'rust'` to `LangId` and a `LANGUAGES.rust` entry (`displayName: 'Rust'`, `fileExt: 'rs'`,
`commentPrefix: '//'`, `detectCmd: 'rustc --version'`, `aliases: ['rs']`). Widening the union
breaks every `Record<LangId, …>` at once; fix each break minimally. Do not work from a list of
expected break sites — `tsc` enumerates them.

**Acceptance criteria**

- `npx tsc --noEmit` clean.
- The existing language-consistency test covers Rust automatically (`fileExt === LANG_EXT.rust`,
  every alias present in `LANG_ALIAS`). If it does not, that is a bug in the consistency test
  and is fixed in this story.
- Gate green.

---

### `<KEY>` — Rust literals in `jsonToLiteral`

| Field | Value |
|---|---|
| Type | Story · Parent `<EPIC-1>` · Points 3 |

**Description**

`jsonToLiteral` has no Rust branch, so an array argument emits `[1, 2]` — a fixed-size
`[i32; 2]`, not the `Vec<i32>` that `TYPE_SYNTAX` promises the solver's signature will take. Add
Rust emission for arrays, strings, and objects.

**Acceptance criteria**

- Arrays → `vec![…]`, nested arrays → `vec![vec![1, 2]]`.
- Strings → `String::from("…")`; objects → `HashMap::from([(String::from("k"), v), …])`.
- Numbers, booleans, and `null` → unchanged / `None`.
- Two known ceilings carry `ponytail:` comments naming the upgrade path: empty `vec![]` cannot
  type-infer standalone, and a `&str` parameter fails at compile rather than at `validate`.
- Gate green.

---

### `<KEY>` — Rust codegen row (boilerplate + harness)

| Field | Value |
|---|---|
| Type | Story · Parent `<EPIC-1>` · Points 3 |

**Description**

Add `src/services/codegen/rust.codegen.ts` and its `LANG_CODEGEN.rust` row: a runnable stdin
wrapper carrying `<<SOLUTION>>`, and an `assert_eq!`-based harness over the parsed cases.

**Acceptance criteria**

- `generateBoilerplate(parsed, 'rust')` contains `fn <name>(`, the `mapType`-derived signature,
  and exactly one `SOLUTION_MARKER`.
- Golden cases are **added**; existing golden assertions are untouched.
- Gate green, test count up.

---

### `<KEY>` — `function × rust` test environment

| Field | Value |
|---|---|
| Type | Story · Parent `<EPIC-1>` · Points 5 |

**Description**

Build the Rust function environment via `makeFunctionEnv` and register it. The candidate is
written **verbatim** as `solution.rs`; a generated `runner.rs` declares `mod solution;` so
`rustc` links it as a second compilation unit — the same non-splicing model Java uses.

Design decisions (settled; do not re-litigate):

- `compile: 'rustc -O runner.rs -o runner'`, `run: './runner'`.
- `candidateContent` rewrites a leading `fn <name>` → `pub fn <name>` with one anchored regex.
  Module items need `pub`; demanding it from the solver is a hostile contract for a detail the
  driver invented.
- `validate` rejects a candidate with no top-level `fn <name>(`, with a message shaped like the
  Python env's.
- Serialization is `{:?}` Debug formatting — **no serde**, since the bare path has no
  dependency to spend. Integers, floats, `bool`, `String`, `Vec`, nested `Vec`, and
  `HashMap<String, _>` all Debug-print as valid JSON, and `canonicalJson` sorts `HashMap`'s
  random key order extension-side.
- Per-case isolation via `panic::catch_unwind(AssertUnwindSafe(…))`, message recovered by
  downcasting the payload; a no-op `panic::set_hook` suppresses the default banner.
- `io::stdout().flush()` after every sentinel line — Rust block-buffers a piped stdout and a
  timeout-kill would discard lines already produced.

**Acceptance criteria**

- `emit` returns `['solution.rs', 'runner.rs']` with the commands above.
- `languagesForType('function')` includes `'rust'`.
- A panicking case reports `error` for itself only; sibling cases still report.
- The `{:?}` ceiling (no structs, no enums) carries a `ponytail:` comment naming serde as the
  upgrade path.
- Gate green **plus** an end-to-end two-case Rust run via F5.

---

### `<KEY>` — Big-O heuristic: Rust loop and recursion patterns

| Field | Value |
|---|---|
| Type | Story · Parent `<EPIC-1>` · Points 2 |

**Description**

Teach the complexity heuristic Rust's loop forms (`for i in 0..n`) so a Rust submission gets the
same estimate a Java one does.

**Acceptance criteria**

- A nested `for i in 0..n { for j in 0..n { … } }` sample classifies as `O(n²)`.
- **Or** the story closes as *Won't Do* with the finding that the heuristic is already
  language-agnostic, recorded in the ledger. Verify against the tree before writing a Rust
  branch to a matcher that never needed one.

---

### `<KEY>` — Document Rust support

| Field | Value |
|---|---|
| Type | Story · Parent `<EPIC-1>` · Points 1 |

**Description**

Update `ARTIFACT_LEETCODE_FILE_FORMAT.md` (language table, capability matrix) and `CLAUDE.md`
("adding a runnable language = four rows" must name the new `src/services/codegen/` layout).

**Acceptance criteria**

- The format spec lists Rust and `function × rust`.
- `CLAUDE.md`'s folder-structure and codegen sections match the post-extraction tree.
- Doc and parser agree; where they cannot, the parser wins and the doc is corrected.

---

## Epic 2 — Libraries per exercise, per language

| Field | Value |
|---|---|
| Type | Epic |
| Key | `<EPIC-2>` |
| Summary | Per-exercise, per-language library dependencies |
| Links | Relates to VSX-35, depends on `<EPIC-1>` |
| Estimate | 21 |

**Description**

Let an exercise declare libraries per language (`libs.javascript: ["lodash@4"]`) and install
them into the run's temp directory using the user's local toolchain before the suite compiles.

**This changes a documented invariant.** "No runtime dependencies" stays true of the extension —
it still ships none — but is no longer true of a run. `CLAUDE.md` must be rewritten in the same
change, not after.

**Acceptance criteria**

- A `libs:`-bearing exercise runs green in JavaScript, Python, and Rust.
- Library names are validated against an allowlist **and** passed as an argv array — never
  interpolated into a command string.
- A second run of the same dependency set skips the install (cache hit).
- `libs.java` reports explicit non-support instead of failing obscurely.
- Gate green; `sonar-analyze` clean, with no security hotspot outstanding on the install path.

---

### `<KEY>` — Parse and type the `libs:` frontmatter block

| Field | Value |
|---|---|
| Type | Story · Parent `<EPIC-2>` · Points 3 |

**Acceptance criteria**

- `ParsedLeetCode.libs` defaults to `{}`; a `libs:` block parses to
  `{ javascript: ['lodash@4.17.21'] }`.
- Malformed input degrades to `{}` and never throws — `.md` artifacts are untrusted input.
- Unknown language keys are dropped with a parse warning, not a crash.
- `ARTIFACT_LEETCODE_FILE_FORMAT.md` updated in the same change.

---

### `<KEY>` — Library-name allowlist (security)

| Field | Value |
|---|---|
| Type | Story · Parent `<EPIC-2>` · Points 3 · **Security** |

**Description**

Library names come from an untrusted `.md` file and are the first user data in this codebase to
reach a subprocess as anything other than file contents. Validate every declared name against
`^@?[a-zA-Z0-9][a-zA-Z0-9._/-]*(@[a-zA-Z0-9.^~*+-]+)?$` at parse time.

Defence in depth: the argv array (next story) already neuters shell metacharacters; the
allowlist additionally stops `--flag`-shaped names and path traversal.

**Acceptance criteria**

- Pure, `vscode`-free, unit-tested. Rejections name the offending entry.
- Covered hostile inputs at minimum: `;rm -rf /`, `../../etc/passwd`, `-rf`, `--target=/etc`,
  the empty string.
- `sonar-analyze` returns clean on the new file.

---

### `<KEY>` — Install step in the emit contract and runner

| Field | Value |
|---|---|
| Type | Story · Parent `<EPIC-2>` · Points 5 |

**Description**

Add `EmittedProgram.install?: { cmd: string; args: string[] }`, executed before `compile` with
`cwd` = temp dir. Run it with `execFile`, **not** `exec` — `CLAUDE.md`'s standing rule that user
data entering a command switches that call to an argument array is now mandatory rather than
hypothetical.

**Acceptance criteria**

- `install` runs before `compile`; a failing install fills every case with `install error: …`,
  exactly as a compile error does today.
- The install carries its own ~120 s budget, separate from the suite's `cases × timeoutMs`, so a
  large download does not consume the grading budget.
- Gate green.

---

### `<KEY>` — Library cache under global storage

| Field | Value |
|---|---|
| Type | Story · Parent `<EPIC-2>` · Points 3 |

**Acceptance criteria**

- Cache key is a SHA-256 of `langId` + the **sorted** package list, so ordering in the `.md`
  cannot mint a second entry for the same dependency set.
- Installs land under `globalStorageUri/libcache/<key>/` and are reused across runs; a hit skips
  the install entirely.
- The no-eviction ceiling carries a `ponytail:` comment naming LRU-by-access-time as the upgrade
  path.

---

### `<KEY>` — JavaScript libraries

| Field | Value |
|---|---|
| Type | Story · Parent `<EPIC-2>` · Points 5 · **Security-sensitive** |

**Description**

Install with `npm install --no-save --prefix .` and give the `vm` sandbox a `require` built from
`module.createRequire()` rooted at the temp dir.

This is the sharp edge of the epic: the current environment deliberately runs the candidate in a
bare `vm` context with **no** `require` at all, so this widens the sandbox.

**Acceptance criteria**

- A candidate calling `require('lodash')` resolves inside the sandbox.
- The sandbox gains `require` **only** — no `process`, no `fs`, no `child_process`.
- `sonar-analyze` run specifically on this diff, clean.
- F5 verified.

---

### `<KEY>` — Python libraries

| Field | Value |
|---|---|
| Type | Story · Parent `<EPIC-2>` · Points 3 |

**Acceptance criteria**

- Install is `pip install --target _libs` — a subdirectory, so it never collides with `sol.py`
  or `runner.py`.
- The emitted `runner.py` prepends `_libs` to `sys.path`.
- F5 verified with a `numpy` exercise.

---

### `<KEY>` — Rust libraries via a Cargo path

| Field | Value |
|---|---|
| Type | Story · Parent `<EPIC-2>` · Points 5 |

**Description**

With no `libs.rust`, the environment keeps the bare `rustc` shape. With libs, it emits a
`Cargo.toml` + `src/main.rs` + `src/solution.rs` layout and builds with `cargo`.

**Acceptance criteria**

- The bare path's emit output is **byte-identical** to Epic 1's; its golden assertions are
  untouched.
- The Cargo path builds and runs a `serde_json`-using exercise.
- Library-backed Rust exercises may retire the `{:?}` Debug ceiling in favour of `serde_json`;
  the bare path keeps Debug formatting, because it still has no dependency to spend.

---

### `<KEY>` — Java libraries: explicit non-support

| Field | Value |
|---|---|
| Type | Story · Parent `<EPIC-2>` · Points 1 |

**Description**

There is no install path for Java without Maven or Gradle. Fail honestly rather than obscurely —
the same self-explaining failure this codebase already gives a reserved `test.type`.

**Acceptance criteria**

- `validate` on an artifact declaring `libs.java` returns *"Library-backed Java exercises are not
  supported yet — remove `libs.java` or solve this in another language."*
- The message reaches the panel through the existing contract-violation path, so no file is
  written and nothing runs.

---

### `<KEY>` — Panel: show declared libraries

| Field | Value |
|---|---|
| Type | Story · Parent `<EPIC-2>` · Points 2 |

**Acceptance criteria**

- The selected language's libraries render as chips near the test-count line; switching language
  swaps them; a language with no libs renders no empty chip row.
- Every interpolated value goes through `escHtml`.
- Any pure rendering helper extracted here is unit-tested; the `vscode` layer stays a thin wire.
- F5 verified.

---

### `<KEY>` — Document library support

| Field | Value |
|---|---|
| Type | Story · Parent `<EPIC-2>` · Points 2 |

**Acceptance criteria**

- `ARTIFACT_LEETCODE_FILE_FORMAT.md` specifies `libs:` including the allowlist rule.
- `CLAUDE.md`'s "No runtime dependencies" paragraph is rewritten: *the extension ships zero
  dependencies; an exercise may declare its own, installed into the run's temp directory using
  the user's local toolchain.*
- The runner section documents the install step and its separate budget.

---

## Epic 3 — Multi-file / multi-language exercises

| Field | Value |
|---|---|
| Type | Epic |
| Key | `<EPIC-3>` |
| Summary | Exercises spanning multiple files and languages |
| Links | Relates to VSX-35, depends on `<EPIC-2>` |
| Estimate | 21 (spike-first) |

**Description**

An exercise opens N editor tabs — `App.tsx` + `styles.css`, or `main.py` + `schema.sql` — and
grades the whole directory. Contract designed in plan §3: a `## Files` section with
`path=` / `role=` fence attributes, an `ExerciseFile` type, `EnvContext.code` widened to
`files` (with `code` kept as a derived getter so the four `function` environments need no
change), and `ChallengeSession` moving from one temp file to a run directory.

**Not yet broken into stories** — deliberately. Three questions must be answered against the
real tree first, and answering them from today's tree would be guessing.

---

### `<KEY>` — Spike: settle the multi-file contract

| Field | Value |
|---|---|
| Type | Spike · Parent `<EPIC-3>` · Points 5 |

**Questions to answer**

1. Does `buildExecutable`'s candidate normalisation stay `function`-only? (Current read: yes — a
   `project` environment grades a tree and never needs a bare declaration.)
2. Does Run Tests read every dirty buffer, or save-then-grade-from-disk? Reading buffers is truer
   to today's model; saving is far simpler across N tabs.
3. Does PracticeMode need per-file scope? (Current read: no — it already writes at global scope.)

**Output:** plan §3 amended, then stories cut from it.

**Security note carried into every story that follows:** path traversal is the whole risk
surface. Every declared `path` is normalised and asserted to stay inside the run directory
**before** any write; absolute paths, `..` segments, and symlink targets are rejected at parse
time.

---

## Epic 4 — Running servers

| Field | Value |
|---|---|
| Type | Epic |
| Key | `<EPIC-4>` |
| Summary | Boot backend services and inject their URLs into the frontend |
| Links | Relates to VSX-35, depends on `<EPIC-3>` |
| Estimate | 34 (spike-first) |

**Description**

The exercise is a frontend consuming an API. The extension boots the backend, learns its URL
from its own stdout, and injects that URL into the frontend's config as a `hidden` file. The
solver sees the endpoint contract and the consumer code — never the wiring.

Contract designed in plan §4: a `services:` block with argv-array `install` / `start`, a
`readyRegex` whose first capture group is the URL, `exposeAs` naming the injected variable, and
`dependsOn` ordering the boot.

**Two decisions already taken:**

- **Never assume a port.** Let the framework choose and read back what it chose — a hardcoded
  port collides with whatever the user is already running.
- **No headless browser.** Grading is `fetch`-based assertions from a generated Node driver.
  Playwright is a ~300 MB install the extension has no path to provide. Real DOM assertions are
  a later epic with their own decision.

---

### `<KEY>` — Spike: settle the service-lifecycle contract

| Field | Value |
|---|---|
| Type | Spike · Parent `<EPIC-4>` · Points 8 |

**Questions to answer**

1. Where does the install budget live? A cold `npm ci` on Next.js is minutes, far beyond any
   grading timeout — likely a separate "preparing exercise" phase with its own progress
   reporting and cancellation.
2. Do services share the Epic 2 library cache, or does `node_modules` per exercise get its own?
3. What does the timer do while a server boots? Grading time is not solving time, so the clock
   almost certainly must pause — which `LeetCodeTimer` cannot currently do.
4. Ready-detection fallback when `readyRegex` never matches: fail with captured stdout, or poll
   the URL? (Current read: fail loudly — a silent poll hides misconfiguration.)

**Output:** plan §4 amended, then stories cut from it.

---

### `<KEY>` — Teardown guarantee (carry into every Epic 4 story)

| Field | Value |
|---|---|
| Type | Story · Parent `<EPIC-4>` · Points 5 |

**Description**

The hardest part of this epic is not booting a server — it is making sure one never survives the
window that spawned it.

**Acceptance criteria**

- Teardown fires on **all six** exit paths: successful Submit, failed Submit, End Challenge,
  panel dispose, `deactivate()`, and extension-host crash-restart.
- The **process group** is killed, not the pid — a Node dev server forks children that survive a
  pid-level kill.
- Verified manually: no orphaned process holds a port after each of the six paths.

---

## Creation order

Epics first (they are the parents), then stories in the order listed above — which is also
dependency order.

1. `<EPIC-1>` → its seven stories
2. `<EPIC-2>` → its ten stories
3. `<EPIC-3>` → its spike
4. `<EPIC-4>` → its spike + the teardown story

Fill each `<KEY>` in this file as it is created, and add the key to the matching row in
[progress.md](progress.md).
