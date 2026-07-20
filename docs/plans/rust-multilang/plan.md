# Plan — Rust, TypeScript, Multi-Library, Multi-File, Running Servers

Epic: **[VSX-122](https://dexsys.atlassian.net/browse/VSX-122)** ·
Branch: `feature/VSX-122_multilib-multilang-support` · Process: [CREATING_A_PLAN.md](../../../CREATING_A_PLAN.md)

**This file is the single authority.** Companion files are derived views — when any of them
disagrees with this plan, this plan wins and the companion is the bug:

- [progress.md](progress.md) — the ledger. **Orchestrator is its only writer.**
- [jira-tickets.md](jira-tickets.md) — paste-ready Jira story specs, one per task, same T-ids.
- [examples.md](examples.md) — E-tasks producing runnable example artifacts under
  `examples/leetcode/` (a **tracked repo directory that survives the PR** — unlike `docs/`).
  They are the material the F5 gates click through and the format spec's living reference; wave
  placement inside that file.

**Depth (agreed):** Phases 1, 2, and 2.5 are task-level and agent-ready. Phases 3–4 are
**contract-only** — task breakdown waits until the earlier phases land; planning them today would
be planning against unknowns.

---

## 0. What this feature is

| # | Capability | Disturbance |
|---|---|---|
| 1 | **Rust** and **TypeScript** as runnable languages for `test.type: function` | None — the registry was built for this |
| 2 | **Libraries** per exercise, per language (lodash, numpy, serde_json) | Adds cached library environments; first user data reaching a subprocess argv |
| 2.5 | **Classic test types** — `class` (method sequences), mutation grading, `stdin-stdout` | None structural — extends `TEST_TYPES` and the env-factory pattern already in place |
| 3 | **Multi-file / multi-language** exercises (`.tsx` + `.css` + `.py`) | Breaks the one-temp-file challenge model and `EnvContext.code` |
| 4 | **Running servers** — boot a backend, inject its URL into the frontend invisibly | Breaks the zero-runtime-dependency invariant; adds process lifecycle |

### Invariants this feature deliberately changes

Both are load-bearing statements in `CLAUDE.md`. Rewrite them **in the same change that breaks
them**, not after.

1. **"No runtime dependencies."** Still true of the *extension* — it ships none. No longer true of
   a *run*: from Phase 2 a run may shell out to the user's local `npm`/`pip`/`cargo`. New wording:
   *the extension ships zero dependencies; an exercise may declare its own, installed into a
   cached environment using the user's local toolchain.*
2. **"One temp file per challenge."** From Phase 3 a challenge owns a temp *directory* with N
   files and N editor tabs.

### Decisions taken up front

- **Dependency policy:** shell out to the user's local toolchain. `TestEnv.requires` / `detect()`
  already model the preflight.
- **Missing-toolchain detection is the `ENOENT` from the install call itself**, not a second probe
  table. A hand-maintained probe list drifts; `ENOENT` does not. `detectCmd` stays for the
  runtime, which already exists and is already tested.
- **Docker is rejected** for Phases 1–3: needs Docker Desktop installed and running (a licensing
  problem on corporate machines), pulls GB images, adds seconds of cold start to a suite that
  grades in milliseconds. `test.runtime: 'local' | 'docker'` is **reserved** in the format — it
  parses, validates, and explains itself, exactly like a reserved `test.type`.
- **Java libraries are out of scope** through Phase 2. Java has no *isolation* problem — the
  classpath is per-invocation — it has a *resolution* problem, and nothing in a stock JDK resolves
  transitive dependencies. `libs.java` reports explicit non-support (T14).

---

## 1. Orchestrator protocol — how to execute this plan

Three roles: you are the **orchestrator** (Opus — senior TS tech lead + PM). A **reviewer**
(Opus — senior TS tech lead, review only) verdicts every worker task. **Workers** are Sonnet.
The full role prompts live in [CREATING_A_PLAN.md](../../../CREATING_A_PLAN.md) §2 — copy them
verbatim per dispatch and append the instance parameters below. Phases 1, 2, and 2.5 execute;
Phases 3–4 do **not** — see step 6.

1. **Read once:** [CREATING_A_PLAN.md](../../../CREATING_A_PLAN.md) (process + the three role
   templates), [progress.md](progress.md) (ledger). `CLAUDE.md` is in your context already; its
   Code Style and Security sections bind every role.
2. **Verify claimed state before acting** (trust the tree): run the gate, confirm the count
   matches the ledger baseline, grep any "already done" claim. Tasks in this repo have turned out
   already done, or deliberately done differently, by the time their plan was read.
3. **Per wave, in table order (§8) — the review loop:**
   a. **Orchestrator-only work first** — T0, T1, and every *integration hunk* a wave row lists
      (registry `register()` lines, shared-table one-liners). Workers never touch these files.
   b. **Dispatch every worker task in the wave in parallel** (model `sonnet`), each prompt =
      worker template + that task's block verbatim + the instance parameters. Do not paste this
      whole plan into a worker. **Security-critical tasks are named as such in the dispatch**,
      with their surface (see parameters below).
   c. **Spawn one reviewer for the wave** (model `opus`). As each worker reports, pass the
      reviewer: task block + worker report + diff of the Owns files. Continue the same reviewer
      across the wave via SendMessage — its accumulated context is what catches two tasks
      solving the same problem twice.
   d. **Enforce verdicts.** `CHANGES` → findings back to the *same* worker (SendMessage, context
      intact), worker fixes — `SEC:` findings first — reviewer re-checks. **Max 2 rounds per
      task**, then `ESCALATE` resolves to you: fix it yourself or revert the slice and
      re-dispatch fresh; record which in the Decisions table. An out-of-Owns edit or a touched
      golden assertion is an automatic `CHANGES` regardless of anything else. An open `SEC:`
      finding never expires on the round cap.
   e. **Integrate** the wave's orchestrator hunks once every task is `APPROVE`, then **gate the
      integrated tree** (§8 command). A red gate stops all dispatch — fix or revert the wave;
      never open the next wave on red.
   f. **Commit once per wave** (workers and reviewer never commit), update ledger rows — status,
      test count, review rounds — and the Decisions table for anything decided that this plan
      did not specify.
4. **Human gates:** T9, T21 and T29 are F5 manual passes. Stop, hand the user the click-path,
   record their reported result. Never mark them done yourself.
5. **Jira:** as stories are created from [jira-tickets.md](jira-tickets.md), fill each `<KEY>`
   there and in the ledger row.
6. **After Phase 2.5 closes:** amend the §6/§7 contracts against the real tree, then **stop and
   present** — their task breakdown is a human decision, not yours.

### Instance parameters (append to every role template)

- **Repo:** this working directory, branch `feature/VSX-122_multilib-multilang-support`.
- **Models:** orchestrator = you (Opus) · reviewer = `opus` subagent, one per wave, continued
  via SendMessage · workers = `sonnet` subagents.
- **Gate** (workers gate their slice; orchestrator gates the integrated tree; also run
  `npx tsc --noEmit`):
  `rm -rf dist && pnpm compile && pnpm lint && node node_modules/.pnpm/mocha@*/node_modules/mocha/bin/mocha.js --ui tdd "dist/test/**/*.test.js"`
- **Forbidden to workers:** golden test assertions, `env.registry.ts`, `package.json` (unless
  in Owns), `docs/plans/**`, git commits.
- **Security-critical tasks and their surfaces:** T6/T7 (untrusted candidate code → emitted
  programs), T10 (allowlist — the boundary itself), T11 (untrusted `.md` parse), T12 (argv
  installs via `execFile`), T13 (env failure mapping), T15 (webview interpolation — `escHtml`),
  T16 (`vm` sandbox widening — `require` only), T19 (path containment under `globalStorageUri`),
  T22 (untrusted `.md` parse — new case schemas), T27 (per-case stdin fed to child processes),
  T30 (recursive vault walk — symlink containment under the `LeetCode/` root).
  Their Test-first includes a hostile input; their review verdict names the attack surface.
- **Static analysis:** the *SonarQube for IDE* extension only — diagnostics arrive on their own
  after every edit and are fixed, not filed. `sonar-analyze` / `mcp__sonarqube__*` / the `sonar`
  CLI are **not** to be invoked or installed ([CREATING_A_PLAN.md §3.1](../../../CREATING_A_PLAN.md)).
  It performs **no taint analysis**, so on every surface listed above the reviewer's manual
  trace is the only check that exists — not a second opinion.
- **Review:** max 2 `CHANGES` rounds per task, then `ESCALATE`; verdicts and round counts go in
  the ledger Notes column.

---

## 2. Library environments — the shape of the Phase 2 problem

Settled ahead of the tasks because it determines their boundaries.

### Key by dependency set, not by exercise

```
globalStorageUri/libenvs/<langId>-<sha256(langId + sorted pkg list)>/
```

Per-exercise environments mean thirty exercises using numpy build numpy thirty times. Per-
dependency-set means they share one, and `lodash@3` vs `lodash@4` hash apart automatically —
**version conflict becomes structurally impossible rather than something to handle.**

### Installs happen at env build, not per run

The cache service owns *"build and hand me a directory keyed by this dependency set"* — it runs
the language's install argv **inside the env dir** (via `execFile`, own ~120 s budget, `ENOENT` →
named message). The runner then passes the resolved dir to the env as `EnvContext.libDir`. There
is **no** per-run install step and no `EmittedProgram.install` field — a run either gets a ready
directory or a mapped error.

