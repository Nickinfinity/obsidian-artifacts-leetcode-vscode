# Jira tickets — VSX-122

Epic: **[VSX-122 — Runnable languages & multi-environment LeetCode exercises](https://dexsys.atlassian.net/browse/VSX-122)** ✅ created
Plan: [plan.md](plan.md) · Ledger: [progress.md](progress.md)

The four phases are **story groups under one epic**, not four epics — one branch,
`feature/VSX-122_multilib-multilang-support`, one PR.

Stories below are **not yet created**. They are ready to create in the listed order, which is also
dependency order. Fill each `<KEY>` here and in the ledger as it lands. **Never fabricate a key** —
a placeholder is correct until the ticket exists.

Points are Fibonacci, sized against this repo's history: the services DRY refactor (467 → 509
tests) was roughly a 13.

---

## Phase 1 — Rust and TypeScript as runnable languages

### `<KEY>` · Extract per-language codegen into sibling modules · 3

`leetcode-codegen.service.ts` is 355 lines holding two dispatch tables *and* six per-language
template functions. Rust plus TypeScript push it past the 500-line split threshold in `CLAUDE.md`,
and force three otherwise-parallel stories to contend for one file. Extract `java` / `python` /
`javascript` templates into `src/services/codegen/*.codegen.ts`.

**AC** — Behaviour-preserving: `test/leetcode-codegen-golden.test.ts` passes **byte-identical and
unmodified**; editing a golden assertion invalidates the story. Test count unchanged. Gate green.

### `<KEY>` · Register `rust` and `typescript` in the language registry · 2

Add both to `LangId` and `LANGUAGES`. Rust: `detectCmd: 'rustc --version'`, ext `rs`. TypeScript:
`detectCmd: 'node --version'` — **not `tsc`**, because the default path never invokes a compiler.
Both land in one step; they widen the same union and splitting them pays the same breakage twice.

**AC** — `npx tsc --noEmit` clean. The existing consistency test covers both automatically
(`fileExt === LANG_EXT[id]`, every alias in `LANG_ALIAS`); if it does not, that is a bug in the
consistency test and is fixed here. Do not work from a predicted list of break sites — `tsc`
enumerates them.

### `<KEY>` · Rust literals in `jsonToLiteral` · 3

No Rust branch exists, so an array argument emits `[1, 2]` — a fixed-size `[i32; 2]`, not the
`Vec<i32>` the type mapping promises. TypeScript needs no branch; it falls through to the
JavaScript path, which is already correct.

**AC** — Arrays → `vec![…]`, nested → `vec![vec![1, 2]]`; strings → `String::from("…")`; objects →
`HashMap::from([…])`. Two ceilings carry `ponytail:` comments: empty `vec![]` cannot type-infer
standalone, and a `&str` parameter fails at compile rather than at `validate`.

### `<KEY>` · Rust codegen row · 3

`src/services/codegen/rust.codegen.ts` + the `LANG_CODEGEN.rust` row: a stdin wrapper carrying
`<<SOLUTION>>`, and an `assert_eq!`-based harness.

**AC** — `generateBoilerplate(parsed, 'rust')` contains `fn <name>(`, the `mapType`-derived
signature, exactly one `SOLUTION_MARKER`. Golden cases **added**, existing ones untouched.

### `<KEY>` · TypeScript type mapping and codegen row · 3

`PRIMITIVES` and `TYPE_SYNTAX` TypeScript columns (mirroring JavaScript's `number`/`string`/
`boolean`, `T[]`, `Record<K, V>`) plus `LANG_CODEGEN.typescript`.

**AC** — `mapType('map<string,int>', 'typescript') === 'Record<string, number>'`; boilerplate emits
a **typed** signature, which is the entire reason to offer TypeScript over JavaScript. The shared
`PRIMITIVES`/`TYPE_SYNTAX` hunk is landed by the orchestrator, not this story's agent.

### `<KEY>` · `function × rust` test environment · 5

Built via `makeFunctionEnv`. Candidate written **verbatim** as `solution.rs`; a generated
`runner.rs` declares `mod solution;` so `rustc` links it as a second compilation unit — the same
non-splicing model Java uses.

