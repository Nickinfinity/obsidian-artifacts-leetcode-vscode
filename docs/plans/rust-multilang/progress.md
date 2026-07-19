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
| T2 — `jsonToLiteral` Rust branch | 2 | sonnet | `<KEY>` | wip | — | — | TS needs none — falls through to JS path |
| T3 — TypeScript codegen row | 2 | sonnet | `<KEY>` | wip | — | — | Own test file; typed signature is the point |
| T5 — big-O Rust patterns | 2 | sonnet | `<KEY>` | wip | — | — | Orchestrator pre-verified: heuristic **is** language-agnostic (`toSupportedLang` = `isLangId`). Dispatched verify-first |
| T4 — Rust codegen row | 3 | sonnet | `<KEY>` | todo | — | — | Trails T2: harness renders args via rust literals |
| T6 — `function × rust` env | 3 | sonnet | `<KEY>` | todo | — | — | Registration = orchestrator at wave close |
| T7 — `function × typescript` env | 3 | sonnet | `<KEY>` | todo | — | — | JS env + strip call; `detect()` gates Node ≥ 22.18 |
| T30 — recursive exercise discovery | 2 | sonnet | `<KEY>` | wip | — | — | **Security-critical** (symlink containment); flat vault byte-identical |
| T8 — docs Phase 1 | 4 | sonnet | `<KEY>` | todo | — | — | Format spec + `CLAUDE.md` |
| T9 — F5 Phase 1 | 4 | **human** | `<KEY>` | todo | — | — | Deploy examples to vault first; folder path proves T30. Twice: Rust, TypeScript |

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
| E1 · E11 → E0 — two-sum + is-anagram (5 langs) + fixtures test + README + ab-check migration | 4 | sonnet | `<KEY>` | todo | Serial: artifacts first, then the recursive glob test guarding all of them |
| E2–E5 — lodash · numpy · serde_json · java-negative | 8 | sonnet | `<KEY>` | todo | Under `function/libs/`; T21 clicks through these exact files |
| E6–E8 — lru-cache · mutates · stdio | 12 | sonnet | `<KEY>` | todo | T29 material; interpreted + compiled each |
| E9 · E10 · E12 — react project · fastapi+react · node+react (TS) | spike | spike | — | deferred | Spike deliverables — a concrete artifact forces the contract to confess its gaps |

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
| 2026-07-19 | **execution** | **`sonar-analyze` is UNAVAILABLE in this environment** — no `mcp__sonarqube__*` tools registered and no `sonar` CLI on PATH. Every task's sonar gate degrades to `pnpm lint` + VS Code IDE Sonar diagnostics (which *are* live and rule-tagged, e.g. `typescript:S8786`) | Plan mandates sonar on T10/T16/T22/T27 and on every non-trivial diff. Recorded rather than silently skipped: the security-critical Phase 2/2.5 tasks lose one of their two independent checks, so the reviewer's §5 pass carries that weight alone. **Human decision needed before wave 4** (first security-critical task, T10) |
| 2026-07-19 | T0 | Service↔codegen import cycle accepted rather than designed away | Plan pins `jsonToLiteral`/`mapType` in the service and assigns that family to T2, so relocating them would break T2's Owns. Cycle verified safe empirically from **both** entry directions (a worker's own test file may import a codegen module first) |
| 2026-07-19 | T1 | Big-O heuristic's supported set is `isLangId` — widening `LangId` auto-enrolled rust+typescript | Found by the compiler-free path: `tsc` was clean, the **test suite** caught it. Its hardcoded "only java, python, and javascript" message was drift; now derived from `LANG_IDS` per the no-inline-language-lists rule |
| 2026-07-19 | T1 | T1 edited `test/leetcode-bigo.test.ts` (T5's Owns) — minimal fixture fix only | The file used `rust` as its *unsupported-language* example, so T1 could not leave the tree green without touching it. T5 was dispatched with this stated; ownership otherwise intact |
| 2026-07-19 | T1 | Pre-existing `typescript:S8786` (super-linear regex backtracking) on `MAP_RE` in `leetcode-codegen.service.ts` left unfixed | Predates this branch and sits outside T1's Owns; `MAP_RE` parses artifact-frontmatter type strings, which **are** untrusted input, so this wants its own task rather than a drive-by fix |

---

## `ponytail:` ceilings taken

Harvest with `/ponytail-debt`; each needs a `ponytail:` comment at the code site naming ceiling
and upgrade path.

| Task | Ceiling | Upgrade path |
|------|---------|--------------|
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
- [ ] `sonar-analyze` clean on every non-trivial diff
- [ ] F5 passes recorded for T9 and T21
- [ ] `ARTIFACT_LEETCODE_FILE_FORMAT.md` updated in the same change as any format change
- [ ] `CLAUDE.md` invariants rewritten (no-runtime-deps, one-temp-file)
- [ ] Jira stories created under VSX-122, keys filled here and in jira-tickets.md
- [ ] Anything worth keeping promoted out of `docs/`
- [ ] **`git rm -r docs` committed — the PR diff contains no `docs/` path**
