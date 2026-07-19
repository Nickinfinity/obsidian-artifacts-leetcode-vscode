# Jira tickets — VSX-122

Epic: **[VSX-122 — Runnable languages & multi-environment LeetCode exercises](https://dexsys.atlassian.net/browse/VSX-122)** ✅ created
Authority: [plan.md](plan.md) — **this file is a paste-ready view of its tasks; on any
disagreement the plan wins and this file is the bug.** Same T-ids as the plan and ledger.

Stories are **not yet created**. Create in listed order (= dependency order), all parented to
VSX-122; fill each `<KEY>` here and in the ledger row. **Never fabricate a key.**

Points are Fibonacci, sized against repo history (the services DRY refactor, 467 → 509 tests,
was roughly a 13).

---

## Phase 1 — Rust and TypeScript as runnable languages

### `<KEY>` · T0 Extract per-language codegen into sibling modules · 3

`leetcode-codegen.service.ts` (355 L) holds two dispatch tables and six per-language template
functions; two new languages push it past the 500-line split threshold and make every Phase 1
task contend for one file. Extract `java`/`python`/`javascript` templates into
`src/services/codegen/*.codegen.ts`.

**AC** — Behaviour-preserving: golden test passes **byte-identical and unmodified**. Test count
unchanged. Gate green.

### `<KEY>` · T1 Widen the language registry with stubs · 3

Add `rust` + `typescript` to `LangId`/`LANGUAGES` (rust: `rustc --version`/`rs`; typescript:
`node --version`/`ts` — **node, not tsc**: the default path never invokes a compiler). Add the
TypeScript `PRIMITIVES`/`TYPE_SYNTAX` columns. Land **stub** `rust.codegen.ts` /
`typescript.codegen.ts` returning `''` — the exact pre-widening fallback — with their
`LANG_CODEGEN` rows, so the tree compiles and behaves identically until the real templates land
and later tasks own only their sibling file.

**AC** — `npx tsc --noEmit` clean; consistency test covers both languages (fixed here if it does
not). Neither language user-visible yet — the selector is driven by the env registry, which has
no envs until T6/T7.

### `<KEY>` · T2 Rust literals in `jsonToLiteral` · 3

No Rust branch exists: arrays emit `[1, 2]` — a fixed-size `[i32; 2]`, not the `Vec<i32>` the
type mapping promises. TypeScript needs no branch (falls through to the JS path).

**AC** — Arrays → `vec![…]` (nested `vec![vec![1, 2]]`); strings → `String::from("…")`; objects →
`HashMap::from([…])`; `null` → `None`. Two `ponytail:` ceilings at the emit site: empty `vec![]`
cannot type-infer; `&str` params fail at compile, not `validate`.

### `<KEY>` · T3 TypeScript codegen row · 3

Replace the T1 stub in `typescript.codegen.ts`. Boilerplate emits a **typed** signature from
`mapType` — the entire reason to offer TypeScript over JavaScript.

**AC** — `generateBoilerplate(parsed, 'typescript')` contains the mapped signature and exactly one
`SOLUTION_MARKER`. Golden-style asserts live in `test/leetcode-codegen-typescript.test.ts` — its
**own** file, never appended to the shared golden file.

### `<KEY>` · T4 Rust codegen row · 3

Replace the T1 stub in `rust.codegen.ts`: stdin wrapper (`std::io::stdin().read_line`) carrying
`<<SOLUTION>>`; `assert_eq!` harness. Depends on T2 — the harness renders case args through
`jsonToLiteral(…, 'rust')`.

**AC** — Boilerplate contains `fn <name>(`, mapped signature, one marker. Asserts in
`test/leetcode-codegen-rust.test.ts`, own file.

### `<KEY>` · T5 Big-O heuristic: Rust patterns · 2

**AC** — Nested `for i in 0..n { for j in 0..n { … } }` classifies `O(n²)` — **or** the story
closes *Won't Do* with the finding that the heuristic is already language-agnostic, recorded in
the ledger. Verify against the tree before writing a branch a matcher never needed. TypeScript
needs nothing.

### `<KEY>` · T6 `function × rust` test environment · 5

Via `makeFunctionEnv`. Candidate **verbatim** as `solution.rs`; generated `runner.rs` declares
`mod solution;` — `rustc` links two units, the Java model, never splicing.

Settled, do not re-litigate: `rustc -O runner.rs -o runner` / `./runner`; leading `fn <name>` →
`pub fn <name>` by one anchored regex (module items need `pub`; demanding it from the solver is a
hostile contract for a driver-invented detail); `validate` rejects no-top-level-`fn` with the
Python env's message shape; `{:?}` Debug serialization, **no serde** (all supported shapes
Debug-print valid JSON; `canonicalJson` sorts HashMap order extension-side; `ponytail:` ceiling —
no structs/enums, upgrade serde via T18); `panic::catch_unwind` per case with a no-op
`panic::set_hook`; `flush()` per sentinel line (Rust block-buffers piped stdout).