**Multi-window safety:** two VS Code windows share `globalStorage`. Build into `<key>.tmp-<pid>`,
then atomic-rename to `<key>`; the rename loser deletes its tmp. Consumption is read-only for
Python/JS (imports only), and cargo does its own target-dir locking.

### Each language uses its own isolation primitive

"venv" is Python's fix for a problem the others do not have — `pip` installs globally by default.
**Do not build a uniform abstraction over four package managers; three would wrap a no-op.**

| Lang | Primitive | Build step (in env dir) | Run consumes it via |
|---|---|---|---|
| python | venv — **the one we build** | `python3 -m venv .` + `bin/pip install …` | invoke `<env>/bin/python3` |
| javascript | `node_modules` — isolated by default | write `package.json`, `npm install` | `module.createRequire()` rooted at `<env>` |
| typescript | same as JS | same | same env + the strip call |
| rust | cargo — already a project *and* a cache | `cargo fetch` (populates `~/.cargo`, writes `Cargo.lock`) | per-run temp project; **`CARGO_TARGET_DIR=<env>/target`** shares incremental builds; `--offline` after first fetch |
| java | classpath — wrong problem | — (out of scope) | when built someday: `mvn dependency:copy-dependencies`, never a hand-rolled resolver |

Rust's sources stay **per run** in the temp dir — copying them into the shared env dir would
mutate the cache per run. The shared `target/` is the prize: cold minutes become incremental
seconds, and cargo's own locking handles concurrency.

Each env knows what to do with its directory; the cache service knows nothing about any language
beyond its install argv. No `interpreter | resolveRoot | manifest | classpath` union — four
optional fields where exactly one is ever set is a union pretending to be a struct.

### Garbage collection is not optional

numpy ~60 MB; a Next.js `node_modules` ~300 MB; ten dependency sets is gigabytes. Age **and**
size sweep plus an explicit command — T19.

---

## 3. Phase 1 — Rust and TypeScript as runnable languages

Per `CLAUDE.md`, a runnable language is four rows. TypeScript is cheaper than Rust: it reuses
JavaScript's literals wholesale (no `jsonToLiteral` work) and its env is the JS env plus one call.

**Pre-existing state, verified in the tree (not assumed):**

