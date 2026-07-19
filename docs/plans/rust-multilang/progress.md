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
| T0 — extract per-language codegen | 0 | orchestrator | `<KEY>` | todo | 509 → — | — | Golden net passes **untouched** |
| T1 — widen registry, stubs wired | 1 | orchestrator | `<KEY>` | todo | — | — | Stubs return `''` (pre-widening fallback); `tsc` green gates fan-out |
| T2 — `jsonToLiteral` Rust branch | 2 | sonnet | `<KEY>` | todo | — | — | TS needs none — falls through to JS path |
| T3 — TypeScript codegen row | 2 | sonnet | `<KEY>` | todo | — | — | Own test file; typed signature is the point |
| T5 — big-O Rust patterns | 2 | sonnet | `<KEY>` | todo | — | — | May close `dropped` if heuristic already language-agnostic — verify first |
| T4 — Rust codegen row | 3 | sonnet | `<KEY>` | todo | — | — | Trails T2: harness renders args via rust literals |
| T6 — `function × rust` env | 3 | sonnet | `<KEY>` | todo | — | — | Registration = orchestrator at wave close |
| T7 — `function × typescript` env | 3 | sonnet | `<KEY>` | todo | — | — | JS env + strip call; `detect()` gates Node ≥ 22.18 |
| T8 — docs Phase 1 | 4 | sonnet | `<KEY>` | todo | — | — | Format spec + `CLAUDE.md` |
| T9 — F5 Phase 1 | 4 | **human** | `<KEY>` | todo | — | — | Twice: Rust, TypeScript. Orchestrator stops and asks |

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

### Phases 3–4

Contract-only (plan §5–§6). After Phase 2 closes, the orchestrator amends the contracts against
the tree, then **stops and presents** — breakdown is a human decision.

---

## Gate log

One row per orchestrator gate run (wave close). A count drop is a **blocker** until explained —
deleting a test is allowed only loudly, with the relocated assertion named in the commit.

| Date | Wave | Tests | Lint | tsc | Result |
|------|------|-------|------|-----|--------|
| — | baseline `93219e0` | 509 | pass | clean | baseline |

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