**AC** — `emit` returns `['solution.rs', 'runner.rs']` with those commands; a panicking case
fails alone. **Registration is the orchestrator's** (`env.registry.ts` is single-writer);
afterwards `languagesForType('function')` = `['java','javascript','python','rust','typescript']`.
End-to-end two-case run verified in T9.

### `<KEY>` · T7 `function × typescript` test environment · 3

The JavaScript env plus one call — **verified on Node v26.5.0 before planning**:

```js
const js = require('node:module').stripTypeScriptTypes(fs.readFileSync('sol.ts', 'utf8'));
vm.runInContext(js, ctx);
```

`stripTypeScriptTypes` blanks types **with spaces** — line/column offsets survive, so runtime
errors point at the solver's real `.ts` line. No compiler, no install, no compile step.

**AC** — Candidate verbatim as `sol.ts`. `detect()` gates Node ≥ 22.18/23.10 (*"TypeScript
exercises need Node 22.18 or newer"*). `validate` rejects non-erasable syntax (`enum`,
`namespace`, parameter properties, decorators) with an honest message. No type checking,
deliberately — tsserver gives live errors via the real `.ts` extension; opt-in `tsc` is Phase 3.
Registration = orchestrator.

### `<KEY>` · T8 Document Rust and TypeScript support · 1

**AC** — Format spec lists both languages + both `function` pairs; `CLAUDE.md`'s "four rows"
section names `src/services/codegen/` and the Node-version gate. Parser wins over doc.

### `<KEY>` · T9 F5 manual pass, Phase 1 · 1 · **human**

**AC** — Plan §3 T9 click-path, run twice (Rust, TypeScript): solve → run → one broken case fails
alone → submit → solved + meta, settings restored. Missing `rustc` and old Node produce their
named messages, never a compiler dump.

---

## Phase 2 — Libraries per exercise

### `<KEY>` · T10 Library-name allowlist · 3 · **Security**

First user data in this codebase to reach a subprocess as anything but file contents. Pure
validator: `^@?[a-zA-Z0-9][a-zA-Z0-9._/-]*(@[a-zA-Z0-9.^~*+-]+)?$`.

**AC** — Pure, `vscode`-free; rejections name the entry. Hostile inputs covered: `;rm -rf /`,
`../../etc/passwd`, `-rf`, `--target=/etc`, empty string. `sonar-analyze` clean. Wiring into the
parser belongs to T11, not here.

### `<KEY>` · T11 Parse `libs:`, reserve `test.runtime` · 3

**AC** — `ParsedLeetCode.libs` defaults `{}`; malformed degrades to `{}` and never throws;
allowlist failures surface as parse warnings naming the entry; unknown language keys dropped with
a warning. `test.runtime` parses with only `'local'` implemented — `'docker'` reserved and
self-explaining, like a reserved `test.type`. Format spec updated in the same change.

### `<KEY>` · T12 Library-environment cache service · 5

`ensureLibEnv(langId, libs)` → env dir at
`globalStorageUri/libenvs/<langId>-<sha256(langId + sorted pkgs)>/`. **Installs happen here, at
env build** — `execFile`, cwd = env dir, own ~120 s budget — not per run. Keyed by dependency
set: shared envs, conflicting pins hash apart, version conflict structurally impossible.

**AC** — Sorted list in the key. Hit skips install and touches `lastUsed`. **`ENOENT` → named
message** (*"npm not found — install Node.js to run library-backed exercises"*) — the whole
toolchain-detection story, no probe table. Build into `<key>.tmp-<pid>`, atomic rename, loser
deletes its tmp (two windows share `globalStorage`). Re-validates names via T10 on entry.