- `PRIMITIVES` already maps `int/float/string/bool` → `i32/f64/String/bool`; `TYPE_SYNTAX.rust`
  already maps `Vec<T>` / `HashMap<K, V>` ([leetcode-codegen.service.ts:8-44](../../../src/services/leetcode-codegen.service.ts#L8-L44)) ✅
- `LANG_ALIAS` carries `rs → rust`, `ts → typescript`; `LANG_EXT` carries `rust → rs`,
  `typescript → ts` ✅
- `jsonToLiteral` has **no** Rust branch — arrays emit `[1, 2]`, a fixed-size `[i32; 2]`, not the
  `Vec<i32>` the type mapping promises ❌ **the real Rust gap**
- No `LANG_CODEGEN` rows, no `LangId` membership for either ❌

### T0 — Extract per-language codegen into siblings (enabling refactor)

`leetcode-codegen.service.ts` is 355 lines holding two tables *and* six template functions. Two
new languages push it past the 500-line split threshold, and — more immediately — every Phase 1
task would otherwise contend for one file. This extraction is what makes the phase parallel.

- **Owns:** `src/services/codegen/{java,python,javascript}.codegen.ts`; the deletions from
  `src/services/leetcode-codegen.service.ts`
- **Reads:** `test/leetcode-codegen-golden.test.ts`
- **Depends on:** none
- **Test first:** none — behaviour-preserving. The golden net **already exists** and must pass
  **byte-identical and unmodified**; editing a golden assertion invalidates the task.
- **Done when:** the service retains only `PRIMITIVES`, `JAVA_BOX`, `TYPE_SYNTAX`, `LANG_CODEGEN`,
  `mapType`, `jsonToLiteral`, `injectSolution` and the public entry points.
- **Gate:** full gate, test count unchanged.

> **Orchestrator, serial.** Every later task reads this layout.

### T1 — Widen the registry: `rust` + `typescript`, stubs wired

- **Owns:** `src/types/languages.ts`; the `PRIMITIVES`/`TYPE_SYNTAX` typescript columns;
  **stub** `src/services/codegen/{rust,typescript}.codegen.ts` with their `LANG_CODEGEN` rows;
  the minimal fix at every other site the widened `LangId` breaks; `test/leetcode-languages.test.ts`
- **Depends on:** T0
- **Test first:** `LANGUAGES.rust.detectCmd === 'rustc --version'`,
  `LANGUAGES.typescript.detectCmd === 'node --version'`, and for both
  `fileExt === LANG_EXT[id]` with every alias resolving through `LANG_ALIAS`. If the existing
  consistency test does not catch this automatically, that is a bug in the consistency test —
  fixed here.
- **Done when:** `npx tsc --noEmit` clean with both members in the union; both stub rows return
  `''` — the exact pre-widening fallback for a non-`LangId` — so behaviour is preserved by
  construction until the real templates land.
- **Gate:** full gate.

```ts
rust:       { id: 'rust',       displayName: 'Rust',       fileExt: 'rs', commentPrefix: '//', detectCmd: 'rustc --version', aliases: ['rs'] },
typescript: { id: 'typescript', displayName: 'TypeScript', fileExt: 'ts', commentPrefix: '//', detectCmd: 'node --version',  aliases: ['ts'] },
```

TypeScript's probe is **`node`, not `tsc`** — the default path never invokes a compiler (T7).
`TYPE_SYNTAX.typescript` = `{ array: i => \`${i}[]\`, map: (k, v) => \`Record<${k}, ${v}>\` }`;
its `PRIMITIVES` column mirrors JavaScript's.

> **Orchestrator, serial.** Widening `LangId` breaks every `Record<LangId, …>` at once — do not
> work from a predicted list; the compiler enumerates them. Both languages in one step: they widen
> the same union, and splitting them pays the same breakage twice. Note: `isLangId('rust')` turns
> true here, but the language selector is driven by the **env registry**, so neither language is
> user-visible until T6/T7 register. No half state ships.

### T2 — Rust literals in `jsonToLiteral`

- **Owns:** `src/services/leetcode-codegen.service.ts` (the `jsonToLiteral` family only),
  `test/leetcode-typemap.test.ts`
- **Depends on:** T1
- **Test first:** `assert.strictEqual(jsonToLiteral([1, 2], 'rust'), 'vec![1, 2]')` — fails
  today, returns `[1, 2]`.
- **Done when:** arrays → `vec![…]` (nested: `vec![vec![1, 2]]`), strings → `String::from("…")`,
  objects → `HashMap::from([(String::from("k"), v), …])`, numbers/booleans unchanged,
  `null` → `None`. TypeScript needs no branch — it falls through to the JavaScript path.
- **Gate:** full gate.

`ponytail:` ceilings, commented at the emit site: `[]` → `vec![]` cannot type-infer standalone
(upgrade: thread the declared param type — touches five languages, not now); strings emit
`String::from(…)`, so a `&str` param fails at compile rather than at `validate` (the compile
error names the mismatch clearly enough).

### T3 — TypeScript codegen row

- **Owns:** `src/services/codegen/typescript.codegen.ts` (replacing the T1 stub),
  `test/leetcode-codegen-typescript.test.ts`
- **Reads:** `src/services/codegen/javascript.codegen.ts`
- **Depends on:** T1
- **Test first:** `generateBoilerplate(parsed, 'typescript')` contains a **typed** signature from
  `mapType` — the entire reason to offer TypeScript over JavaScript — and exactly one
  `SOLUTION_MARKER`.
- **Done when:** boilerplate and harness emit; byte-exact golden-style asserts live in **this
  task's own test file**, never appended to the shared golden file.
- **Gate:** full gate, test count up.

### T4 — Rust codegen row

- **Owns:** `src/services/codegen/rust.codegen.ts` (replacing the T1 stub),
  `test/leetcode-codegen-rust.test.ts`
- **Depends on:** T1, **T2** — the harness renders case args through `jsonToLiteral(…, 'rust')`,
  which is why this task trails T2 by a wave.
- **Test first:** `generateBoilerplate(parsed, 'rust')` contains `fn <name>(`, the mapped
  signature, exactly one `SOLUTION_MARKER`.
- **Done when:** boilerplate is a runnable stdin wrapper (`std::io::stdin().read_line`); harness
  is `assert_eq!`-based; golden-style asserts in this task's own test file.
- **Gate:** full gate, test count up.

### T5 — Big-O heuristic: Rust patterns

- **Owns:** `src/services/leetcode-bigo.helpers.ts`, `test/leetcode-bigo.test.ts`
- **Depends on:** T1
- **Test first:** a Rust `for i in 0..n { for j in 0..n { … } }` sample classifies as `O(n²)`.
- **Done when:** Rust loop forms recognised — **or** the task closes `dropped` with the finding
  that the heuristic is already language-agnostic, recorded in the ledger. **Verify before
  writing** a branch into a matcher that may never have needed one. TypeScript needs nothing;
  its loop syntax is JavaScript's.
- **Gate:** full gate.

### T6 — `function × rust` test environment

- **Owns:** `src/services/test-envs/function/rust.env.ts`, `test/function-env-rust.test.ts`
- **Reads:** `make-function-env.ts`, `java.env.ts` (two-unit model), `python.env.ts` (message shape)
- **Depends on:** T1, T2 (runner renders args via rust literals)
- **Test first:** `emit(ctx)` returns files `['solution.rs', 'runner.rs']`,
  `compile === 'rustc -O runner.rs -o runner'`, `run === './runner'`.
- **Done when:** the env object is exported and its test passes. **Registration is not yours** —
  the orchestrator lands the `register()` line in `env.registry.ts` at wave close, after which
  `languagesForType('function')` must return `['java', 'javascript', 'python', 'rust',
  'typescript']`.
- **Gate:** full gate.

| Concern | Decision (settled — do not re-litigate) |
|---|---|
| Linking | `runner.rs` declares `mod solution;`; `rustc` pulls `./solution.rs` as a second unit. Candidate **verbatim**, never spliced — same model as Java. |
| Visibility | `candidateContent` rewrites a leading `fn <name>` → `pub fn <name>` with one anchored regex. Demanding `pub` from the solver is a hostile contract for a detail the driver invented. |
| `validate` | No top-level `fn <name>(` → *"Rust setup must define a top-level `fn <name>(…)` — not a method inside an `impl` block."* |
| Serialization | `{:?}` Debug, **no serde**. Numbers, `bool`, `String`, `Vec`, nested `Vec`, `HashMap<String, _>` all Debug-print as valid JSON; `canonicalJson` sorts HashMap key order extension-side. `ponytail:` ceiling — no structs/enums; upgrade is serde via T18. |
| Isolation | `panic::catch_unwind(AssertUnwindSafe(…))`, payload downcast for the message, no-op `panic::set_hook` to suppress the banner. |
| Flushing | `io::stdout().flush()` per sentinel line — Rust block-buffers a piped stdout; a timeout-kill would discard produced lines. |

### T7 — `function × typescript` test environment

- **Owns:** `src/services/test-envs/function/typescript.env.ts`,
  `test/function-env-typescript.test.ts`
- **Reads:** `javascript.env.ts` — this env is that env plus one call
- **Depends on:** T1, T3
- **Test first:** `emit(ctx)` writes the candidate as `sol.ts` **verbatim**; the generated runner
  strips types before evaluating in the `vm` sandbox.
- **Done when:** a typed candidate runs green; non-erasable syntax fails with the honest message.
  Registration is the orchestrator's, as in T6.
- **Gate:** full gate.

**Design — verified empirically on Node v26.5.0 before being written down:**

```js
const js = require('node:module').stripTypeScriptTypes(fs.readFileSync('sol.ts', 'utf8'));
vm.runInContext(js, ctx);   // pull the function off the sandbox, exactly as the JS env does
```

- `stripTypeScriptTypes` **blanks types with spaces** — line/column offsets survive, so a runtime
  error still points at the solver's real `.ts` line. This is why stripping beats transpiling.
- No compiler, no install, no compile step on the default path.
- **`detect()` gates Node ≥ 22.18 / 23.10** — below that: *"TypeScript exercises need Node 22.18
  or newer."* Exactly what `TestEnv.detect()` exists for.
- **`validate` rejects non-erasable syntax** — `enum`, `namespace`, parameter properties,
  decorators — with an honest message instead of a parse dump.
- **No type checking here, deliberately.** Grading is behavioural; the solver already gets live
  errors from tsserver because the temp file has a real `.ts` extension (which `CLAUDE.md` notes
  is load-bearing). Opt-in `tsc` arrives with Phase 3, which needs a compiler for `.tsx` anyway.
- The `ExperimentalWarning` goes to **stderr** — it cannot corrupt sentinel parsing on stdout.

### T8 — Documentation (Phase 1)

- **Owns:** `ARTIFACT_LEETCODE_FILE_FORMAT.md`, `CLAUDE.md`
- **Depends on:** T1–T7
- **Test first:** n/a — manual read-through against the tree.
- **Done when:** the language table lists Rust and TypeScript; the capability matrix shows both
  `function` pairs; `CLAUDE.md`'s "four rows" section names `src/services/codegen/` and
  TypeScript's Node-version gate. Where doc and parser disagree, the parser wins.
- **Gate:** `pnpm lint`.

### T30 — Recursive exercise discovery (vault folders)

The example taxonomy ([examples.md](examples.md)) organises the vault's `LeetCode/` into
type/topic folders — and the picker is **flat** today:
[leetcode.command.ts:64-71](../../../src/commands/leetcode.command.ts#L64-L71) filters
`FileType.File` in one `readDirectory` call, so a subfolder is invisible. This task must land
before the first E-task deploys.

- **Owns:** `src/commands/leetcode.command.ts` (`pickLeetCodeFile`),
  `src/commands/quickpick-item.helpers.ts`, `test/leetcode-quickpick.test.ts`
- **Depends on:** none — pure discovery change, independent of languages
- **Test first:** the pure helper, given a nested entry tree, returns every `.md` at any depth
  with its vault-relative path; the QuickPick item's `description` carries the folder path as
  the category label (`function/arrays`).
- **Done when:** nested `.md` files are discovered and labelled; a **flat vault behaves
  byte-identically to today** (the existing single-file vault is the regression case);
  symlinked directories are **not** followed — recursion must stay under the validated
  `LeetCode/` root (path-containment rule, security-critical).
- **Gate:** full gate.

### T9 — F5 manual pass (Phase 1) — human

- **Depends on:** T1–T8, T30, E1. Orchestrator: stop, have the user deploy `examples/leetcode/`
  to the vault (`/Users/nick/N0t3s/C0d3-Sn1pp3ts/LeetCode/`), then hand them this click-path
  against `function/arrays/two-sum.md` (E1) — the folder path also proves T30's recursive
  picker — **run twice — once Rust, once TypeScript**:
- Open Exercise → selector offers the language → Solve It → temp file opens with the right
  extension and a typed starter → passing solution → Run Tests green → break one case → Run Tests
  shows **one** red, others green (proves per-case isolation) → fix → Submit → `status: solved` +
  `<!-- meta: … -->`, clock stopped, settings restored.
- **Also:** with `rustc` off `PATH` → *"Install Rust to run tests"*; on Node < 22.18 → the
  version message. Neither may fail inside a compiler.

---

## 4. Phase 2 — Libraries per exercise, per language

### Artifact format

```yaml
libs:
  javascript: ["lodash@4.17.21"]
  python:     ["numpy"]
  rust:       ["serde_json@1"]
```

Optional; absent means today's behaviour exactly. Keyed by canonical `languageId` — a run installs
only the selected language's set.

### ⚠️ Security — why this phase is not a one-liner

Library names come from a `.md` file — **untrusted input** per `CLAUDE.md`. This is the first
point user data reaches a subprocess as anything but file contents.

1. **Argv array, never a command string** — every install is `{ cmd, args: string[] }` through
   `execFile`. `CLAUDE.md`'s standing rule is now mandatory, not hypothetical.
2. **Allowlist first:** `^@?[a-zA-Z0-9][a-zA-Z0-9._/-]*(@[a-zA-Z0-9.^~*+-]+)?$` at parse time.
   Defence in depth — argv neuters shell metacharacters; the allowlist also stops `--flag`-shaped
   names and traversal.
3. **No flag injection** — leading `-` rejected; argv terminates options with `--` where the tool
   supports it.

### T10 — Library-name allowlist

- **Owns:** `src/services/lib-spec.helpers.ts`, `test/lib-spec.test.ts`
- **Depends on:** none — pure, and why it dispatches alongside T8/T9 rather than after them
- **Test first:** `validateLibNames(['lodash@4', '--target=/etc'])` rejects, naming the second.
  Cover `;rm -rf /`, `../../etc/passwd`, `-rf`, empty string.
- **Done when:** pure, `vscode`-free, exported. (The parser wires it in T11 — not here; the
  parser file belongs to T11.)
- **Gate:** full gate. **Reviewer's manual security trace is the gate here** — `sonar-analyze`
  is not runnable in this repo and would not catch a taint defect anyway
  ([CREATING_A_PLAN.md §3.1](../../../CREATING_A_PLAN.md)). This task *is* the trust boundary,
  so the trace is mandatory and its verdict names the surface.

### T11 — Parse `libs:`, reserve `test.runtime`

- **Owns:** `src/types/leetcode.types.ts`, `src/services/leetcode-parser.helpers.ts`,
  `test/leetcode-parser.test.ts`, `ARTIFACT_LEETCODE_FILE_FORMAT.md` (same-change rule)
- **Depends on:** T10 — calls `validateLibNames` during parse
- **Test first:** a `libs:` block yields `{ javascript: ['lodash@4.17.21'] }`; malformed input
  degrades to `{}` and never throws; a name failing T10's allowlist surfaces as a parse warning
  naming the entry.
- **Done when:** `libs` on `ParsedLeetCode`, default `{}`, unknown language keys dropped with a
  warning. `test.runtime` parses with only `'local'` implemented — `'docker'` reserved and
  self-explaining, like a reserved `test.type`.
- **Gate:** full gate.

### T12 — Library-environment cache service

- **Owns:** `src/services/lib-env.service.ts`, `test/lib-env.test.ts`
- **Depends on:** T10 (re-validates names on entry — defence in depth against a caller that
  skipped the parser)
- **Test first:** the key is a SHA-256 of `langId` + the **sorted** package list — `.md` ordering
  cannot mint a second entry for the same set.
- **Done when:** `ensureLibEnv(langId, libs)` returns the env dir path — building it on miss
  (per-language install argv from §2, `execFile`, cwd = env dir, own ~120 s budget), reusing it
  on hit, touching a `lastUsed` marker either way. **`ENOENT` maps to a named message** (*"npm
  not found — install Node.js to run library-backed exercises"*) — the entire toolchain-detection
  story. Builds go to `<key>.tmp-<pid>` then atomic-rename; the rename loser deletes its tmp.
- **Gate:** full gate.

### T13 — Runner wiring: `EnvContext.libDir`

- **Owns:** `src/services/test-envs/env.types.ts`, `src/services/leetcode-runner.service.ts`,
  `test/leetcode-runner.test.ts`
- **Depends on:** T11, T12
- **Test first:** an artifact with `libs` for the selected language reaches `env.emit` with
  `libDir` set; a failed env build fills every case with `install error: …`, exactly as a compile
  error does today.
- **Done when:** the runner resolves the env **before** `emit` (`libs` empty → `libDir`
  undefined, today's behaviour byte-for-byte); there is **no** `EmittedProgram.install` — a run
  either gets a ready directory or a mapped error.
- **Gate:** full gate.

### T14 — Java libraries: explicit non-support

- **Owns:** `src/services/test-envs/function/java.env.ts`, `test/function-env-java.test.ts`
- **Depends on:** T11
- **Test first:** `validate` on an artifact declaring `libs.java` returns *"Library-backed Java
  exercises are not supported yet — remove `libs.java` or solve this in another language."*
- **Done when:** the message reaches the panel via the existing contract-violation path — nothing
  written, nothing run.
- **Gate:** full gate.

### T15 — Panel: declared libraries

- **Owns:** `src/ui/panels/leetcodePreview.panel.ts`, `src/ui/leetcode-preview.css`
- **Depends on:** T11
- **Test first:** n/a (`vscode`-coupled); any pure rendering helper extracted here **is** unit
  tested.
- **Done when:** the selected language's libraries render as chips near the test-count line,
  every value through `escHtml`; switching language swaps them; no libs → no empty row.
- **Gate:** `pnpm lint`; F5 in T21.

### T16 — JavaScript and TypeScript libraries

- **Owns:** `src/services/test-envs/function/javascript.env.ts`,
  `src/services/test-envs/function/typescript.env.ts`, `test/function-env-javascript.test.ts`,
  `test/function-env-typescript.test.ts`
- **Depends on:** T13
- **Test first:** with `libDir` set, a candidate calling `require('lodash')` resolves; with
  `libDir` unset, emit output is byte-identical to Phase 1's.
- **Done when:** the sandbox's `require` is **replaced** by one from `module.createRequire()`
  rooted at `libDir`, so a candidate resolves the exercise's declared libraries instead of the
  runner's own resolution paths. TypeScript inherits unchanged — same env plus the strip call.
- **Gate:** full gate + the reviewer's manual security trace on this diff specifically (§3.1) —
  a `vm` sandbox is precisely the case no local rule set detects.

> **⚠️ This task's original premise was false and was corrected in wave 3.** It read: *"the
> sandbox gains a `require` … This is the sharp edge of the phase: the current env deliberately
> runs candidates in a bare `vm` context with no `require` at all."* Verified against the tree —
> [javascript.env.ts:72](../../../src/services/test-envs/function/javascript.env.ts#L72) builds
> `{ module, exports, console, require, process }` and the env's own JSDoc says it gives the
> solver `console` and `require`. There is no bare sandbox to widen; `require` and `process` are
> already there. T16 therefore **swaps** a `require`, it does not grant one — a materially
> smaller change than planned, and its "no `process`" clause was describing a restriction the
> code never had.
>
> **The real finding this exposed is bigger than T16** and is tracked separately (see the ledger,
> and §0's trust-class note): artifact-supplied `# Solutions` code reaches this sandbox through
> `candidateSource()`'s no-live-challenge fallback, so opening a third-party `.md` and pressing
> Submit executes its code with `require('child_process')` in scope. Node documents that `vm`
> **is not a security mechanism**, so removing `require` would not make this a boundary either.
> Do not let T16 masquerade as the fix for it.

### T17 — Python libraries (venv)

- **Owns:** `src/services/test-envs/function/python.env.ts`, `test/function-env-python.test.ts`
- **Depends on:** T13
- **Test first:** with `libDir` set, the run command invokes `<libDir>/bin/python3`; unset →
  byte-identical to today.
- **Done when:** the env consumes the venv T12 built. **Never `source activate` from a
  subprocess** — choosing the interpreter path *is* activation.
- **Gate:** full gate.

> Supersedes the earlier `pip install --target` sketch — `--target` does not isolate from system
> site-packages and breaks on entry points. A venv costs ~2 s, paid once per dependency set.

### T18 — Rust libraries (Cargo path)

- **Owns:** `src/services/test-envs/function/rust.env.ts`, `test/function-env-rust.test.ts`
- **Depends on:** T13, T6
- **Test first:** with no `libs.rust`, emit returns the bare `rustc` shape from T6 **unchanged**;
  with libs, a temp-dir Cargo project whose commands set `CARGO_TARGET_DIR=<libDir>/target` and
  build `--offline`.
- **Done when:** both paths pass; T6's asserts untouched. Sources stay per-run; only `target/` is
  shared (§2). `~/.cargo` is cargo's — never touched by us. Library-backed exercises may retire
  the `{:?}` ceiling via `serde_json`; the bare path keeps Debug — it still has no dependency to
  spend.
- **Gate:** full gate.

### T19 — Storage sweep + Clear Cache command

- **Owns:** `src/services/storage-sweep.service.ts`, a new command file in `src/commands/`,
  `package.json` (contribution), `test/storage-sweep.test.ts`
- **Depends on:** T12
- **Test first:** the sweep selects entries unused > 30 days, then oldest-first until under the
  size budget, and **never** selects a path outside `globalStorageUri`.
- **Done when:** sweep runs on `activate()`; `Obsidian Artifacts: Clear Exercise Cache` reports
  bytes reclaimed. **Retires existing debt:** `attempts/` files already accumulate — `CLAUDE.md`
  calls their cleanup "a future feature"; this is that feature, and one sweep service owning
  everything under `globalStorage` is one authority instead of two.
- **Gate:** full gate.

`ponytail:` ceilings — budget is a constant (2 GB), upgrade is a configuration contribution;
sweep-vs-live-run race across windows is accepted (a 30-day threshold makes it practically nil).

### T20 — Documentation (Phase 2)

- **Owns:** `ARTIFACT_LEETCODE_FILE_FORMAT.md`, `CLAUDE.md`
- **Depends on:** T10–T19
- **Test first:** n/a.
- **Done when:** `libs:` + reserved `test.runtime` specified with the allowlist rule;
  `CLAUDE.md`'s "No runtime dependencies" paragraph rewritten per §0; runner section documents
  env resolution, the build budget, and the sweep.
- **Gate:** `pnpm lint`.

### T21 — F5 manual pass (Phase 2) — human

- **Depends on:** T10–T20, E2–E5. Click-path against the wave-8 examples — E2 lodash (JS/TS),
  E3 numpy, E4 serde_json, E5 the `libs.java` negative — first run installs (progress visible),
  second run of the same set skips the install; chips render and swap with language; E5 shows
  the non-support message; Clear Exercise Cache reports bytes and the next run rebuilds.

---

## 5. Phase 2.5 — Classic test types

The taxonomy has **two levels**, and keeping them separate is what prevents a matrix explosion:

- **`test.type`** (frontmatter) — the *execution strategy* for the whole exercise. Extends the
  existing `TEST_TYPES` table and its `implemented | reserved` status field; nothing structural
  changes.
- **`check.kind`** (Phase 3, inside `project`/`service` only) — one *gradeable unit*. Its
  `CHECK_KINDS` table and registry are contract-level in §6.

| `test.type` | Class | Compares | Status after this phase |
|---|---|---|---|
| `function` | value | return value | implemented (5 languages) |
| `class` | value | the sequence of method-call results (LRUCache, MinStack) | **implemented** |
| `function` + `mutates` | value | the mutated argument, not the return | **implemented** |
| `stdin-stdout` | protocol | trimmed stdout for fed stdin | **implemented** |
| `project` / `service` | composite | all declared checks green | reserved until Phase 3/4 |

Three design decisions, settled here:

1. **`in-place` is retired as a type — it becomes the `mutates` modifier.** It executes
   *identically* to `function`; only the emitted value differs. `test.mutates: <paramName>` makes
   every function-env driver emit `canonicalJson(args[target])` instead of the return. This kills
   five would-be duplicate envs and keeps the registry honest: a type is an execution strategy,
   and in-place never was one. The reserved `in-place` id now parses to a pointer message
   (*"use `test.mutates` on type `function`"*).
2. **`class` reuses the sentinel protocol untouched.** One line per case; `actual` is the
   canonical JSON **array** of the op results (`[null,null,1]`). `parseSentinelLines` and the
   `canonicalJson` comparison need zero changes.
3. **`stdin-stdout` inverts one rule, locally.** The candidate **is** the program and *does* read
   stdin — the never-read-stdin rule is function-env-specific, not global. Consequence: one
   process **per case** (stdin is consumed once); compile still runs once per suite.

### Case shapes in the `.md`

````markdown
# class — ops sequence, one JSON object per case
```json
{"ops": ["LRUCache","put","put","get"], "args": [[2],[1,1],[2,2],[1]], "expected": [null,null,null,1]}
```

# mutation — frontmatter modifier, cases unchanged
test: { type: function, mutates: nums }

# stdin-stdout — raw text pairs
```json
{"stdin": "3\n1 2 3\n", "stdout": "6"}
```
````

### T22 — Parse the new case schemas

- **Owns:** `src/types/leetcode.types.ts`, `src/services/leetcode-parser.helpers.ts`,
  `test/leetcode-parser.test.ts`, `ARTIFACT_LEETCODE_FILE_FORMAT.md` (same-change rule)
- **Depends on:** T11 (last parser-file owner)
- **Test first:** the LRUCache ops case above parses into a typed `ClassCase`; an
  `ops`/`args`/`expected` length mismatch is a validation error naming the counts; malformed
  input degrades and never throws. Hostile input covered (security-critical: untrusted `.md`).
- **Done when:** three schemas parse and validate — class ops-sequence, `test.mutates: <param>`
  (must name a declared param), stdin/stdout string pairs. `type: in-place` yields the pointer
  message.
- **Gate:** full gate + the reviewer's manual security trace (§3.1).

### T23 — `makeClassEnv` factory

- **Owns:** `src/services/test-envs/class/make-class-env.ts`,
  `test/leetcode-class-env-factory.test.ts`
- **Reads:** `function/make-function-env.ts`, `sentinel.helpers.ts`
- **Depends on:** T22
- **Test first:** the factory returns `type: 'class'`, the two-file emit shape, and
  `parse === parseSentinelLines`.
- **Done when:** the factory owns type/emit-shape/parse; a language spec supplies only its driver
  source and validate — the exact `makeFunctionEnv` split.
- **Gate:** full gate.

### T24 — `class ×` python, javascript, typescript

- **Owns:** `src/services/test-envs/class/{python,javascript,typescript}.env.ts`,
  `test/class-env-{python,javascript,typescript}.test.ts`
- **Depends on:** T23
- **Test first:** the LRUCache case drives instantiation + method calls in order; a throwing op
  fails its case alone.
- **Done when:** three specs pass; TypeScript is the JS spec + the strip call, as in T7. (Sizing
  exception, deliberate: three ~80-line sibling specs are one cohesive concern; splitting buys
  three dispatches for no isolation gain.)
- **Gate:** full gate.

### T25 — `class ×` java, rust

- **Owns:** `src/services/test-envs/class/{java,rust}.env.ts`,
  `test/class-env-{java,rust}.test.ts`
- **Depends on:** T23
- **Test first:** as T24, compiled: `javac` / `rustc` once per suite.
- **Done when:** both specs pass; Rust's op results serialize under the same `{:?}` ceiling as
  T6.
- **Gate:** full gate.

### T26 — `mutates` in the function envs

- **Owns:** `src/services/test-envs/function/make-function-env.ts`, the five
  `function/*.env.ts` runner sources, `test/leetcode-inplace.test.ts`
- **Depends on:** T22
- **Test first:** with `mutates: nums`, the python driver emits the mutated `nums`, not the
  return; without the modifier, emit is byte-identical to today.
- **Done when:** all five drivers honour the modifier; the no-modifier path is untouched
  (golden-style asserts in the new test file).
- **Gate:** full gate.

### T27 — `stdin-stdout` environments + per-case runner loop

- **Owns:** `src/services/test-envs/stdio/make-stdio-env.ts`, `stdio/*.env.ts` (5 one-screen
  specs — run command only), `src/services/leetcode-runner.service.ts` (the per-case spawn
  loop), `test/function-env-stdio.test.ts`
- **Depends on:** T22
- **Test first:** a two-case suite spawns two processes, each fed its case's `stdin`, outputs
  compared **trimmed**; a hanging case times out alone (per-case budget) without killing the
  suite. Hostile stdin covered (security-critical).
- **Done when:** interpreted languages run the candidate file directly; compiled languages
  compile once, run per case; the candidate is written verbatim — `buildExecutable`
  normalisation explicitly bypassed for this type.
- **Gate:** full gate + the reviewer's manual security trace (§3.1).

### T28 — Documentation (Phase 2.5)

- **Owns:** `ARTIFACT_LEETCODE_FILE_FORMAT.md`, `CLAUDE.md`
- **Depends on:** T22–T27
- **Test first:** n/a.
- **Done when:** the format spec documents all three case shapes and the `mutates` modifier; the
  capability matrix gains `class` and `stdin-stdout` rows per language; the in-place retirement
  is recorded.
- **Gate:** `pnpm lint`.

### T29 — F5 manual pass (Phase 2.5) — human

- **Depends on:** T22–T28, E6–E8. Click-path against the wave-12 examples: E6 LRUCache `class`
  (one failing op fails one case), E7 `mutates` (the mutated array is graded, the return
  ignored), E8 `stdin-stdout` (the solver's own `print` **is** the answer — stdout is the
  comparison, not a sentinel corruption). Each in at least one interpreted and one compiled
  language.

---

## 6. Phase 3 — Multi-file / multi-language exercises (contract only)

**Goal:** an exercise opens N editor tabs — `App.tsx` + `styles.css`, or `main.py` + `schema.sql`
— and grades the whole directory.

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

| Seam | Today | Becomes |
|---|---|---|
| `EnvContext` | `code: string` | `files: ExerciseFile[]`; `code` kept as a derived getter so the five `function` envs need **no** change |
| `ChallengeSession` | one `tempFile: Uri` | `runDir: Uri` + `files: ExerciseFile[]` |
| Solve It | one file, one editor | write the tree, open every non-`hidden` file |
| Submit | read the live buffer | read every `editable` buffer, falling back to disk |
| `discardChallenge` | delete one file | delete the run directory |
| Test type | — | new `project` id in `TEST_TYPES` |

### No language selector — an aggregate runtime preflight

A `function` exercise picks one language; a **`project` exercise has no language to pick** — the
file set fixes its languages. Every single-language assumption breaks here: the selector,
`languagesForType`, `libs[selectedLanguage]`, `detectRuntime(one)`. Replacement: collect every
required runtime from file langIds + declared services, probe each, render a ✓/✗ list with
install hints in the panel. Solve It gates on all-green. The user configures nothing — they see
what is missing and nothing else.

**Multi-env per run:** FastAPI + React needs a venv **and** a node env in one exercise.
`ensureLibEnv(langId, libs)` is already per-language — the run resolves N envs, not one. No new
machinery.

### Grading — the `checks:` model

How a `project` exercise is graded is **declared in the artifact**, as a list of named checks,
each binding existing machinery to one target:

```yaml
test:
  type: project
  checks:
    - name: slugify unit        # reuses the five function envs, unchanged —
      kind: function            # the check layer reads this one file's buffer
      file: src/utils.ts        # as the candidate
      function: slugify
    - name: styles present
      kind: css-assert          # RESERVED — parses and validates, does not run
      file: src/styles.css
    - name: api returns list
      kind: http                # Phase 4 only — in-host fetch (see §7)
      service: api
```

- Test cases bind to checks with a fence attribute (`check=<name>`) in `## Tests`; a
  single-check exercise needs no attribute.
- **Solved = every check green.** The results table groups rows by check.
- **A file no check references is ungraded scaffolding, explicitly** — it exists for the solver
  (the CSS tab), not the grader. Honest limit: without a browser, CSS cannot be truly graded;
  `css-assert` (static selector/property presence) is **reserved**, not promised — a declared
  limit beats a fake grade.

**`CHECK_KINDS` — the second-level table** (`src/types/constants.ts`, same
`implemented | reserved` status pattern as `TEST_TYPES`; a `checkRunnerFor(kind)` registry
mirrors the env registry — absence **is** the capability matrix, no second table):

| kind | Class | Compares | Status |
|---|---|---|---|
| `function` | value | one file's export, via the existing five function envs | Phase 3 |
| `build` | structural | a declared build argv exits 0 (`["npx","tsc","--noEmit"]`, `vite build`); stderr tail on failure | Phase 3 |
| `http` | protocol | in-host `fetch` responses against a booted service | Phase 4 |
| `css-assert` | structural | static selector/property presence | reserved |
| `dom-assert` | behavioural | needs a browser — a separate decision, not a footnote | reserved |

`build` is the workhorse for React/TS exercises: a project that compiles catches most real
errors with no browser and no new machinery — the argv rules (allowlist on `argv[0]`,
`execFile`, cwd = runDir) are T10/T12's, reused. Reserved kinds parse, validate, and explain
themselves — the same self-explaining failure as a reserved `test.type`.

### Tab lifecycle — close one, end all (guarded)

Closing **any** exercise tab triggers a modal: *"This exercise uses N files. End the exercise
(discards this run) or reopen the tab?"* End → the full teardown: server process groups first,
then editor tabs, then the run directory. The guard exists because an accidental `Cmd+W`
mid-run must not silently destroy a 40-minute attempt and its booted servers.

- Watcher: `window.tabGroups.onDidChangeTabs`, filtered by runDir URI prefix — the
  generalisation of today's single-file `editorOpen` tracking.
- **What dies with the exercise:** the run directory, its tabs, its server process groups.
- **What survives, deliberately:** the shared lib envs — they are keyed by dependency set and
  shared across exercises; deleting one on close would make the next exercise re-pay a full
  install for nothing. They are reclaimed by the T19 sweep (age + size) or the explicit Clear
  Exercise Cache command.

**Security:** path traversal is the whole risk surface. Every `path` normalised and asserted
inside `runDir` **before** any write; absolute paths, `..` segments, symlink targets rejected at
parse time. `check.file` resolves against the parsed file set — a check naming a file outside it
is a parse error.

**Open questions to settle before task breakdown:** (1) does `buildExecutable`'s normalisation
stay `function`-only — current read yes; (2) Run Tests reads dirty buffers vs save-then-grade —
buffers truer, saving far simpler across N tabs; (3) per-file PracticeMode scope — current read
no, already global; (4) **real `tsc` arrives here** — `.tsx` cannot be type-stripped into a
working React app, so `project` exercises get a `typescript`-in-the-env compile step, the opt-in
path T7 deferred; (5) does Run Tests run *all* checks or accept a check filter (a solver
iterating on one file may not want the whole suite) — current read: all, filter later if slow.

---

## 7. Phase 4 — Running servers (contract only)

**Goal:** the exercise is a frontend consuming an API. The extension boots the backend, learns its
URL, and injects it into the frontend's config as a `hidden` file. The solver sees the endpoint
contract and the consumer code — never the wiring.

### Ports: don't pick an uncommon one, pick a free one

An "uncommon port" is still a guess, and a guess loses on the one machine where it's taken. Ask
the OS: bind port 0 on `127.0.0.1`, read back what the kernel assigned, close, template it into
the child. **Collision becomes structurally impossible rather than statistically unlikely.** The
small TOCTOU window between close and the child's bind is handled honestly — retry on
`EADDRINUSE` — rather than pretended away. Never bind `0.0.0.0`.

**We know the URL before the process starts because we assigned the port.** That is what makes
injection work: a dependent's env file can be written *before* it boots — load-bearing, because a
Next.js build bakes `NEXT_PUBLIC_*` at build time; an env file that lands late does nothing. It
also means `ready` is a plain readiness substring, not a URL-extracting regex.

```yaml
test:
  type: service
  runtime: local          # 'docker' reserved, not implemented
services:
  - name: api
    dir: server
    install: ["npm", "ci"]
    start:   ["node", "server.js", "--port", "${PORT}"]
    ready:   "listening"
    exposeAs:
      NEXT_PUBLIC_API_URL: "http://127.0.0.1:${PORT}"
  - name: web
    dir: client
    install: ["npm", "ci"]
    start:   ["npm", "run", "dev", "--", "--port", "${PORT}"]
    ready:   "ready"
    envFile: .env.local   # written role:hidden — the solver never sees it
    dependsOn: [api]
```

- `install` / `start` are **argv arrays** from the first line written; the T10 allowlist applies
  to `argv[0]`.
- `${PORT}` is templated into argv **and** injected as a `PORT` env var — one line each, and
  frameworks disagree about which they honour (`next dev` reads the env var, `uvicorn` wants
  `--port`, Express reads `process.env.PORT`).
- `exposeAs` maps *variable name → value template* — the author names what their framework wants
  (`NEXT_PUBLIC_*`, `VITE_*`, plain `API_URL`). **The extension encodes no framework knowledge.**
- `${PORT}` is the **only** substitution. No general templating — an expression language in an
  untrusted `.md` is an evaluator waiting to happen.
- `envFile` and `dir` are user paths → the Phase 3 traversal rule applies before any write.
- `dependsOn` orders the boot; a cycle is a parse error.

**Lifecycle:** assign all ports → boot in dependency order → wait for `ready` or a per-service
timeout → write each dependent's `envFile` **before it starts** → run the `http` checks → tear
everything down. Teardown fires on all **seven** exit paths — successful Submit, failed Submit,
End Challenge, panel dispose, `deactivate()`, extension-host crash-restart, and **any exercise
tab closed with "End" confirmed** (§6) — and kills the **process group**, not the pid: a dev
server forks children that survive a pid-level kill. This is the phase's real difficulty.

**Grading:** `http` checks (§6 `checks:` model) run **in the extension host itself** via global
`fetch` — the host is Node ≥ 18, so there is no spawned driver process, no extra runtime
requirement, and one less thing to kill on teardown. **No headless browser** — Playwright is a
~300 MB install the extension has no path to provide. Real DOM assertions are a later phase with
its own decision.

**Trust class, stated plainly for the format spec:** a service exercise executes `package.json`
scripts and declared argv commands from the artifact — arbitrary code by design, the same trust
class as running the solver's own candidate locally. The allowlist and argv rules bound the
*shape* of what runs; they do not, and cannot, make artifact-authored code safe. The spec must
say so rather than imply otherwise.

**Open questions to settle before task breakdown:** (1) where the install budget lives — a cold
`npm ci` on Next.js is minutes; likely a "preparing exercise" phase with its own progress and
cancellation; (2) do services share the T12 cache or get per-exercise `node_modules`; (3) what
the timer does while servers boot — grading time is not solving time, and `LeetCodeTimer` cannot
currently pause; (4) `ready`-miss fallback — poll the assigned URL (possible only because we know
it) with a timeout, then fail loudly **with** captured stdout; (5) is `--host 127.0.0.1` forced
on dev servers or left to the artifact; (6) does the §6 runtime preflight probe service runtimes
too (`uvicorn` present?) or only their `argv[0]` — current read: `argv[0]` per the `ENOENT` rule,
surfaced in the same ✓/✗ list.

---

## 8. Waves

Rules recap (full text in §1): orchestrator does its own rows and every integration hunk; worker
tasks in a wave own **disjoint files — test files and `package.json` included**; no task depends
on a task in its own wave; every worker task needs the wave's Opus reviewer to `APPROVE` before
integration (max 2 `CHANGES` rounds, `SEC:` findings never expire); gate + commit + ledger at
every wave close.

| Wave | Tasks | Agents | Orchestrator integration at close |
|---|---|---|---|
| 0 | T0 | orchestrator | — (golden must pass untouched) |
| 1 | T1 | orchestrator | — (`tsc` green gates all fan-out) |
| 2 | T2 · T3 · T5 · T30 | 4 × sonnet | — |
| 3 | T4 · T6 · T7 | 3 × sonnet | `register()` lines + imports for both envs in `env.registry.ts` |
| 4 | T8 · T10 · E1→E0 | 3 × sonnet **+ human T9** | — |
| 5 | T11 · T12 | 2 × sonnet | — |
| 6 | T13 · T14 · T15 | 3 × sonnet | — |
| 7 | T16 · T17 · T18 · T19 | 4 × sonnet | — |
| 8 | T20 · E2–E5 | 2 × sonnet **+ human T21** | — |
| 9 | T22 | 1 × sonnet | retire `in-place` entry in `TEST_TYPES` (constants) |
| 10 | T23 · T26 · T27 | 3 × sonnet | — |
| 11 | T24 · T25 | 2 × sonnet | `register()` lines for all class + stdio envs; flip `class` / `stdin-stdout` to `implemented` in `TEST_TYPES` |
| 12 | T28 · E6–E8 | 2 × sonnet **+ human T29** | — |

E-tasks (example artifacts) are specified in [examples.md](examples.md); the F5 gates consume
their exact artifacts — an F5 pass needing an exercise no E-task produced is a planning bug.

### Gate

```bash
rm -rf dist && pnpm compile && pnpm lint && \
  node node_modules/.pnpm/mocha@*/node_modules/mocha/bin/mocha.js --ui tdd "dist/test/**/*.test.js"
```

`rm -rf dist` is required — `tsc` leaves orphaned `dist/*.js`, and a stale compiled test inflates
the count. Also run `npx tsc --noEmit`. Baseline: **509 passing** (`93219e0`). Record the count
every run; a drop is a blocker until explained.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Widening `LangId` breaks `Record<LangId, …>` in files this plan did not name | T1 is serial; its done-condition is `tsc --noEmit` clean — the compiler enumerates the sites, not this document |
| Tree uncompilable between T1 and the real codegen rows | T1's stubs return `''`, the exact pre-widening fallback — compiling and behaviour-preserving by construction |
| `stripTypeScriptTypes` is experimental | Verified on local Node before planning; `detect()` gates the version; the `tsc` fallback arrives in Phase 3 regardless |
| Solver writes `enum` / decorators and hits a strip failure | T7 `validate` rejects non-erasable syntax with an honest message before anything runs |
| Rust `{:?}` invalid JSON for some return shape | Ceiling commented at the emit site; structs/enums out of scope until serde in T18 |
| Env build slow enough to feel broken | T12 cache + own budget; second run of a set skips install; T21 verifies |
| Two windows build the same env concurrently | `<key>.tmp-<pid>` + atomic rename; loser deletes its tmp |
| Widening the `vm` sandbox with `require` re-opens escape paths | T16 grants `require` only; reviewer's manual security trace on that diff specifically — no analyser in this repo performs taint analysis (§3.1) |
| Cache grows to gigabytes | T19 sweeps by age **and** size, plus an explicit command |
| Phase 3/4 contracts drift from what 1–2 build | Amended against the tree before breakdown — a starting position, not a commitment |
| Orphaned dev servers (Phase 4) | Process-group kill; teardown wired to all six exit paths |
| Plan files leak into `develop`/`main` | `git rm -r docs` is the final commit before the PR |

---

## 10. PR checklist

- [ ] Gate green, test count recorded and up
- [ ] `npx tsc --noEmit` clean
- [ ] IDE analyser diagnostics fixed on every non-trivial diff; **no-taint-analysis ceiling recorded** (§3.1)
- [ ] F5 passes recorded for T9 and T21
- [ ] `ARTIFACT_LEETCODE_FILE_FORMAT.md` updated in the same change as any format change
- [ ] `CLAUDE.md` invariants from §0 rewritten
- [ ] Jira stories created under VSX-122, keys filled in ledger + tickets file
- [ ] Anything worth keeping promoted out of `docs/` into `CLAUDE.md` / the format spec / JSDoc
- [ ] **`git rm -r docs` committed — the PR diff contains no `docs/` path**
