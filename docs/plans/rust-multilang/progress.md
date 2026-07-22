# Progress — VSX-122

Epic: **[VSX-122](https://dexsys.atlassian.net/browse/VSX-122)** ·
Branch: `feature/VSX-122_multilib-multilang-support` · Authority: [plan.md](plan.md)

**Owner of this file: the orchestrator only.** Workers report; they never edit the ledger, or two
of them race on the same table.

Gate baseline at branch point: **509 passing** (`93219e0`, post-PR-#2).

---

## Status

`todo` · `wip` · `done` · `blocked` · `dropped` (with the reason)

### Phase 1 — Rust and TypeScript as runnable languages

| Task | Wave | Agent | Jira | Status | Tests | Gate | Notes |
|------|------|-------|------|--------|-------|------|-------|
| T0 — extract per-language codegen | 0 | orchestrator | `<KEY>` | **done** | 509 → 509 | pass | Golden net passed **untouched**. Import cycle service↔codegen verified safe from both entry directions (`9165306`) |
| T1 — widen registry, stubs wired | 1 | orchestrator | `<KEY>` | **done** | 509 → 511 | pass | Stubs return `''`; `tsc --noEmit` clean. Only `Record<LangId,…>` site was `LANG_CODEGEN` — no hidden fan-out (`5721f1e`) |
| T2 — `jsonToLiteral` Rust branch | 2 | sonnet | `<KEY>` | **done** | → 551 | pass | **2 review rounds.** `CHANGES`: JSON escaping emits `\b`/`\f`/unbraced `\uXXXX` — all rustc errors (reviewer proved with real `rustc`); `undefined` left non-rust while `null` was fixed. Both closed via char-by-char `rustEscape` |
| T3 — TypeScript codegen row | 2 | sonnet | `<KEY>` | **done** | → 551 | pass | 1 round. Out-of-Owns edit to `leetcode-exercise-file.test.ts` — accepted, then **replaced** by orchestrator (see Decisions: it was a wave-3 landmine) |
| T5 — big-O Rust patterns | 2 | sonnet | `<KEY>` | **done** | → 551 | pass | **NOT dropped** — premise was wrong. Orchestrator found 3 further defects post-report (`loop {}`, labels, and `'` stripping) and resolved them inline |
| T4 — Rust codegen row | 3 | sonnet | `<KEY>` | **APPROVE** | → 612 | pass | 0 rounds. Compiled boilerplate+harness with real `rustc`; harness panicked on a wrong candidate. No live sink (Layer-1 stdin wrapper never runs inside a driver). Escalated the golden-file conflict correctly |
| T6 — `function × rust` env | 3 | sonnet | `<KEY>` | **done (APPROVE, R2)** | → 617 | pass | **Security-critical.** R1 → 2 SEC findings; R2 both fixed. (1) `RUST_IDENT_RE` guard in `validate`; (2) `__quote` now escapes `\b`/`\f`/`U+00XX`. **Orchestrator independently re-verified escaping vs `JSON.stringify` across all `0x00–0x1f` + backslash/quote/astral — byte-identical.** Java `__quote` has the same gap → follow-up ticket (out of Owns) |
| T7 — `function × typescript` env | 3 | sonnet | `<KEY>` | **APPROVE** | → 612 | pass | 0 rounds. **Security-critical.** Sandbox byte-identical to JS env — no widening, `stripTypeScriptTypes`/`node:module` never exposed. `validate` deviation ratified (native strip errors reach the user via the sentinel `error` path — reviewer proved it with a real subprocess; a `validate` false-reject would be strictly worse). `detect()` boundaries correct |
| T30 — recursive exercise discovery | 2 | sonnet | `<KEY>` | **done** | → 551 | pass | **Security-critical — APPROVE, 0 rounds.** Symlinked dirs never descended (`readDir` never invoked); hostile test spy-counts non-invocation and would surface a planted `secrets.md`. Logic in the pure `vscode`-free helper, command layer a thin closure |
| T8 — docs Phase 1 | 4 | sonnet | `<KEY>` | **done (APPROVE)** | 636 | green | Both docs updated for 5 langs; retired the stale "Rust not runnable" claim. Reviewer traced every claim to the tree incl. Node floors to the digit. + orchestrator doc-bug hunk (inline `params` form). Sonar paragraph preserved |
| T10 — library-name allowlist | 4 | orch (worker dead) | `<KEY>` | **done (APPROVE, R2)** | → 632 | green | **Security-critical.** Cold review found a real `SEC:` hole the orchestrator's own read missed: embedded `..` (`a/../../etc`) matched. Worker session-dead → orchestrator fixed per ESCALATE: `isAllowedLibName` = regex `&& !name.includes('..')`, +4 hostile tests. **Reviewer re-verified closed against `dist/`** and APPROVE. Also corrected the rationale: stop at `..` because it is the escape vector (not a slash-count rule — `@babel/plugin-transform-runtime` has one slash and is valid). Awaiting wave-close commit |
| T9 — F5 Phase 1 | 4 | **human** | `<KEY>` | **awaiting human** | — | — | Deployed to vault `functions/` (user asked for plural; repo stays `function/`). Vault: `functions/arrays/two-sum.md`, `functions/strings/{is-anagram,leetcode-ab-check}.md` — root ab-check duplicate removed (byte-identical, move complete). rustc 1.81.0 + node v26.5.0 both present. **User runs F5 twice (Rust, TypeScript); orchestrator records result, never self-marks** |

### Phase 2 — Libraries per exercise

| Task | Wave | Agent | Jira | Status | Tests | Gate | Notes |
|------|------|-------|------|--------|-------|------|-------|
| T10 — library-name allowlist | 4 | sonnet | `<KEY>` | todo | — | — | Pure, no deps — runs alongside T8/T9. **Security-critical** |
| T11 — parse `libs:`, reserve `test.runtime` | 5 | sonnet | `<KEY>` | todo | — | — | Wires T10 into the parser; format doc same-change |
| T12 — lib-env cache service | 5 | sonnet | `<KEY>` | todo | — | — | Installs happen **here**, at env build; `ENOENT` → named message; atomic rename |
| T13 — runner wiring `EnvContext.libDir` | 6 | sonnet | `<KEY>` | todo | — | — | No `EmittedProgram.install`; no-libs path byte-identical |
| T14 — Java libs non-support | 6 | sonnet | `<KEY>` | todo | — | — | Contract-violation path, honest message |
| T15 — panel lib chips | 6 | sonnet | `<KEY>` | todo | — | — | `vscode`-coupled; F5 in T21 |
| T16 — JS + TS libraries | 7 | sonnet | `<KEY>` | todo | — | — | Sandbox gains `require` **only** |
| T17 — Python libraries (venv) | 7 | sonnet | `<KEY>` | todo | — | — | Invoke `<env>/bin/python3`; never `source activate` |
| T18 — Rust libraries (Cargo) | 7 | sonnet | `<KEY>` | todo | — | — | Per-run sources + shared `CARGO_TARGET_DIR`; bare path untouched |
| T19 — storage sweep + Clear Cache | 7 | sonnet | `<KEY>` | todo | — | — | Absorbs `attempts/` cleanup debt; owns `package.json` this wave |
| T20 — docs Phase 2 | 8 | sonnet | `<KEY>` | todo | — | — | Rewrites the no-runtime-deps invariant |
| T21 — F5 Phase 2 | 8 | **human** | `<KEY>` | todo | — | — | Install → cache-hit → chips → java message → clear cache |

### Phase 2.5 — Classic test types

| Task | Wave | Agent | Jira | Status | Tests | Gate | Notes |
|------|------|-------|------|--------|-------|------|-------|
| T22 — parse new case schemas | 9 | sonnet | `<KEY>` | todo | — | — | **Security-critical** (untrusted `.md`); `in-place` → pointer message |
| T23 — `makeClassEnv` factory | 10 | sonnet | `<KEY>` | todo | — | — | Sentinel protocol reused untouched |
| T26 — `mutates` in function envs | 10 | sonnet | `<KEY>` | todo | — | — | No-modifier path byte-identical |
| T27 — stdio envs + per-case runner loop | 10 | sonnet | `<KEY>` | todo | — | — | **Security-critical** (per-case stdin); one process per case |
| T24 — class × py/js/ts | 11 | sonnet | `<KEY>` | todo | — | — | Sizing exception noted in plan |
| T25 — class × java/rust | 11 | sonnet | `<KEY>` | todo | — | — | Compile once per suite |
| T28 — docs Phase 2.5 | 12 | sonnet | `<KEY>` | todo | — | — | Case shapes + `mutates` + capability matrix |
| T29 — F5 Phase 2.5 | 12 | **human** | `<KEY>` | todo | — | — | class + mutates + stdio, interpreted **and** compiled |

### Example artifacts (E-tasks — [examples.md](examples.md))

| Task | Wave | Agent | Jira | Status | Notes |
|------|------|-------|------|--------|-------|
| E1 · E11 → E0 — two-sum + is-anagram (5 langs) + fixtures test + README + ab-check migration | 4 | sonnet | `<KEY>` | **done (APPROVE)** | 628 → 636 | green | All 5 langs of E1+E11 executed against 2 public + 2 hidden (real rustc/node/python3/openjdk), all green — reviewer re-ran reference solns against **hidden** cases + traced `## TS`→typescript through all 5 consumers. E0 recursive, red-empty confirmed. Accepted deviation: **ab-check has 0 hidden** (faithful relocation of a public-only artifact; `submitSuite` falls back to public) — carry into the T9 handoff |
| E2–E5 — lodash · numpy · serde_json · java-negative | 8 | sonnet | `<KEY>` | todo | Under `function/libs/`; T21 clicks through these exact files |
| E6–E8 — lru-cache · mutates · stdio | 12 | sonnet | `<KEY>` | todo | T29 material; interpreted + compiled each |
| E9 · E10 · E12 — react project · fastapi+react · node+react (TS) | spike | orchestrator | `<KEY>` | **done (artifacts only)** | Pulled forward on user request. E9 rescoped: Next.js object-list page (route handler + server component) instead of react-counter — same `project` contract, closer to a real exercise. All three parse clean (645 passing); `project` + `service` added to `TEST_TYPES` as **reserved** so they list and self-explain instead of degrading to `function`. **Nothing runs** — Phases 2/3/4 are still unimplemented. Contract gaps found while authoring: [spike-findings.md](spike-findings.md) — 8 items, 2 of them (case↔check binding, per-check `params`) must be settled **before** Phase 3 breakdown |

Vault deployment: repo `examples/leetcode/` is the source of truth; the F5 gates copy it to
`/Users/nick/N0t3s/C0d3-Sn1pp3ts/LeetCode/` (taxonomy in [examples.md](examples.md); requires
T30's recursive picker).

### Phases 3–4

Contract-only (plan §6–§7, incl. the `CHECK_KINDS` second-level table). After Phase 2.5 closes,
the orchestrator amends the contracts against the tree, then **stops and presents** — breakdown
is a human decision.

---

## Gate log

One row per orchestrator gate run (wave close). A count drop is a **blocker** until explained —
deleting a test is allowed only loudly, with the relocated assertion named in the commit.

| Date | Wave | Tests | Lint | tsc | Result |
|------|------|-------|------|-----|--------|
| — | baseline `93219e0` | 509 | pass | clean | baseline |
| 2026-07-19 | pre-flight verify | 509 | pass | clean | Ledger baseline confirmed against the tree before any dispatch |
| 2026-07-19 | 0 (T0) | 509 | pass | clean | green — golden byte-identical, count unchanged as specified |
| 2026-07-19 | 1 (T1) | 511 | pass | clean | green — +2 (rust/typescript registry assertions) |
| 2026-07-19 | 2 (T2·T3·T5·T30) | 551 | pass | clean | green — +40. Golden byte-identical throughout (`eb7c36e`) |
| 2026-07-19 | 3 (T4·T6·T7) | 617 | pass | clean | green — +66. Both languages now registered + user-visible; `languagesForType('function')` = 5 langs. Golden byte-identical (`855b524`) |
| 2026-07-20 | 4 (partial) | 628 | pass | clean | **NOT committed as a wave.** Only T10's impl present (untracked, unreviewed) — count reflects its +11 tests. HEAD stays `aca2f5b`. See the session-limit decision below |
| 2026-07-20 | 4 (T8·T10·E1·E11·E0) | 636 | pass | clean | green — +19 over wave 3. All three tasks APPROVE; T10 SEC hole found+fixed; doc-bug hunk folded. Golden byte-identical (`d1b9d1c`). **Phase 1 code complete — next gate is T9 (human F5)** |

---

## Decisions and deviations

Record the moment it happens — a decision that only exists in a diff is a decision nobody can
find later.

| Date | Task | Decision | Why |
|------|------|----------|-----|
| 2026-07-19 | — | Local toolchain shell-out over zero-install or Docker | Real Next.js/FastAPI exercises are the point; Docker needs Desktop running, GB images, cold-start seconds on a ms-grade suite |
| 2026-07-19 | — | Cache keyed by **dependency set**, not exercise | Shared envs; conflicting pins hash apart — version conflict structurally impossible |
| 2026-07-19 | — | No uniform "venv abstraction" | Only Python needs one built; a 4-field union with one field ever set is a union pretending to be a struct |
| 2026-07-19 | — | Toolchain detection = `ENOENT` from the install call | A probe table drifts; `ENOENT` does not |
| 2026-07-19 | T17 | venv over `pip install --target` | `--target` doesn't isolate from system site-packages, breaks entry points |
| 2026-07-19 | T7 | TS via `stripTypeScriptTypes`, not `tsc` | Zero install; blanks types **with spaces** so error offsets survive. Verified on Node v26.5.0 |
| 2026-07-19 | T7 | No type checking on default TS path | Grading is behavioural; tsserver gives live errors via the real `.ts` extension; opt-in `tsc` in Phase 3 |
| 2026-07-19 | — | Java libs out of scope | No transitive resolver in a stock JDK; someday `mvn dependency:copy-dependencies`, never hand-rolled |
| 2026-07-19 | — | Four epics collapsed into umbrella VSX-122 | One branch, one PR; phases become story groups |
| 2026-07-19 | — | `docs/` removed from `develop` (`85296fb`, pushed); `origin/main` cleared by next `develop → main` merge | develop carries the deletion; main is 22 behind regardless. Old plan files recoverable at `f19b365` |
| 2026-07-19 | review | Plan restructured for orchestration: tasks renumbered T0–T21, waves rebuilt | Found: 3 same-wave file collisions (codegen service, `env.registry.ts`, golden/typemap test files), a compile hole between T1 and the codegen rows (fixed with `''` stubs), inverted T-allowlist/parser dependency, same-wave T17←T18 dep |
| 2026-07-19 | review | Install step moved out of `EmittedProgram` into the cache service; `EnvContext.libDir` instead | Old T10 (install per run, temp dir) contradicted old T11 (cached env dirs) — both could not be true. Rust: per-run sources + `CARGO_TARGET_DIR` because copying sources into a shared cache mutates it per run |
| 2026-07-19 | §5/§6 | `project` grading = declared `checks:` list; `kind: function` reuses the five function envs against one file; unreferenced files are ungraded scaffolding; `css-assert` reserved | §5 had no grading spec at all; per-file behaviour must live in the artifact. No browser → CSS cannot be truly graded; a declared limit beats a fake grade |
| 2026-07-19 | §5 | `project` has no language selector — aggregate runtime preflight (✓/✗ + install hints) replaces it | Every single-language assumption (selector, `libs[lang]`, `detectRuntime`) breaks when the file set fixes the languages |
| 2026-07-19 | §5/§6 | Closing any exercise tab → modal → End = full teardown (seventh teardown path). Shared lib envs survive exercise close | Accidental `Cmd+W` must not silently kill a 40-min run with booted servers; deleting shared envs on close would re-pay full installs for nothing — sweep/Clear Cache own env reclamation |
| 2026-07-19 | §6 | `http` checks run in-host via global `fetch`, not a spawned Node driver | Host is Node ≥ 18: fewer processes, no extra runtime requirement, one less thing to kill |
| 2026-07-19 | §5 | Test taxonomy is two-level: `test.type` (execution strategy) × `check.kind` (gradeable unit, `project`/`service` only) | One flat list would conflate how an exercise *runs* with what a check *grades* — the split is what prevents a matrix explosion |
| 2026-07-19 | §5 | `in-place` retired as a type → `test.mutates: <param>` modifier on `function` | Identical execution, different emitted value; kills five duplicate envs. A type is an execution strategy — in-place never was one |
| 2026-07-19 | §5 | `class` emits one sentinel line per case, `actual` = canonical array of op results | `parseSentinelLines` and `canonicalJson` comparison reused with zero changes |
| 2026-07-19 | §5 | `stdin-stdout` runs one process per case | stdin is consumed once per process; compile still once per suite. The never-read-stdin rule is function-env-local, not global |
| 2026-07-19 | §6 | `build` check kind added (Phase 3) | A compiling React/TS project catches most real errors with no browser; reuses T10/T12 argv rules wholesale |
| 2026-07-19 | **execution** | **RESOLVED — static analysis is the *SonarQube for IDE* extension, permanently.** `sonar-analyze` / `mcp__sonarqube__*` / the `sonar` CLI are not to be invoked. Rule written into [CLAUDE.md](../../../CLAUDE.md) and [CREATING_A_PLAN.md §3.1](../../../CREATING_A_PLAN.md); the four task gates that named `sonar-analyze` (T10/T16/T22/T27) now name the reviewer's manual security trace | The MCP server was never registered (confirmed via `claude mcp list`) and the CLI was absent. **Orchestrator error corrected in-flight:** I first diagnosed "configured, Docker daemon down" from a `grep` hit on settings.json — that hit was the plugin entry, not a server registration. I then proposed `sonarqube:community` in Docker as the free fix; that was also wrong — **taint analysis is Developer Edition and above**, so Community would have cost a 700 MB image and 4 GB RAM and still not delivered the injection/path-traversal rules that motivated it. For a private repo there is no free path to taint analysis, which makes the already-installed IDE extension the ceiling of the free options, not a compromise |
| 2026-07-19 | **execution** | **Ceiling accepted and load-bearing: no taint/dataflow analysis in this repo, ever** | Standalone IDE analysis runs local rules only. No tool here will catch an injection or path-traversal defect. Those surfaces (T12 subprocess argv, T19/T30 path containment, T15 webview interpolation) are held by construction — `execFile` argv arrays, normalise-and-assert, `escHtml` — plus the reviewer's manual trace. **Carry this onto the PR checklist; do not report a "clean security pass".** The IDE analyser is genuinely productive on everything else: it caught `S8786`, `S3358`, `S7780`, `S4624` during waves 1–2, and it reaches subagents, not just the orchestrator |
| 2026-07-19 | T0 | Service↔codegen import cycle accepted rather than designed away | Plan pins `jsonToLiteral`/`mapType` in the service and assigns that family to T2, so relocating them would break T2's Owns. Cycle verified safe empirically from **both** entry directions (a worker's own test file may import a codegen module first) |
| 2026-07-19 | T1 | Big-O heuristic's supported set is `isLangId` — widening `LangId` auto-enrolled rust+typescript | Found by the compiler-free path: `tsc` was clean, the **test suite** caught it. Its hardcoded "only java, python, and javascript" message was drift; now derived from `LANG_IDS` per the no-inline-language-lists rule |
| 2026-07-19 | T1 | T1 edited `test/leetcode-bigo.test.ts` (T5's Owns) — minimal fixture fix only | The file used `rust` as its *unsupported-language* example, so T1 could not leave the tree green without touching it. T5 was dispatched with this stated; ownership otherwise intact |
| 2026-07-19 | **wave 2** | **Reviewer agent was stopped by the user mid-wave; orchestrator completed T3/T5/T30 review inline** | Killed agent was not respawned. T2 got a full independent two-round review before the stop; T3/T5/T30 did not. **This is the wave's weakest link — the independent-review leg is missing for three tasks, on top of the missing sonar leg** |
| 2026-07-19 | T5 | Three defects found by the orchestrator **after** the worker reported done, all fixed inline rather than re-dispatched | Worker's fix was correct but incomplete. Probing it (not trusting it) found: bare `loop { }` unrecognised; labelled loops unrecognised; and `stripCLikeComments` treating Rust's `'` as a string quote. Fixed inline because the diff was ~20 lines and an agent had just been stopped — recorded because it bypassed the review loop |
| 2026-07-19 | T5 | **`stripCLikeComments` blanked Rust source after any loop label** | Root cause, and the most damaging find of the wave: a label is an *odd* `'`, so everything to end-of-source was blanked and real work graded `O(1)`. Lifetimes (`&'a str`) escaped only because they pair up. Now resolved per language by `SingleQuoteRole`; a JS single-quoted-string test guards the regression |
| 2026-07-19 | T4 | **Orchestrator edited the golden file** — `test/leetcode-codegen-golden.test.ts`, normally an automatic `CHANGES` | T4 correctly refused to touch it and escalated. Two assertions ("an unsupported language yields empty boilerplate/harness") used `rust` as their example and passed **only by coincidence** — the T1 stub returned `''`, so they never actually exercised an unsupported-language path once rust became a `LangId`. They are **fixtures, not snapshots**: repointed to `ruby` (non-`LangId`), preserving intent permanently. Proved loss-free — `git diff` touches zero byte-identical snapshot lines; golden suite 11/11 |
| 2026-07-20 | E1/E11 → T8 | **Orchestrator hunk: fixed a pre-existing doc bug the E-task surfaced.** `ARTIFACT_LEETCODE_FILE_FORMAT.md` claimed the inline `params: - { name, type }` flow-map form parses; it does not | The E-task hit it authoring E1 (its `params` came back `[]`) and used the multi-line form instead. Verified: `KV_RE = /^(\w+):/` never matches a line starting with `{`. Fixed the canonical example (lines 37-38), a second inline example (line 161), and the false "both forms parse" claim — now states only multi-line parses and *why*. Landed as a wave hunk in T8's owned file (T8 already APPROVE; the fix is pure doc-vs-parser, T8's own mandate). Pre-existing, **not** introduced by this branch |
| 2026-07-20 | follow-up | `typescript.env.ts:90` `requires: 'Node 22.18 or newer'` is looser than the actual floor — Node 23.0–23.9 is "newer than 22.18" yet unsupported (floor is ≥23.10 on the 23.x line) | Flagged by the reviewer during T8; **out of every wave-4 task's Owns** (that file is T7's, wave 3, closed). Cosmetic — the toast wording only, the `detect()` logic and the docs are both precise. Needs its own tiny ticket; not worth reopening a closed task |
| 2026-07-20 | T10 | **Independent security review earned its place — found a hole the orchestrator's own read missed.** Embedded `..` traversal (`a/../../etc`) matched the allowlist; the leading-char anchor `^@?[a-zA-Z0-9]` only rejects *leading* `..`/`/` | Exactly why the plan mandates an independent reviewer on the trust boundary and why the orchestrator refused to self-ratify T10. I (orchestrator) had read the file the prior session and judged it "looks correct" — it was not. The reviewer tested the regex against `a/../../etc` and it accepted. Fix: `!name.includes('..')`. **Standing lesson: on a security boundary, "the orchestrator read it" is not review — running the hostile input is.** The tsc/lint/mocha gate all passed the hole too; only the manual trace caught it, and this repo has no taint analysis to back that trace up |
| 2026-07-20 | **wave 4 — HALTED BY SESSION LIMIT (external, not a code failure)** | All three wave-4 workers (T8, T10, E1/E11/E0) terminated mid-flight: *"session limit · resets 4:20am America/Bogota"*. New agents cannot be spawned until reset | **Exact state, for a clean resume:** HEAD = `aca2f5b` (wave 3, 617). T10's two files are on disk **untracked and unreviewed** (gate-green at 628); T8 and the E-tasks wrote **nothing**. **Orchestrator did NOT commit any wave-4 code** — committing an unreviewed security-boundary task would violate the plan's own gate ("never merge a security-flagged task on a worker's self-report alone"), and here the worker never even reported. Only this ledger was committed. **Resume order next session: (1) spawn the wave-4 Opus reviewer on T10's existing files — review, don't re-dispatch; (2) redispatch T8 + E1/E11/E0 fresh; (3) integrate + gate + commit the wave; (4) then STOP at T9, the human F5 pass.** The `git clean` risk on the untracked T10 files is noted — do not run `git clean -fd` before T10 is committed |
| 2026-07-19 | T6 | **A "settled — do not re-litigate" plan decision was WRONG; worker override RATIFIED by the orchestrator.** `{:?}` Debug replaced by a local `LeetJson` trait emitting compact, key-sorted JSON (no serde, no new dependency) | Plan §T6 claimed numbers/bool/`String`/`Vec`/`HashMap<String,_>` "all Debug-print as valid JSON". Verified false with real `rustc 1.81.0` on all counts: `Vec` → `[0, 1]` (comma-space vs canonical `[0,1]`); `String` → `"ab"` (quoted, then quoted again by the emitter); **`HashMap` Debug key order differs between two runs of the same binary** (`RandomState` re-seeds per process). `leetcode-runner.helpers.ts` compares `actual === canonicalJson(expected)` with **no** re-canonicalisation of `actual`, so this would have failed nearly every array-returning solution and **flaked** on map-returning ones. Found only because the worker was told to compile *and run* its emitted program rather than assert on generated strings — the same technique that caught wave 2's `rustEscape` defect. **Lesson: "settled" in a plan means "decided", not "verified".** |
| 2026-07-19 | **T7 → SECURITY FINDING (pre-existing, NOT introduced by this branch)** | **Artifact-supplied code executes with `require`/`process` in scope.** Chain, verified end to end: `candidateSource()` ([leetcode-run.handlers.ts:245-251](../../../src/commands/leetcode-run.handlers.ts#L245-L251)) falls back to `ctx.parsed.solutions[…].code` — the `# Solutions` block **from the `.md`** — when no challenge is live → `runSuite` → written as `sol.js` → `vm.runInContext` against a sandbox containing `require` and `process` ([javascript.env.ts:72](../../../src/services/test-envs/function/javascript.env.ts#L72)). Opening a third-party artifact and pressing **Submit** therefore runs its JavaScript with `require('child_process')` available. `CLAUDE.md` classes `.md` artifacts and the solution buffer as untrusted input, and the preview panel **hides solutions behind a `<details>` spoiler**, so the user is actively discouraged from reading the code Submit executes. Node documents that **`vm` is not a security mechanism**, so this is not fixable by trimming the sandbox | Surfaced by T7 reporting its sandbox-parity conclusion honestly, then verified by the orchestrator rather than taken on report. **Not a wave-3 blocker** — pre-existing, and T7 correctly copied the existing env rather than inventing a new surface. Needs its own decision: either treat artifact-stored solutions as an explicit code-execution consent step, or state the trust class outright the way plan §7 already does for Phase 4 services. **Left for the human — do not let T16 be mistaken for the fix** |
| 2026-07-19 | T16 | **Plan premise corrected against the tree** — T16 said the current env "deliberately runs candidates in a bare `vm` context with no `require` at all", and that its own "no `process`" clause was a restriction to preserve | Both false: `require` and `process` are already in the sandbox and the env's JSDoc documents it. T16 is therefore a **swap** of `require` (to one rooted at `libDir`), not a grant — materially smaller than planned. Corrected in `plan.md` §T16 with the evidence, so the T16 worker is not briefed from a false baseline |
| 2026-07-19 | **wave 3 close — INTEGRATION LANDED (`855b524`)** | All hunks landed atomically with the two `register()` lines: registry imports + `register(rust/typescriptFunctionEnv)`, JSDoc example → 5 langs, and the registry-test assertions repointed. **The pre-dispatch sweep missed a 4th instance** — `leetcode-preview-controls.test.ts` used `rust` inside a *setup fixture* (not a `languagesForType` literal), so it only surfaced on the integrated gate as `['rust','python'] !== ['python']`. Fixed (now `ruby`). Lesson refined: sweep negative fixtures for the widened members **as data inside fixtures too**, not only as bare assertion literals | Registering the envs flipped all four planned hunks green and exposed the fifth. Gate confirmed 617/0 before commit |
| 2026-07-19 | **pattern** | **Third instance of one landmine class: a test using a soon-to-be-runnable language as its "unsupported" example** | T1 hit it in `leetcode-bigo.test.ts`, T3 in `leetcode-exercise-file.test.ts`, T4 in the golden file. Root cause: widening `LangId` silently converts every such fixture into a false pass. All three now name `ruby`. **Lesson for the remaining waves — when a plan widens a shared union, grep the test suite for the widened members used as negative fixtures *before* dispatching**, rather than discovering them one wave at a time |
| 2026-07-19 | T3 | Out-of-Owns edit accepted, then **replaced** by the orchestrator | T3 swapped the "no setup, no template" fixture from `typescript` to `rust` — correct today, but rust gets a template in **T4, next wave**, so it was a guaranteed wave-3 breakage. Now names `ruby` (a non-`LangId`), which is what the test's intent actually requires and is stable permanently |
| 2026-07-19 | T30 | Symlinked **files** named `.md` are still listed; only symlinked *directories* are gated | Matches the plan's stated rule, which names directories. Accepted ceiling: the vault is the user's own, content is already treated as untrusted, and webview output goes through `escHtml`. Revisit if vaults ever become shared |
| 2026-07-19 | T1 | Pre-existing `typescript:S8786` (super-linear regex backtracking) on `MAP_RE` in `leetcode-codegen.service.ts` left unfixed | Predates this branch and sits outside T1's Owns; `MAP_RE` parses artifact-frontmatter type strings, which **are** untrusted input, so this wants its own task rather than a drive-by fix |

---

## `ponytail:` ceilings taken

Harvest with `/ponytail-debt`; each needs a `ponytail:` comment at the code site naming ceiling
and upgrade path.

| Task | Ceiling | Upgrade path |
|------|---------|--------------|
| **FOLLOW-UP (out of wave 3 Owns)** | **`java.env.ts` `__quote` misses `\b`/`\f`/`U+0000–U+001F`** — identical control-char escaping gap the reviewer found in Rust `LeetJson`. Pre-existing baseline, not introduced here | Escape controls as `\u00XX` to match `canonicalJson`/`JSON.stringify`; ideally one shared escaper both envs use. **Needs its own ticket — do not silently leave in new code without a tracked item.** Rust side fixed in T6 R2 |
| T6 | `f64` diverges from JS at `≥~1e16` (i64-saturating cast) and on `NaN`/`inf` (Rust prints `NaN`/`inf`, JS emits `null`) | Outside realistic leetcode `f64` ranges; documented. serde via T18 if ever needed |
| T2 | `[]` → `vec![]` cannot type-infer standalone | Thread the declared param type into the emitter |
| T2 | `String::from(…)`; a `&str` param fails at compile, not `validate` | Type-aware literal emission |
| T6 | `{:?}` Debug — no structs, no enums | `serde_json` via T18's Cargo path |
| T7 | Erasable syntax only — no `enum`/`namespace`/param props/decorators | `tsc` from an env, Phase 3 |
| T7 | No type checking on default path | Opt-in `tsc` pass, Phase 3 |
| T19 | Size budget a constant (2 GB), not a setting | Configuration contribution when someone wants a different number |
| T19 | Sweep can theoretically race a live run in another window | Accepted — 30-day threshold makes it practically nil |

---

## PR checklist

Mirrors plan §9. The last item is not optional.

- [ ] Gate green, test count recorded and up
- [ ] `npx tsc --noEmit` clean
- [ ] IDE analyser diagnostics fixed on every non-trivial diff
- [ ] **No-taint-analysis ceiling stated in the PR body** — injection and path-traversal on the
      subprocess/filesystem/webview surfaces were verified by construction and manual review
      only, never by a tool
- [ ] F5 passes recorded for T9 and T21
- [ ] `ARTIFACT_LEETCODE_FILE_FORMAT.md` updated in the same change as any format change
- [ ] `CLAUDE.md` invariants rewritten (no-runtime-deps, one-temp-file)
- [ ] Jira stories created under VSX-122, keys filled here and in jira-tickets.md
- [ ] Anything worth keeping promoted out of `docs/`
- [ ] **`git rm -r docs` committed — the PR diff contains no `docs/` path**