### `<KEY>` · T13 Runner wiring: `EnvContext.libDir` · 3

**AC** — Runner resolves the env **before** `emit`; `libs` empty → `libDir` undefined and
behaviour byte-identical to today. Failed build fills every case with `install error: …`, as a
compile error does. **No `EmittedProgram.install`** — a run gets a ready directory or a mapped
error.

### `<KEY>` · T14 Java libraries: explicit non-support · 1

Java has no isolation problem (classpath is per-invocation); it has a resolution problem, and a
stock JDK resolves nothing transitive.

**AC** — `validate` on `libs.java`: *"Library-backed Java exercises are not supported yet —
remove `libs.java` or solve this in another language."* via the contract-violation path — nothing
written, nothing run. Someday: `mvn dependency:copy-dependencies` gated on `mvn`; **never** a
hand-rolled Maven Central fetch (it works until the first transitive dependency, then you are
writing a POM resolver).

### `<KEY>` · T15 Panel: declared libraries · 2

**AC** — Selected language's libs render as chips near the test-count line; switch swaps; no libs
→ no empty row; every value through `escHtml`. Pure helpers extracted here are unit-tested; the
`vscode` layer stays a thin wire. Verified in T21.

### `<KEY>` · T16 JavaScript and TypeScript libraries · 5 · **Security-sensitive**

**AC** — With `libDir`, `require('lodash')` resolves via `module.createRequire()` rooted at the
env; without, emit is byte-identical to Phase 1. Sandbox gains `require` **only** — no `process`,
`fs`, `child_process`. The sharp edge of the phase: today's env deliberately has no `require` at
all. `sonar-analyze` on this diff specifically, clean. TypeScript inherits unchanged.

### `<KEY>` · T17 Python libraries via venv · 3

**AC** — Run command invokes `<libDir>/bin/python3`, not bare `python3`; unset → byte-identical.
**Never `source activate` from a subprocess** — the interpreter path *is* activation. (Supersedes
`pip --target`: no isolation from system site-packages, breaks entry points.)

### `<KEY>` · T18 Rust libraries via Cargo · 5

**AC** — No `libs.rust` → bare `rustc` shape from T6 **unchanged**, asserts untouched. With libs:
per-run temp Cargo project (sources never copied into the shared cache — that would mutate it per
run), `CARGO_TARGET_DIR=<libDir>/target` shares incremental builds (cargo does its own locking),
`--offline` after first fetch. `~/.cargo` is cargo's — never touched. Serde may retire the `{:?}`
ceiling on this path only.

### `<KEY>` · T19 Storage sweep + Clear Cache command · 3

numpy ~60 MB, Next.js `node_modules` ~300 MB — ten sets is gigabytes; unbounded caching is not an
option at this size class. **Retires existing debt:** `attempts/` cleanup, which `CLAUDE.md`
deferred to "a future feature" — this is that feature; one sweep service owning everything under
`globalStorage` is one authority instead of two.

**AC** — `lastUsed` touched on every hit; sweep on `activate()`: unused > 30 days, then
oldest-first under the size budget; **never** a path outside `globalStorageUri`. `Obsidian
Artifacts: Clear Exercise Cache` reports bytes reclaimed. `ponytail:` — budget is a 2 GB
constant; upgrade is a configuration contribution.

### `<KEY>` · T20 Document library support · 2

