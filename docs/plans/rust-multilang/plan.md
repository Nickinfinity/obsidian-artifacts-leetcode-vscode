# Plan — Rust, TypeScript, Multi-Library, Multi-File, Running Servers

Epic: **[VSX-122](https://dexsys.atlassian.net/browse/VSX-122)** · Branch: `feature/VSX-122_multilib-multilang-support`
Process: [CREATING_A_PLAN.md](../../../CREATING_A_PLAN.md) · Ledger: [progress.md](progress.md) ·
Tickets: [jira-tickets.md](jira-tickets.md)

**Depth (agreed):** Phases 1–2 are task-level and agent-ready. Phases 3–4 are **contract-only** —
types, `.md` format, and service seams are designed; task breakdown waits until 1–2 land and the
real constraints are known. Planning phase 4 tasks today would be planning against fiction.

---

## 0. What this feature is

| # | Capability | Disturbance |
|---|---|---|
| 1 | **Rust** and **TypeScript** as runnable languages for `test.type: function` | None — the registry was built for this |
| 2 | **Libraries** per exercise, per language (lodash, numpy, serde_json) | Adds an install step to `EmittedProgram`; first user data reaching a subprocess argv |
| 3 | **Multi-file / multi-language** exercises (`.tsx` + `.css` + `.py`) | Breaks the one-temp-file challenge model and `EnvContext.code` |
| 4 | **Running servers** — boot a backend, inject its URL into the frontend invisibly | Breaks the zero-runtime-dependency invariant; adds process lifecycle |

### Invariants this feature deliberately changes

Both are load-bearing statements in `CLAUDE.md`. Rewrite them **in the same change that breaks
them**, not after.

1. **"No runtime dependencies."** Still true of the *extension* — it ships none. No longer true
   of a *run*: from Phase 2 a run may shell out to the user's local `npm`/`pip`/`cargo`.
   New wording: *the extension ships zero dependencies; an exercise may declare its own, which
   are installed into a cached environment using the user's local toolchain.*
2. **"One temp file per challenge."** From Phase 3 a challenge owns a temp *directory* with N
   files and N editor tabs.

### Decisions taken up front

- **Dependency policy:** shell out to the user's local toolchain. `TestEnv.requires` / `detect()`
  already model the preflight.
- **Missing-toolchain detection is the `ENOENT` from the install call itself**, not a second
  probe table. A hand-maintained probe list drifts; `ENOENT` does not. `detectCmd` stays for the
  runtime, which already exists and is already tested.
- **Docker is rejected** for Phases 1–3: it needs Docker Desktop installed and running
  (a licensing problem on corporate machines), pulls GB images, and adds seconds of cold start
  to a suite that grades in milliseconds. `test.runtime: 'local' | 'docker'` is **reserved** in
  the format for a Phase 4 exercise that genuinely needs a database or service mesh — it parses,
  validates, and explains itself, exactly like a reserved `test.type`.
- **Java libraries are out of scope** through Phase 2. Java has no *isolation* problem — the
  classpath is already per-invocation — it has a *resolution* problem, and nothing in a stock JDK
  resolves transitive dependencies. `libs.java` reports explicit non-support.

---

## 1. Environments: the shape of the library problem

Settled ahead of Phase 2 because it determines several task boundaries.

### Key by dependency set, not by exercise

```
globalStorageUri/libenvs/<langId>-<sha256(langId + sorted pkg list)>/
```

Per-exercise environments mean thirty exercises using numpy build numpy thirty times. Per-
dependency-set means they share one, and two exercises pinning `lodash@3` against `lodash@4`
hash apart automatically — **version conflict becomes structurally impossible rather than
something to handle.**

### Each language uses its own isolation primitive

"venv" is Python's fix for a problem the others do not have. `pip` installs globally by default,
so isolation must be constructed. Everywhere else it is already the default or already the
package manager's job. **Do not build a uniform abstraction over four package managers — three
of them would be wrapping a no-op.**

| Lang | Primitive | Do we build it? | Env dir holds | How a run consumes it |
|---|---|---|---|---|
| python | venv | **yes** — pip is global by default | `bin/`, `lib/site-packages/` | invoke `<env>/bin/python3` |
| javascript | `node_modules` | **no** — isolated by default | `package.json`, `package-lock.json`, `node_modules/` | `createRequire()` rooted at `<env>` |
| typescript | same as JS | no | + `typescript` when type-checking is opted into | `<env>/node_modules/.bin/tsc` |
| rust | cargo project | **no** — cargo already is one | `Cargo.toml`, `Cargo.lock`, `target/` | `cargo run --offline --manifest-path` |
| java | classpath | n/a — wrong problem | `lib/*.jar` | `-cp "<env>/lib/*"` |

- **JavaScript** — Node's resolution walks up from the requiring file looking for
  `node_modules`. That *is* the venv, and it is the default. Write a `package.json`, run
  `npm install --prefix <env>`. A lockfile falls out free, so the second install of the same set
  is deterministic instead of "whatever npm resolved today".
- **Rust** — cargo is both the venv and the cache. Downloads dedupe in `~/.cargo/registry`,
  which is **cargo's to manage and never ours to touch**. The prize is `target/`: cargo builds
  are slow, and a cache hit reusing `target/` turns a cold minute into an incremental few
  seconds. Use `--offline` after the first fetch so a hit never touches the network.
- **Java** — when someone eventually asks: generate a `pom.xml` and shell out to
  `mvn -q dependency:copy-dependencies -DoutputDirectory=<env>/lib`, gated on `mvn` being
  present. Correct transitive resolution, zero resolver code from us. **Never** hand-roll a
  Maven Central fetch — it works until the first library with transitive dependencies, at which
  point you are writing a POM resolver.

### The abstraction is smaller than "venv"

> **The cache service owns *"build and hand me a directory keyed by this dependency set."*
> Each test env owns *"what to do with that directory."***

`javascript.env.ts` knows to look in `<dir>/node_modules`; `python.env.ts` knows to invoke
`<dir>/bin/python3`; `rust.env.ts` knows to point `--manifest-path` at it. **No discriminated
union of `interpreter | resolveRoot | manifest | classpath`** — four optional fields where
exactly one is ever set is a union pretending to be a struct. One concern each.

### Garbage collection is not optional

numpy is ~60 MB; a Next.js `node_modules` ~300 MB. Ten dependency sets is gigabytes. Age **and**
size, plus an explicit command — see T18.

---

## 2. Phase 1 — Rust and TypeScript as runnable languages

Per `CLAUDE.md`, a runnable language is four rows. TypeScript is cheaper than Rust: it reuses
JavaScript's literals and containers wholesale, so it needs no `jsonToLiteral` work at all.

**Pre-existing state, verified in the tree (not assumed):**

- `PRIMITIVES` maps `int/float/string/bool` → `i32/f64/String/bool`
  ([leetcode-codegen.service.ts:8-11](../../../src/services/leetcode-codegen.service.ts#L8-L11)) ✅
- `TYPE_SYNTAX.rust` maps `Vec<T>` / `HashMap<K, V>`
  ([leetcode-codegen.service.ts:44](../../../src/services/leetcode-codegen.service.ts#L44)) ✅
- `LANG_ALIAS` already carries `rs → rust`, `ts → typescript`, `tsx → typescriptreact`;
  `LANG_EXT` already carries `rust → rs`, `typescript → ts` ✅
- `jsonToLiteral` has **no** Rust branch — arrays emit `[1, 2]`, a fixed-size `[i32; 2]`, not the
  `Vec<i32>` the type mapping promises ❌ **the real Rust gap**
- No `LANG_CODEGEN` row and no `LangId` membership for either language ❌

### T0 — Extract per-language codegen into siblings (enabling refactor)

`leetcode-codegen.service.ts` is 355 lines holding two tables *and* six template functions.
Rust plus TypeScript push it well past the 500-line split threshold, and — more immediately —
force T2, T3 and T3b to fight over one file. Extracting first is what makes the phase parallel.

- **Owns:** `src/services/codegen/{java,python,javascript}.codegen.ts`, and the deletions from
  `src/services/leetcode-codegen.service.ts`
- **Reads:** `test/leetcode-codegen-golden.test.ts`
- **Depends on:** none
- **Test first:** none — behaviour-preserving. The **golden net already exists** and must pass
  **byte-identical and unmodified**. Editing a golden assertion during this task invalidates it.
- **Done when:** the service retains only `PRIMITIVES`, `JAVA_BOX`, `TYPE_SYNTAX`,
  `LANG_CODEGEN`, `mapType`, `jsonToLiteral`, `injectSolution` and the public entry points;
  every per-language template lives in its own sibling.
- **Gate:** full gate, test count unchanged.

> **Orchestrator, serial.** Every later task reads this layout.

### T1 — Add `rust` and `typescript` to the language registry

- **Owns:** `src/types/languages.ts`, plus the minimal fix at every site the widened `LangId`
  breaks
- **Depends on:** T0
- **Test first:** `test/leetcode-languages.test.ts` — `LANGUAGES.rust.detectCmd === 'rustc
  --version'`, `LANGUAGES.typescript.detectCmd === 'node --version'`, and for both,
  `fileExt === LANG_EXT[id]` with every alias present in `LANG_ALIAS`.
- **Done when:** `npx tsc --noEmit` clean with both members in the union.
- **Gate:** full gate.

```ts
rust:       { id: 'rust',       displayName: 'Rust',       fileExt: 'rs', commentPrefix: '//', detectCmd: 'rustc --version', aliases: ['rs'] },
typescript: { id: 'typescript', displayName: 'TypeScript', fileExt: 'ts', commentPrefix: '//', detectCmd: 'node --version',  aliases: ['ts'] },
```

TypeScript's runtime probe is **`node`, not `tsc`** — see T4b: the default path never invokes a
compiler.

> **Orchestrator, serial.** Widening `LangId` breaks every `Record<LangId, …>` at once.
> `LANG_CODEGEN` is the known one; **grep for the rest rather than trusting this list.** Fan-out
> starts only after `tsc` is green. Both languages land in one step — they widen the same union,
> and splitting them means paying the same breakage twice.

### T2 — Rust literals in `jsonToLiteral`

- **Owns:** `src/services/leetcode-codegen.service.ts` (the `jsonToLiteral` family only),
  `test/leetcode-typemap.test.ts`
- **Depends on:** T1
- **Test first:** `assert.strictEqual(jsonToLiteral([1, 2], 'rust'), 'vec![1, 2]')` — fails today,
  returns `[1, 2]`.
- **Done when:** arrays → `vec![…]` (nested: `vec![vec![1, 2]]`), strings → `String::from("…")`,
  objects → `HashMap::from([(String::from("k"), v), …])`, numbers/booleans unchanged,
  `null` → `None`. **TypeScript needs no branch** — it falls through to the JavaScript path,
  which is already correct.
- **Gate:** full gate.

**Two ceilings, both `ponytail:`-commented at the emit site:**

- `[]` emits `vec![]`, which Rust cannot type-infer standalone. Upgrade path: thread the declared
  param type from `parsed.params` into the emitter. Not now — no exercise needs it, and threading
  the type touches all five languages.
- Strings emit `String::from(…)` to match `TYPE_SYNTAX`. A solver taking `&str` gets a compile
  error rather than a `validate` message; the compile error names the mismatch clearly enough.

### T3 — Rust codegen row

- **Owns:** `src/services/codegen/rust.codegen.ts`, the `LANG_CODEGEN.rust` row,
  `test/leetcode-codegen.test.ts`, new golden cases
- **Depends on:** T1
- **Test first:** `generateBoilerplate(parsed, 'rust')` contains `fn <name>(`, the
  `mapType`-derived signature, and exactly one `SOLUTION_MARKER`.
- **Done when:** boilerplate is a runnable stdin wrapper (`std::io::stdin().read_line`) carrying
  `<<SOLUTION>>`; harness is `assert_eq!`-based. Golden cases **added**, never edited.
- **Gate:** full gate, test count up.

### T3b — TypeScript type mapping and codegen row

- **Owns:** `src/services/codegen/typescript.codegen.ts`, the `LANG_CODEGEN.typescript` row, the
  `PRIMITIVES` / `TYPE_SYNTAX` TypeScript columns, `test/leetcode-typemap.test.ts` additions
- **Depends on:** T1
- **Test first:** `mapType('map<string,int>', 'typescript') === 'Record<string, number>'`.
- **Done when:** TypeScript's `PRIMITIVES` column mirrors JavaScript's (`number`/`string`/
  `boolean`), `TYPE_SYNTAX.typescript` is `{ array: i => `${i}[]`, map: (k, v) => `Record<${k},
  ${v}>` }`, and boilerplate emits a **typed** signature from `mapType` — the whole point of
  offering TypeScript over JavaScript.
- **Gate:** full gate, test count up.
- **Disjoint from T2/T3** only because T0 happened; the `PRIMITIVES`/`TYPE_SYNTAX` column edit is
  the one shared-file touch, so **the orchestrator lands that hunk** and the agent owns the rest.

### T4 — `function × rust` test environment

- **Owns:** `src/services/test-envs/function/rust.env.ts`, its registration line,
  `test/function-env-rust.test.ts`
- **Depends on:** T1, T2
- **Test first:** `emit(ctx)` returns files `['solution.rs', 'runner.rs']`,
  `compile === 'rustc -O runner.rs -o runner'`, `run === './runner'`.
- **Done when:** registered, and `languagesForType('function')` returns
  `['java', 'javascript', 'python', 'rust', 'typescript']`.
- **Gate:** full gate **plus** an end-to-end two-case Rust run via F5.

| Concern | Decision |
|---|---|
| Linking | `runner.rs` declares `mod solution;`; `rustc` pulls `./solution.rs` as a second unit. Same shape as Java — candidate written **verbatim**, never spliced. |
| Visibility | Items in a `mod` need `pub`. `candidateContent` rewrites a leading `fn <name>` → `pub fn <name>` with one anchored regex. Demanding `pub` from the solver is a hostile contract for a detail the driver invented. |
| `validate` | Reject a candidate with no top-level `fn <name>(`: *"Rust setup must define a top-level `fn <name>(…)` — not a method inside an `impl` block."* |
| Serialization | `{:?}` Debug formatting, **no serde**. Integers, floats, `bool`, `String`, `Vec`, nested `Vec` and `HashMap<String, _>` all Debug-print as valid JSON, and `canonicalJson` sorts `HashMap`'s random key order extension-side. `ponytail:` comment naming the ceiling (no structs, no enums) and serde as the upgrade path. |
| Isolation | `panic::catch_unwind(AssertUnwindSafe(…))`, message recovered by downcasting the payload. A no-op `panic::set_hook` suppresses the default banner. |
| Flushing | `io::stdout().flush()` per sentinel line — Rust block-buffers a piped stdout and a timeout-kill would discard produced lines. |

### T4b — `function × typescript` test environment

- **Owns:** `src/services/test-envs/function/typescript.env.ts`, its registration line,
  `test/function-env-typescript.test.ts`
- **Reads:** `javascript.env.ts` — this env is that env plus one call
- **Depends on:** T1, T3b
- **Test first:** `emit(ctx)` writes the candidate as `sol.ts` **verbatim**, and the generated
  runner strips types before evaluating in the `vm` sandbox.
- **Done when:** registered; a typed candidate runs green; a candidate using non-erasable syntax
  fails with the honest message rather than a parse dump.
- **Gate:** full gate + F5.

**Design — verified empirically on Node v26.5.0 before being written down:**

```js
const js = require('node:module').stripTypeScriptTypes(fs.readFileSync('sol.ts', 'utf8'));
vm.runInContext(js, ctx);   // then pull the function off the sandbox, exactly as the JS env does
```

- **`module.stripTypeScriptTypes` blanks types with spaces**, preserving line and column offsets
  — so a runtime error still points at the solver's real `.ts` line. This is why stripping beats
  transpiling for our purposes.
- **No compiler, no install, no compile step** on the default path. `detectCmd` is `node
  --version` because that is genuinely all it needs.
- **`detect()` gates the Node version** — `stripTypeScriptTypes` needs Node ≥ 22.18 / 23.10.
  Below that, say *"TypeScript exercises need Node 22.18 or newer"*. This is exactly what
  `TestEnv.detect()` was added for.
- **`validate` rejects non-erasable syntax** — `enum`, `namespace`, parameter properties,
  decorators. Type-stripping cannot express them, and the honest message beats a parse error.
- **No type checking on the default path, deliberately.** Grading is behavioural; the solver gets
  type errors live from tsserver, because the temp file has a real `.ts` extension — which
  `CLAUDE.md` already notes is load-bearing for exactly this reason. Opt-in `tsc` checking
  arrives with Phase 3, which needs a real compiler anyway for `.tsx`.
- The `ExperimentalWarning` goes to **stderr**, so it cannot corrupt sentinel parsing on stdout.

### T5 — Big-O heuristic: Rust patterns

- **Owns:** `src/services/leetcode-bigo.helpers.ts`, `test/leetcode-bigo.test.ts`
- **Depends on:** T1
- **Test first:** a Rust `for i in 0..n { for j in 0..n { … } }` sample classifies as `O(n²)`.
- **Done when:** Rust loop forms are recognised — **or** the task closes as `dropped` with the
  finding that the heuristic is already language-agnostic, recorded in the ledger. TypeScript
  needs nothing here; its loop syntax is JavaScript's. **Verify before writing.**
- **Gate:** full gate.

### T6 — Documentation

- **Owns:** `ARTIFACT_LEETCODE_FILE_FORMAT.md`, `CLAUDE.md`
- **Depends on:** T1–T5
- **Done when:** the language table lists Rust and TypeScript; the capability matrix shows both
  `function` pairs; `CLAUDE.md`'s "four rows" section names the new `src/services/codegen/`
  layout and TypeScript's Node-version gate.

### T7 — F5 manual pass

- **Depends on:** T1–T6
- **Click-path (run twice — once Rust, once TypeScript):** Open Exercise → language selector
  offers the language → Solve It → temp file opens with the right extension and a typed starter
  → passing solution → Run Tests green → break one case → Run Tests shows **one** red, the rest
  still green (proves per-case isolation) → fix → Submit → `status: solved` + `<!-- meta: … -->`,
  clock stopped, editor settings restored.
- **Also verify:** with `rustc` off `PATH`, *"Install Rust to run tests"*; on Node < 22.18,
  TypeScript reports the version requirement — neither fails inside a compiler.

---

## 3. Phase 2 — Libraries per exercise, per language

### Artifact format

```yaml
libs:
  javascript: ["lodash@4.17.21"]
  python:     ["numpy"]
  rust:       ["serde_json@1"]
```

Optional; absent means today's behaviour exactly. Keyed by canonical `languageId`, so an exercise
solvable in several languages declares several dependency sets and a run installs only the
selected one's.

### ⚠️ Security — why this phase is not a one-liner

Library names come from a `.md` file, which `CLAUDE.md` classes as **untrusted input**. This is
the first point where user data reaches a subprocess as anything but file contents.

1. **Argv array, never a command string.** `install` is `{ cmd, args: string[] }`, executed with
   `execFile`. `CLAUDE.md`'s standing rule is now mandatory, not hypothetical.
2. **Allowlist before that.** `^@?[a-zA-Z0-9][a-zA-Z0-9._/-]*(@[a-zA-Z0-9.^~*+-]+)?$`, enforced at
   parse time. Defence in depth: argv already neuters shell metacharacters; the allowlist also
   stops `--flag`-shaped names and path traversal.
3. **No flag injection.** Names starting with `-` are rejected; the argv terminates options with
   `--` before the package list where the tool supports it.

### T8 — Parse and type the `libs:` block

- **Owns:** `src/types/leetcode.types.ts`, `src/services/leetcode-parser.helpers.ts`,
  `test/leetcode-parser.test.ts`
- **Test first:** a `libs:` block yields `{ javascript: ['lodash@4.17.21'] }`; malformed input
  degrades to `{}` and never throws.
- **Done when:** `libs` is on `ParsedLeetCode`, defaults to `{}`, unknown language keys dropped
  with a warning. `test.runtime` is **reserved** here too — parsed and validated, only `'local'`
  implemented.
- **Gate:** full gate.

### T9 — Library-name allowlist

- **Owns:** `src/services/lib-spec.helpers.ts`, `test/lib-spec.test.ts`
- **Depends on:** T8
- **Test first:** `validateLibNames(['lodash@4', '--target=/etc'])` rejects, naming the second.
  Cover `;rm -rf /`, `../../etc/passwd`, `-rf`, empty string.
- **Done when:** pure, `vscode`-free, and the parser calls it.
- **Gate:** full gate + `sonar-analyze` clean (a security hotspot is expected here).

### T10 — Install step in the emit contract and runner

- **Owns:** `src/services/test-envs/env.types.ts`, `src/services/leetcode-runner.service.ts`,
  `test/leetcode-runner.test.ts`
- **Depends on:** T9
- **Test first:** an env returning `install` has it run **before** `compile`; a failed install
  fills every case with `install error: …`, exactly as a compile error does.
- **Done when:** `EmittedProgram.install?: { cmd: string; args: string[] }`, run via `execFile`
  with its **own** ~120 s budget separate from `cases × timeoutMs`, so a large download does not
  consume the grading budget. **`ENOENT` maps to a named message** — *"npm not found — install
  Node.js to run library-backed exercises"* — which is the whole toolchain-detection story; no
  second probe table.
- **Gate:** full gate.

### T11 — Environment cache

- **Owns:** `src/services/lib-env.service.ts`, `test/lib-env.test.ts`
- **Depends on:** T10
- **Test first:** the key is a SHA-256 of `langId` + the **sorted** package list, so ordering in
  the `.md` cannot mint a second entry for the same set.
- **Done when:** environments build under `globalStorageUri/libenvs/<key>/` and are reused; a hit
  skips the install entirely. The service's only job is *build and hand back a directory* — what
  to do with it belongs to each env (§1).
- **Gate:** full gate.

### T12 — JavaScript and TypeScript libraries

- **Owns:** `src/services/test-envs/function/javascript.env.ts`,
  `src/services/test-envs/function/typescript.env.ts`, their tests
- **Depends on:** T11
- **Test first:** a candidate calling `require('lodash')` resolves inside the sandbox.
- **Done when:** a generated `package.json` + `npm install --prefix <env>`; the sandbox gets a
  `require` from `module.createRequire()` rooted at the env. **This is the sharp edge** — the
  current env deliberately runs the candidate in a bare `vm` context with no `require` at all.
  Grant `require` **only**; no `process`, no `fs`, no `child_process`. TypeScript inherits this
  unchanged — it is the same env plus the strip call.
- **Gate:** full gate + F5 + `sonar-analyze` on this diff specifically.

### T13 — Python libraries (venv)

- **Owns:** `src/services/test-envs/function/python.env.ts`, `test/function-env-python.test.ts`
- **Depends on:** T11
- **Test first:** the run command invokes `<env>/bin/python3`, not bare `python3`.
- **Done when:** `python3 -m venv <env>` then `<env>/bin/pip install …`; the runner is invoked
  with the venv interpreter. **Never `source activate` from a subprocess** — choosing the
  interpreter path *is* activation.
- **Gate:** full gate + F5 with a numpy exercise.

> Supersedes the earlier `pip install --target _libs` + `PYTHONPATH` sketch: `--target` does not
> isolate from system site-packages and breaks on entry points. A venv costs ~2 s, paid once per
> dependency set, and is genuinely isolated.

### T14 — Rust libraries (Cargo path)

- **Owns:** `src/services/test-envs/function/rust.env.ts`, `test/function-env-rust.test.ts`
- **Depends on:** T11, T4
- **Test first:** with no `libs.rust`, `emit` returns the bare `rustc` shape from T4 **unchanged**;
  with libs, a `Cargo.toml` + `src/` layout and `cargo` commands.
- **Done when:** both paths pass and the bare path's golden assertions are untouched.
  `--offline` after first fetch. **`~/.cargo/registry` is cargo's — never touched by the sweep.**
- **Gate:** full gate + F5.
- **Note:** library-backed Rust exercises may retire the `{:?}` ceiling in favour of
  `serde_json`. The bare path keeps Debug formatting — it still has no dependency to spend.

### T15 — Java libraries: explicit non-support

- **Owns:** `src/services/test-envs/function/java.env.ts`, `test/function-env-java.test.ts`
- **Depends on:** T8
- **Test first:** `validate` on an artifact declaring `libs.java` returns *"Library-backed Java
  exercises are not supported yet — remove `libs.java` or solve this in another language."*
- **Done when:** the message reaches the panel via the existing contract-violation path, so no
  file is written and nothing runs.
- **Gate:** full gate.

### T16 — Panel: declared libraries

- **Owns:** `src/ui/panels/leetcodePreview.panel.ts`, `src/ui/leetcode-preview.css`
- **Depends on:** T8
- **Done when:** the selected language's libraries render as chips near the test-count line, every
  value through `escHtml`. Any pure rendering helper extracted here **is** unit tested.
- **F5 click-path:** chips show for the selected language → switch language → chips swap → a
  language with no libs renders no empty row.

### T17 — Documentation

- **Owns:** `ARTIFACT_LEETCODE_FILE_FORMAT.md`, `CLAUDE.md`
- **Depends on:** T8–T16, T18
- **Done when:** `libs:` and reserved `test.runtime` are specified with the allowlist rule;
  `CLAUDE.md`'s "No runtime dependencies" paragraph is rewritten per §0; the runner section
  documents the install step, its separate budget, and the sweep.

### T18 — Storage sweep and Clear Cache command

- **Owns:** `src/services/storage-sweep.service.ts`, a new command in
  `src/commands/`, `package.json` contribution, `test/storage-sweep.test.ts`
- **Depends on:** T11
- **Test first:** the sweep selects entries unused > 30 days, then oldest-first until under the
  size budget; it **never** selects a path outside `globalStorageUri`.
- **Done when:** a `lastUsed` marker is touched on every cache hit; the sweep runs on
  `activate()`; `Obsidian Artifacts: Clear Exercise Cache` reports bytes reclaimed.
- **Gate:** full gate + F5.

**This task also retires existing debt.** `attempts/` files already accumulate —
`CLAUDE.md` calls abandoned files *"an accepted trade-off; cleanup belongs to a future feature."*
This is that feature. **One sweep service owning everything under `globalStorage`** is one
authority instead of two, which is the whole point of the DRY rule. Not `~/.cargo` — not ours.

`ponytail:` ceiling — the budget is a constant (2 GB default) rather than a setting. Upgrade path:
a configuration contribution, once someone actually wants a different number.

---

## 4. Phase 3 — Multi-file / multi-language exercises (contract only)

**Goal:** an exercise opens N editor tabs — `App.tsx` + `styles.css`, or `main.py` +
`schema.sql` — and grades the whole directory.

### Format

````markdown
## Files

```tsx path=src/App.tsx role=editable
export default function App() { /* solution here */ }
```

```json path=package.json role=hidden
{ "name": "exercise" }
```
````

Roles: `editable` (written, opened) · `readonly` (written, opened, restricted) · `hidden`
(written, never opened — scaffolding the solver should not see).

### Types

```ts
type FileRole = 'editable' | 'readonly' | 'hidden';

interface ExerciseFile {
  /** POSIX-relative path inside the run directory. Never absolute, never `..`. */
  path: string;
  langId: string;
  role: FileRole;
  content: string;
}
```

### Seams that move

| Seam | Today | Becomes |
|---|---|---|
| `EnvContext` | `code: string` | `files: ExerciseFile[]`, `code` kept as a derived getter so the five `function` envs need **no** change |
| `ChallengeSession` | one `tempFile: Uri` | `runDir: Uri` + `files: ExerciseFile[]` |
| Solve It | one file, one editor | write the tree, open every non-`hidden` file |
| Submit | read the live buffer | read every `editable` buffer, falling back to disk |
| `discardChallenge` | delete one file | delete the run directory |
| Test type | — | new `project` id in `TEST_TYPES` |

### Security

Path traversal is the whole risk surface. Every `path` is normalised and asserted to stay inside
`runDir` **before** any write; absolute paths, `..` segments and symlink targets are rejected at
parse time.

### Open questions to settle before task breakdown

1. Does `buildExecutable`'s candidate normalisation stay `function`-only? (Current read: yes.)
2. Does Run Tests read every dirty buffer, or save-then-grade-from-disk? Reading buffers is truer
   to today's model; saving is far simpler across N tabs.
3. Does PracticeMode need per-file scope? (Current read: no — already global.)
4. **This is where real `tsc` arrives.** `.tsx` cannot be type-stripped into a working React app;
   it needs a compiler or bundler. Phase 1's strip-only TypeScript env stays for `function`
   exercises; `project` exercises get a `typescript`-in-the-env compile step, which is exactly the
   opt-in path T4b deferred.

---

## 5. Phase 4 — Running servers (contract only)

**Goal:** the exercise is a frontend consuming an API. The extension boots the backend, learns
its URL, and injects it into the frontend's config as a `hidden` file. The solver sees the
endpoint contract and the consumer code — never the wiring.

### Ports: don't pick an uncommon one, pick a free one

"Use an uncommon port to avoid clashes" is still guessing, and guessing loses eventually — the
one machine where 8137 is already taken is the one where the exercise breaks. Ask the OS instead:

```ts
// bind to port 0 → the kernel hands back a port nothing else holds
const probe = net.createServer().listen(0, '127.0.0.1');
const port  = (probe.address() as net.AddressInfo).port;
await new Promise(r => probe.close(r));
```

**Collision becomes structurally impossible rather than statistically unlikely.** Bind
`127.0.0.1`, never `0.0.0.0` — an exercise server has no business being reachable from the
network.

There is a real TOCTOU window between our close and the child's bind. It is small, and the honest
mitigation is a retry on `EADDRINUSE` rather than pretending the window isn't there.

### Format

```yaml
test:
  type: service
  runtime: local          # 'docker' reserved, not implemented
services:
  - name: api
    dir: server
    install: ["npm", "ci"]
    start:   ["node", "server.js", "--port", "${PORT}"]
    ready:   "listening"          # readiness only — not where the URL comes from
    exposeAs:
      NEXT_PUBLIC_API_URL: "http://127.0.0.1:${PORT}"
  - name: web
    dir: client
    install: ["npm", "ci"]
    start:   ["npm", "run", "dev", "--", "--port", "${PORT}"]
    ready:   "ready"
    envFile: .env.local           # written role:hidden — the solver never sees it
    dependsOn: [api]
```

- `install` / `start` are **argv arrays** from the first line written. The T9 allowlist applies to
  `argv[0]`.
- **`${PORT}` is templated into the argv and injected as a `PORT` env var.** Both, because they
  cost one line each and frameworks disagree about which they honour — `next dev` reads the env
  var, `uvicorn` wants `--port`, an Express app reads `process.env.PORT`. Templating keeps it
  explicit in the artifact instead of hoping propagation works.
- **We know the URL before the process starts**, because we assigned the port. That is what makes
  injection possible without a wait-and-parse round trip, and it is why `ready` is a plain
  readiness substring rather than a URL-extracting regex. Learning the URL from stdout would mean
  the frontend cannot be templated until the backend has already booted *and* logged in the exact
  format we guessed.
- `exposeAs` is a map of *variable name → value template*, so the artifact author names the
  variable their framework actually wants (`NEXT_PUBLIC_*`, `VITE_*`, plain `API_URL`). **The
  extension encodes no framework knowledge**; it substitutes `${PORT}` and writes what it is told.
- `envFile` names where a dependent's variables land, written as a Phase-3 `role: hidden` file —
  which is exactly the *"without the user seeing this config"* requirement, expressed in machinery
  Phase 3 already has.
- `dependsOn` orders the boot. A cycle is a parse error.

### Lifecycle

Assign ports for every service → boot in dependency order → wait for `ready` or a per-service
timeout → write each dependent's `envFile` before it starts → run the grading driver → **tear
everything down**.

Env files are written **before** the dependent boots, not after — a Next.js build bakes
`NEXT_PUBLIC_*` at build time, so an env file that lands late is an env file that does nothing.

Teardown must fire on: successful Submit, failed Submit, End Challenge, panel dispose,
`deactivate()`, and extension-host crash-restart. This is the phase's real difficulty. Kill the
**process group**, not the pid — a Node dev server forks children that survive a pid-level kill.

### Security

- `envFile` and `dir` are user-supplied paths → the Phase 3 traversal rule applies: normalise and
  assert containment inside the run directory **before** writing.
- Bind `127.0.0.1` only.
- `${PORT}` is the only substitution performed. No general-purpose templating — an expression
  language in an untrusted `.md` is an evaluator waiting to happen.

### Grading

`fetch`-based assertions against the captured URLs from a generated Node driver. **No headless
browser** — Playwright is a ~300 MB install the extension has no path to provide. Real DOM
assertions are a later phase with their own decision.

### Open questions to settle before task breakdown

1. Where does the install budget live? A cold `npm ci` on Next.js is minutes, far beyond any
   grading timeout — likely a separate "preparing exercise" phase with its own progress and
   cancellation.
2. Do services share the T11 environment cache, or does `node_modules` per exercise get its own?
3. What does the timer do while a server boots? Grading time is not solving time, so the clock
   almost certainly must pause — which `LeetCodeTimer` cannot currently do.
4. Fallback when `ready` never matches: fail with captured stdout, or poll the assigned URL until
   it answers? Polling is now *possible* because we already know the URL — which we would not if
   the URL came from stdout. (Current read: poll with a timeout, then fail loudly **with** the
   captured stdout, since a silent poll hides misconfiguration but a strict substring match is
   brittle across framework versions.)
5. Does a frontend dev server need `--host 127.0.0.1` forced, or is binding left to the artifact?

---

## 6. Waves and dispatch

Every wave: dispatch → wait for all → gate → update `progress.md` → next. Tasks within a wave own
**disjoint** files. Registry and shared-table edits are **orchestrator only**.

| Wave | Tasks | Agents | Note |
|---|---|---|---|
| 0 | T0 | orchestrator | Codegen split. Golden net passes untouched. |
| 1 | T1 | orchestrator | Widen `LangId` with both languages; `tsc` green before fan-out. |
| 2 | T2 · T3 · T3b · T5 | 4 × sonnet | Disjoint only because T0 happened. Orchestrator lands T3b's `PRIMITIVES`/`TYPE_SYNTAX` hunk. |
| 3 | T4 · T4b | 2 × sonnet | Rust needs T2's literals; TypeScript needs T3b. |
| 4 | T6 · T7 | 1 × sonnet + human | Docs, then F5 twice (Rust, TypeScript). |
| 5 | T8 · T9 | 2 × sonnet | Phase 2 opens. |
| 6 | T10 · T11 | 2 × sonnet | Contract, then cache. |
| 7 | T12 · T13 · T14 · T15 | 4 × sonnet | One env each — naturally disjoint. |
| 8 | T16 · T17 · T18 | 2 × sonnet + human | Panel, sweep, docs, F5. |

**Every agent, every wave:** `caveman` · `ponytail` · `mastering-typescript` · `sonar-analyze`.
Order inside a task: design types → failing test → smallest implementation → Sonar → gate → report.

### Gate

```bash
rm -rf dist && pnpm compile && pnpm lint && \
  node node_modules/.pnpm/mocha@*/node_modules/mocha/bin/mocha.js --ui tdd "dist/test/**/*.test.js"
```

`rm -rf dist` is required — `tsc` leaves orphaned `dist/*.js` and a stale compiled test inflates
the count. Baseline at branch point: **509 passing**. Record the count every run; a drop is a
blocker until explained.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Widening `LangId` breaks `Record<LangId, …>` in files this plan did not name | T1 is serial and its done-condition is `tsc --noEmit` clean — the compiler enumerates them, not this document |
| `stripTypeScriptTypes` is experimental and could change | It is verified working on the local Node; `detect()` gates the version and the failure is a named message. The fallback — `tsc` from an env — arrives in Phase 3 regardless |
| A solver writes `enum` / decorators and hits a strip failure | T4b's `validate` rejects non-erasable syntax with an honest message before anything runs |
| Rust `{:?}` is not valid JSON for some return shape | Ceiling documented at the emit site; structs and enums out of scope until serde in T14 |
| `npm install` inside a run is slow enough to feel broken | T11 cache + T10's separate budget + T16 progress |
| Widening the JS `vm` sandbox with `require` re-opens escape paths | T12 grants `require` only; `sonar-analyze` on that diff specifically |
| Cache grows to gigabytes | T18 sweeps by age **and** size, plus an explicit command |
| Phase 3/4 contracts drift from what Phases 1–2 build | Contracts are re-read and amended before their breakdown — a starting position, not a commitment |
| Orphaned dev servers survive teardown (Phase 4) | Kill the process group; teardown wired to all six exit paths |
| Plan documents leak into `develop`/`main` | `git rm -r docs` is the final commit before the PR |

---

## 8. PR checklist

- [ ] Gate green, test count recorded and up
- [ ] `npx tsc --noEmit` clean
- [ ] `sonar-analyze` clean on every non-trivial diff
- [ ] F5 manual pass done for every `vscode`-coupled task
- [ ] `ARTIFACT_LEETCODE_FILE_FORMAT.md` updated in the same change as any format change
- [ ] `CLAUDE.md` invariants from §0 rewritten
- [ ] Jira stories created under VSX-122, keys filled in
- [ ] Anything worth keeping promoted out of `docs/` into `CLAUDE.md` / the format spec / JSDoc
- [ ] **`git rm -r docs` committed — the PR diff contains no `docs/` path**