Settled, do not re-litigate: `rustc -O runner.rs -o runner` / `./runner`; `candidateContent`
rewrites a leading `fn <name>` → `pub fn <name>` with one anchored regex (module items need `pub`,
and demanding it from the solver is a hostile contract for a detail the driver invented);
`validate` rejects a candidate with no top-level `fn <name>(`; serialization is `{:?}` Debug with
**no serde**, since `Vec`, `String`, numbers, `bool` and `HashMap<String, _>` all Debug-print as
valid JSON and `canonicalJson` sorts key order extension-side; per-case isolation via
`panic::catch_unwind(AssertUnwindSafe(…))` with a no-op `panic::set_hook`; `flush()` per sentinel
line because Rust block-buffers a piped stdout.

**AC** — `emit` returns `['solution.rs', 'runner.rs']` with those commands. A panicking case
reports `error` for itself only. `languagesForType('function')` includes `rust`. The `{:?}` ceiling
carries a `ponytail:` comment naming serde as the upgrade path. Gate green **plus** an end-to-end
two-case Rust run via F5.

### `<KEY>` · `function × typescript` test environment · 3

This env is the JavaScript env plus one call:

```js
const js = require('node:module').stripTypeScriptTypes(fs.readFileSync('sol.ts', 'utf8'));
vm.runInContext(js, ctx);
```

**Verified working on Node v26.5.0 before being planned.** `stripTypeScriptTypes` blanks types
**with spaces**, preserving line and column offsets — so a runtime error still points at the
solver's real `.ts` line, which is why stripping beats transpiling here. No compiler, no install,
no compile step.

**AC** — Candidate written verbatim as `sol.ts`. `detect()` gates Node ≥ 22.18 / 23.10 with
*"TypeScript exercises need Node 22.18 or newer"*. `validate` rejects non-erasable syntax (`enum`,
`namespace`, parameter properties, decorators) with an honest message rather than a parse dump.
No type checking on this path, deliberately — grading is behavioural and the solver already gets
live errors from tsserver, because the temp file has a real `.ts` extension. Gate green + F5.

### `<KEY>` · Big-O heuristic: Rust loop and recursion patterns · 2

**AC** — A nested `for i in 0..n { for j in 0..n { … } }` classifies as `O(n²)` — **or** the story
closes as *Won't Do* with the finding that the heuristic is already language-agnostic, recorded in
the ledger. TypeScript needs nothing; its loop syntax is JavaScript's. Verify against the tree
before writing a branch to a matcher that never needed one.

### `<KEY>` · Document Rust and TypeScript support · 1

**AC** — Format spec lists both languages and both `function` pairs; `CLAUDE.md`'s "four rows"
section names the new `src/services/codegen/` layout and TypeScript's Node-version gate. Where doc
and parser disagree, the parser wins and the doc is corrected.

---

## Phase 2 — Libraries per exercise

### `<KEY>` · Parse the `libs:` block, reserve `test.runtime` · 3

**AC** — `ParsedLeetCode.libs` defaults to `{}`; a block parses to
`{ javascript: ['lodash@4.17.21'] }`; malformed input degrades to `{}` and never throws. Unknown
language keys dropped with a warning. `test.runtime` parses and validates with only `'local'`
implemented — `'docker'` reserved, self-explaining, exactly like a reserved `test.type`. Format
spec updated in the same change.

### `<KEY>` · Library-name allowlist · 3 · **Security**

Library names come from an untrusted `.md` and are the first user data in this codebase to reach a
subprocess as anything other than file contents. Validate against
`^@?[a-zA-Z0-9][a-zA-Z0-9._/-]*(@[a-zA-Z0-9.^~*+-]+)?$` at parse time.

**AC** — Pure, `vscode`-free, unit-tested; rejections name the offending entry. Hostile inputs
covered at minimum: `;rm -rf /`, `../../etc/passwd`, `-rf`, `--target=/etc`, empty string.
`sonar-analyze` clean.

### `<KEY>` · Install step in the emit contract and runner · 5

`EmittedProgram.install?: { cmd: string; args: string[] }`, run before `compile` with `execFile` —
**never `exec`**. `CLAUDE.md`'s rule that user data entering a command switches the call to an
argument array is now mandatory rather than hypothetical.