**AC** — Format spec: `libs:` + allowlist rule + reserved `test.runtime`. `CLAUDE.md`
no-runtime-deps paragraph rewritten (*extension ships zero; exercises declare their own,
installed into a cached environment via the user's toolchain*). Runner section documents env
resolution, build budget, sweep.

### `<KEY>` · T21 F5 manual pass, Phase 2 · 1 · **human**

**AC** — Plan §4 T21 click-path: lodash/numpy/serde_json exercises run green; first run installs
visibly, second hits cache; chips swap with language; `libs.java` shows its message; Clear Cache
reports bytes and next run rebuilds.

---

## Phase 3 — Multi-file / multi-language exercises

### `<KEY>` · Spike: settle the multi-file contract · 5

Contract in plan §5: `## Files` with `path=`/`role=` fence attributes; `ExerciseFile`;
`EnvContext.code` → `files` with `code` as a derived getter (five `function` envs unchanged);
`ChallengeSession` → run directory.

Already designed in the contract — validate, don't reinvent:

- **No language selector.** A `project` exercise's languages are fixed by its file set; the
  selector is replaced by an aggregate runtime preflight (✓/✗ per required runtime, install
  hints, Solve It gates on all-green). Multi-env per run: `ensureLibEnv` is per-language; a
  FastAPI + React exercise resolves a venv **and** a node env.
- **Grading = the `checks:` model.** Named checks in the artifact bind machinery to targets;
  `kind: function` reuses the five function envs against one file's buffer; cases bind via
  `check=<name>` fence attribute; solved = every check green; unreferenced files are ungraded
  scaffolding, explicitly; `css-assert` is **reserved** — a declared limit beats a fake grade.
- **Tab lifecycle.** Closing any exercise tab → modal (end or reopen); End → full teardown:
  processes, tabs, run dir. Shared lib envs survive by design — reclaimed by sweep or Clear
  Cache, never by exercise close. Watcher: `window.tabGroups.onDidChangeTabs` filtered by
  runDir prefix.

**Answer against the real tree:** (1) `buildExecutable` normalisation stays `function`-only?
(2) dirty buffers vs save-then-grade across N tabs; (3) per-file PracticeMode scope (current
read: no); (4) real `tsc` arrives here — `.tsx` cannot be type-stripped into a working app; the
opt-in compile path T7 deferred; (5) Run Tests: all checks or a check filter.

**Output:** plan §5 amended, stories cut from it. **Carried into every story:** path traversal is
the whole risk surface — normalise + assert containment before any write; absolute, `..`, and
symlink targets rejected at parse; a `check.file` outside the parsed file set is a parse error.

---

## Phase 4 — Running servers

### `<KEY>` · Spike: settle the service-lifecycle contract · 8

Contract in plan §6: `services:` with argv-array `install`/`start`, `${PORT}` templating (argv
**and** env var — frameworks disagree), `ready` substring, `exposeAs` variable→template map (the
extension encodes no framework knowledge), `envFile` written as a Phase-3 `hidden` file **before**
the dependent boots (Next.js bakes `NEXT_PUBLIC_*` at build time), `dependsOn` ordering.

Already decided: **OS-assigned ports** (bind 0 on `127.0.0.1`, read back, retry `EADDRINUSE` for
the TOCTOU window; never `0.0.0.0`) — we know the URL before boot, which is what makes injection
work. **`http` checks run in the extension host itself** via global `fetch` (host is Node ≥ 18) —
no spawned driver, no extra runtime, one less thing to kill. **No headless browser.** Teardown
has **seven** paths — the six lifecycle ones plus any-exercise-tab-closed-with-End-confirmed.
**Trust class stated in the spec:** a service exercise executes artifact-authored scripts —
arbitrary code by design, same trust class as running the solver's candidate; the allowlist
bounds the shape of what runs, it does not make artifact code safe.

**Answer:** (1) install budget / "preparing exercise" phase with progress + cancellation;
(2) share the T12 cache or per-exercise `node_modules`; (3) timer pause during boot
(`LeetCodeTimer` cannot currently pause); (4) `ready`-miss fallback — poll the known URL with
timeout, then fail loudly **with** captured stdout; (5) force `--host 127.0.0.1` or leave to the
artifact; (6) preflight service runtimes via `argv[0]` in the same ✓/✗ list.

**Output:** plan §6 amended, stories cut from it.

### `<KEY>` · Service teardown guarantee · 5

The hard part is not booting a server — it is making sure one never survives the window that
spawned it.

**AC** — Teardown fires on **all six** exit paths: successful Submit, failed Submit, End
Challenge, panel dispose, `deactivate()`, extension-host crash-restart. **Process group** killed,
not the pid — dev servers fork children that survive a pid-level kill. Verified manually: no
orphaned process holds a port after each path.

---

## Creation order

Phase 1 (T0–T9) → Phase 2 (T10–T21) → Phase 3 spike → Phase 4 spike + teardown. All parented to
VSX-122. Fill each `<KEY>` here and in the matching [progress.md](progress.md) row as created.
