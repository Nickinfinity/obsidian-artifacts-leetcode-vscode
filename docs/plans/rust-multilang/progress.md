# Progress — Rust, TypeScript, Multi-Library, Multi-File, Running Servers

Epic: **[VSX-122](https://dexsys.atlassian.net/browse/VSX-122)** ·
Branch: `feature/VSX-122_multilib-multilang-support` · Plan: [plan.md](plan.md)

**Owner of this file: the orchestrator only.** Workers report; they never edit the ledger, or two
of them race on the same table.

Gate baseline at branch point: **509 passing** (`93219e0`, post-PR-#2).

---

## Status

`todo` · `wip` · `done` · `blocked` · `dropped` (with the reason)

### Phase 1 — Rust and TypeScript as runnable languages

| Task | Wave | Agent | Jira | Status | Tests | Gate | Notes |
|------|------|-------|------|--------|-------|------|-------|
| T0 — extract per-language codegen | 0 | orchestrator | `<KEY>` | todo | 509 → — | — | Golden net must pass **untouched** |
| T1 — `LangId` += `rust`, `typescript` | 1 | orchestrator | `<KEY>` | todo | — | — | Both in one step; `tsc --noEmit` green gates all fan-out |
| T2 — `jsonToLiteral` Rust branch | 2 | sonnet | `<KEY>` | todo | — | — | TS needs none — falls through to the JS path |
| T3 — `LANG_CODEGEN.rust` | 2 | sonnet | `<KEY>` | todo | — | — | Golden cases **added**, never edited |
| T3b — TS type mapping + codegen row | 2 | sonnet | `<KEY>` | todo | — | — | Orchestrator lands the `PRIMITIVES`/`TYPE_SYNTAX` hunk |
| T4 — `function × rust` env | 3 | sonnet | `<KEY>` | todo | — | — | `mod solution;`, `{:?}` serialization |
| T4b — `function × typescript` env | 3 | sonnet | `<KEY>` | todo | — | — | JS env + `stripTypeScriptTypes`; `detect()` gates Node ≥ 22.18 |
| T5 — big-O Rust patterns | 2 | sonnet | `<KEY>` | todo | — | — | May close `dropped` if the heuristic is already language-agnostic — verify first |
| T6 — docs | 4 | sonnet | `<KEY>` | todo | — | — | Format spec + `CLAUDE.md` |
| T7 — F5 manual pass | 4 | human | `<KEY>` | todo | — | — | Run twice: Rust, then TypeScript |

### Phase 2 — Libraries per exercise

| Task | Wave | Agent | Jira | Status | Tests | Gate | Notes |
|------|------|-------|------|--------|-------|------|-------|
| T8 — parse `libs:` (+ reserve `test.runtime`) | 5 | sonnet | `<KEY>` | todo | — | — | Defaults `{}`; malformed never throws |
| T9 — library-name allowlist | 5 | sonnet | `<KEY>` | todo | — | — | **Security-critical.** Sonar must come back clean |
| T10 — `install` in emit contract + runner | 6 | sonnet | `<KEY>` | todo | — | — | `execFile` + argv, own 120 s budget, `ENOENT` → named message |
| T11 — environment cache | 6 | sonnet | `<KEY>` | todo | — | — | SHA-256 of langId + **sorted** list; hands back a dir, nothing more |
| T12 — JS + TS libraries | 7 | sonnet | `<KEY>` | todo | — | — | Widens the `vm` sandbox — `require` **only** |
| T13 — Python libraries (venv) | 7 | sonnet | `<KEY>` | todo | — | — | `python3 -m venv`; never `source activate` |
| T14 — Rust libraries (Cargo) | 7 | sonnet | `<KEY>` | todo | — | — | Bare `rustc` path stays byte-identical; `~/.cargo` untouched |
| T15 — Java libs unsupported | 7 | sonnet | `<KEY>` | todo | — | — | Explicit message via contract-violation path |
| T16 — panel lib chips | 8 | sonnet | `<KEY>` | todo | — | — | `vscode`-coupled; F5 verified |
| T17 — docs | 8 | sonnet | `<KEY>` | todo | — | — | Rewrites the "no runtime dependencies" invariant |
| T18 — storage sweep + Clear Cache | 8 | sonnet | `<KEY>` | todo | — | — | Absorbs the existing `attempts/` cleanup debt |

### Phases 3–4

Contract-only. No tasks until Phases 1–2 land and the open questions in plan §4 and §5 are
answered against the real tree.

---

## Gate log

One row per gate run. A test-count drop is a **blocker** until explained — per `CLAUDE.md`,
deleting a test for deleted code is allowed only loudly, with the relocated assertion named.

| Date | After | Command | Tests | Lint | tsc | Result |
|------|-------|---------|-------|------|-----|--------|
| — | branch point `93219e0` | full gate | 509 | pass | clean | baseline |

---

## Decisions and deviations

Record the moment it happens — a decision that only exists in a diff is a decision nobody can
find later.

| Date | Task | Decision | Why |
|------|------|----------|-----|
| 2026-07-19 | — | Local toolchain shell-out over zero-install or Docker | Real Next.js/FastAPI exercises are the point; Docker needs Desktop running, GB images, and seconds of cold start on a suite that grades in ms |
| 2026-07-19 | — | Cache keyed by **dependency set**, not by exercise | 30 exercises using numpy share one env; conflicting pins hash apart, so version conflict is structurally impossible |
| 2026-07-19 | — | No uniform "venv abstraction" — each env owns its own primitive | Only Python needs one built; JS, Rust and Java already have or don't need isolation. A 4-field union where one field is ever set is a union pretending to be a struct |
| 2026-07-19 | — | Toolchain detection = `ENOENT` from the install call | A hand-maintained probe table drifts; `ENOENT` does not |
| 2026-07-19 | T13 | venv over `pip install --target` | `--target` doesn't isolate from system site-packages and breaks on entry points; venv costs ~2 s, paid once per dep set |
| 2026-07-19 | T4b | TypeScript via `stripTypeScriptTypes`, not `tsc` | Zero install, no compile step, and it blanks types **with spaces** so error line/column still point at the solver's `.ts`. Verified on Node v26.5.0 before being planned |
| 2026-07-19 | T4b | No type checking on the default TS path | Grading is behavioural; the solver already gets live errors from tsserver because the temp file has a real `.ts` extension. Opt-in `tsc` arrives in Phase 3, which needs a compiler for `.tsx` anyway |
| 2026-07-19 | — | Java libraries out of scope through Phase 2 | No transitive resolver in a stock JDK. When asked for: generate a `pom.xml` and shell out to `mvn dependency:copy-dependencies`, never hand-roll a Maven Central fetch |
| 2026-07-19 | — | Phases 3–4 contract-only | Task breakdown against unknowns produces tasks that get rewritten |
| 2026-07-19 | — | Four epics collapsed into umbrella VSX-122 | One branch, one PR; phases become story groups |

---

## `ponytail:` ceilings taken

Deliberate shortcuts with a known limit. Harvest with `/ponytail-debt`; each needs a `ponytail:`
comment at the code site naming the ceiling and the upgrade path.

| Task | Ceiling | Upgrade path |
|------|---------|--------------|
| T2 | `[]` → `vec![]` cannot type-infer standalone | Thread the declared param type into the literal emitter |
| T2 | Strings emit `String::from(…)`; a `&str` param fails at compile, not at `validate` | Type-aware literal emission |
| T4 | `{:?}` Debug serialization — no structs, no enums | `serde_json`, once T14 gives Rust a dependency path |
| T4b | Erasable syntax only — no `enum`, `namespace`, parameter properties, decorators | `tsc` from an env, arriving in Phase 3 |
| T4b | No type checking on the default path | Opt-in `libs.typescript: ["typescript"]` + a `tsc` pass |
| T18 | Size budget is a constant (2 GB), not a setting | A configuration contribution, when someone wants a different number |

---

## PR checklist

- [ ] Gate green, test count recorded and up
- [ ] `npx tsc --noEmit` clean
- [ ] `sonar-analyze` clean on every non-trivial diff
- [ ] F5 manual pass done for every `vscode`-coupled task
- [ ] `ARTIFACT_LEETCODE_FILE_FORMAT.md` updated in the same change as any format change
- [ ] `CLAUDE.md` invariants rewritten (no-runtime-deps, one-temp-file)
- [ ] Jira stories created under VSX-122, keys filled into this table and
      [jira-tickets.md](jira-tickets.md)
- [ ] Anything worth keeping promoted out of `docs/` into `CLAUDE.md` / the format spec / JSDoc
- [ ] **`git rm -r docs` committed — the PR diff contains no `docs/` path**