**AC** — Install runs before compile; failure fills every case with `install error: …`, exactly as
a compile error does. Own ~120 s budget, separate from `cases × timeoutMs`. **`ENOENT` maps to a
named message** (*"npm not found — install Node.js to run library-backed exercises"*) — that is the
entire toolchain-detection story, with no second probe table to drift.

### `<KEY>` · Environment cache keyed by dependency set · 3

`globalStorageUri/libenvs/<langId>-<sha256(langId + sorted pkgs)>/`. Keyed by **dependency set, not
by exercise**: thirty exercises using numpy share one environment, and conflicting version pins
hash apart automatically, so version conflict is structurally impossible rather than handled.

**AC** — Sorted package list in the key, so `.md` ordering cannot mint a duplicate entry. A hit
skips the install entirely. The service's only job is *build and hand back a directory* — what to
do with it belongs to each env.

### `<KEY>` · JavaScript and TypeScript libraries · 5 · **Security-sensitive**

Generated `package.json` + `npm install --prefix <env>`; the `vm` sandbox gets a `require` from
`module.createRequire()` rooted at the env. TypeScript inherits this unchanged — same env plus the
strip call.

**AC** — `require('lodash')` resolves inside the sandbox. The sandbox gains `require` **only** — no
`process`, no `fs`, no `child_process`. This is the sharp edge of the phase: the current env
deliberately runs the candidate in a bare `vm` context with no `require` at all. `sonar-analyze`
run specifically on this diff, clean. F5 verified.

### `<KEY>` · Python libraries via venv · 3

`python3 -m venv <env>` then `<env>/bin/pip install …`; the runner is invoked with the venv
interpreter. Supersedes the earlier `pip install --target` sketch — `--target` does not isolate
from system site-packages and breaks on entry points.

**AC** — The run command invokes `<env>/bin/python3`, not bare `python3`. **Never `source
activate` from a subprocess** — choosing the interpreter path *is* activation. F5 with a numpy
exercise.

### `<KEY>` · Rust libraries via a Cargo path · 5

With no `libs.rust`, the bare `rustc` shape is unchanged. With libs, a `Cargo.toml` + `src/`
layout built with cargo, `--offline` after first fetch.

**AC** — The bare path's emit output is **byte-identical** and its golden assertions untouched. A
`serde_json` exercise builds and runs. `~/.cargo/registry` is cargo's to manage — never touched by
our sweep. Library-backed exercises may retire the `{:?}` ceiling; the bare path keeps Debug
formatting because it still has no dependency to spend.

### `<KEY>` · Java libraries: explicit non-support · 1

Java has no *isolation* problem — the classpath is already per-invocation — it has a *resolution*
problem, and nothing in a stock JDK resolves transitive dependencies.

**AC** — `validate` on an artifact declaring `libs.java` returns *"Library-backed Java exercises
are not supported yet — remove `libs.java` or solve this in another language."*, reaching the panel
through the existing contract-violation path so nothing is written and nothing runs. When this is
eventually built: generate a `pom.xml` and shell out to `mvn dependency:copy-dependencies`, gated
on `mvn` being present. **Never hand-roll a Maven Central fetch** — it works until the first
library with transitive dependencies, at which point you are writing a POM resolver.

### `<KEY>` · Panel: show declared libraries · 2

**AC** — The selected language's libraries render as chips near the test-count line; switching
language swaps them; a language with no libs renders no empty row. Every value through `escHtml`.
Any pure rendering helper extracted here is unit-tested; the `vscode` layer stays a thin wire.

### `<KEY>` · Storage sweep and Clear Cache command · 3

numpy is ~60 MB and a Next.js `node_modules` ~300 MB; ten dependency sets is gigabytes, so
unbounded caching is not an option at this size class.

**This story also retires existing debt.** `attempts/` files already accumulate — `CLAUDE.md` calls
abandoned files *"an accepted trade-off; cleanup belongs to a future feature."* This is that
feature, and one sweep service owning everything under `globalStorage` is one authority instead of
two.

**AC** — A `lastUsed` marker is touched on every cache hit. The sweep runs on `activate()`,
selecting entries unused > 30 days, then oldest-first until under the size budget, and **never**
selects a path outside `globalStorageUri` (`~/.cargo` is not ours). `Obsidian Artifacts: Clear
Exercise Cache` reports bytes reclaimed. The constant budget carries a `ponytail:` comment naming
a configuration contribution as the upgrade path.

### `<KEY>` · Document library support · 2

**AC** — Format spec covers `libs:` with the allowlist rule and reserved `test.runtime`.
`CLAUDE.md`'s "No runtime dependencies" paragraph rewritten: *the extension ships zero
dependencies; an exercise may declare its own, installed into a cached environment using the
user's local toolchain.* Runner section documents the install step, its separate budget, and the
sweep.

---

## Phase 3 — Multi-file / multi-language exercises

### `<KEY>` · Spike: settle the multi-file contract · 5

Contract designed in plan §4: a `## Files` section with `path=` / `role=` fence attributes, an
`ExerciseFile` type, `EnvContext.code` widened to `files` (with `code` kept as a derived getter so
the five `function` environments need no change), and `ChallengeSession` moving from one temp file
to a run directory.

**Questions to answer against the real tree**

1. Does `buildExecutable`'s candidate normalisation stay `function`-only? (Current read: yes.)
2. Does Run Tests read every dirty buffer, or save-then-grade-from-disk? Reading buffers is truer
   to today's model; saving is far simpler across N tabs.
3. Does PracticeMode need per-file scope? (Current read: no — already global.)
4. This is where real `tsc` arrives: `.tsx` cannot be type-stripped into a working React app, so
   `project` exercises get a `typescript`-in-the-env compile step — the opt-in path the Phase 1
   TypeScript env deferred.

**Output** — plan §4 amended, then stories cut from it.

**Carried into every story that follows:** path traversal is the whole risk surface. Every declared
`path` is normalised and asserted to stay inside the run directory **before** any write; absolute
paths, `..` segments and symlink targets rejected at parse time.

---

## Phase 4 — Running servers

### `<KEY>` · Spike: settle the service-lifecycle contract · 8

Contract designed in plan §5: a `services:` block with argv-array `install` / `start`, `${PORT}`
templating, a `ready` substring, an `exposeAs` variable map, an `envFile` target, and `dependsOn`
ordering.

**Two decisions already taken**

- **Ports are assigned by the OS, not chosen.** Bind port 0 on `127.0.0.1`, read back what the
  kernel gave, close, then template it into the child's argv and inject it as `PORT`. An
  "uncommon port" is still a guess; this makes collision structurally impossible. Retry on
  `EADDRINUSE` covers the small TOCTOU window honestly rather than pretending it isn't there.
  Never bind `0.0.0.0` — an exercise server has no business being reachable from the network.
- **No headless browser.** Grading is `fetch`-based assertions from a generated Node driver.
  Playwright is a ~300 MB install the extension has no path to provide.

**Questions to answer**

1. Where does the install budget live? A cold `npm ci` on Next.js is minutes, far beyond any
   grading timeout — likely a separate "preparing exercise" phase with its own progress and
   cancellation.
2. Do services share the environment cache, or does `node_modules` per exercise get its own?
3. What does the timer do while a server boots? Grading time is not solving time, so the clock
   almost certainly must pause — which `LeetCodeTimer` cannot currently do.
4. Fallback when `ready` never matches: poll the assigned URL, or fail with captured stdout?
   Polling is *possible* only because we already know the URL, which we would not if the URL came
   from stdout.

**Output** — plan §5 amended, then stories cut from it.

### `<KEY>` · Service teardown guarantee · 5

The hardest part of this phase is not booting a server — it is making sure one never survives the
window that spawned it.

**AC** — Teardown fires on **all six** exit paths: successful Submit, failed Submit, End
Challenge, panel dispose, `deactivate()`, and extension-host crash-restart. The **process group**
is killed, not the pid — a Node dev server forks children that survive a pid-level kill. Verified
manually: no orphaned process holds a port after each of the six paths.

---

## Creation order

Phase 1 stories → Phase 2 stories → Phase 3 spike → Phase 4 spike + teardown. All parented to
VSX-122. Fill each `<KEY>` here and in the matching [progress.md](progress.md) row as it is created.
