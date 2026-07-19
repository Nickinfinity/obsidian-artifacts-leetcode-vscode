# Progress — Rust, Multi-Library, Multi-File, Running Servers

Plan: [plan.md](plan.md) · Branch: `feat/rust-multilang`
**Owner of this file: the orchestrator only.** Workers report; they never edit the ledger, or
two of them race on the same table.

Gate baseline at branch point: **509 passing** (`93219e0`, post-PR-#2).

---

## Status

`todo` · `wip` · `done` · `blocked` · `dropped` (with the reason)

### Phase 1 — Rust function environment

| Task | Wave | Agent | Status | Tests | Gate | Notes |
|------|------|-------|--------|-------|------|-------|
| T0 — extract per-language codegen | 0 | orchestrator | todo | 509 → — | — | Golden net must pass **untouched** |
| T1 — `LangId` += `rust`, registry entry | 1 | orchestrator | todo | — | — | `tsc --noEmit` green gates all fan-out |
| T2 — `jsonToLiteral` Rust branch | 2 | sonnet | todo | — | — | `vec![…]`, `String::from(…)`, `HashMap::from(…)` |
| T3 — `LANG_CODEGEN.rust` | 2 | sonnet | todo | — | — | Golden cases **added**, never edited |
| T4 — `function × rust` env | 3 | sonnet | todo | — | — | Two-unit `mod solution;`, `{:?}` serialization |
| T5 — big-O Rust patterns | 2 | sonnet | todo | — | — | May close as `dropped` if the heuristic is already language-agnostic — verify first |
| T6 — docs | 4 | sonnet | todo | — | — | Format spec + `CLAUDE.md` |
| T7 — F5 manual pass | 4 | human | todo | — | — | Click-path in plan §1 T7 |

### Phase 2 — Libraries per exercise

| Task | Wave | Agent | Status | Tests | Gate | Notes |
|------|------|-------|--------|-------|------|-------|
| T8 — parse `libs:` | 5 | sonnet | todo | — | — | Defaults to `{}`; malformed never throws |
| T9 — library-name allowlist | 5 | sonnet | todo | — | — | **Security-critical.** Sonar must come back clean |
| T10 — `install` in emit contract + runner | 6 | sonnet | todo | — | — | `execFile` + argv array, separate 120 s budget |
| T11 — library cache | 6 | sonnet | todo | — | — | SHA-256 of langId + **sorted** package list |
| T12 — JavaScript libs | 7 | sonnet | todo | — | — | Widens the `vm` sandbox — `require` only |
| T13 — Python libs | 7 | sonnet | todo | — | — | `pip install --target _libs` |
| T14 — Rust libs (Cargo path) | 7 | sonnet | todo | — | — | Bare `rustc` path must stay byte-identical |
| T15 — Java libs unsupported | 7 | sonnet | todo | — | — | Explicit message via the contract-violation path |
| T16 — panel lib chips | 8 | sonnet | todo | — | — | `vscode`-coupled; F5 verified |
| T17 — docs | 8 | sonnet | todo | — | — | Rewrites the "no runtime dependencies" invariant |

### Phases 3–4

Contract-only. No tasks until Phase 1–2 land and the open questions in plan §3 and §4 are
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

Anything an agent decided that the plan did not specify, or decided **against** the plan.
Record it here the moment it happens — a decision that only exists in a diff is a decision
nobody can find later.

| Date | Task | Decision | Why |
|------|------|----------|-----|
| 2026-07-19 | — | Java libraries out of scope through Phase 2 | No install path without Maven/Gradle; inventing one is a phase of its own |
| 2026-07-19 | — | Local toolchain shell-out over zero-install | Real Next.js/FastAPI exercises are the point; zero-install cannot reach them |
| 2026-07-19 | — | Phases 3–4 contract-only | Task breakdown against unknowns produces tasks that get rewritten |

---

## `ponytail:` ceilings taken

Deliberate shortcuts with a known limit. Harvest with `/ponytail-debt`; each needs a
`ponytail:` comment at the code site naming the ceiling and the upgrade path.

| Task | Ceiling | Upgrade path |
|------|---------|--------------|
| T2 | `[]` → `vec![]` cannot type-infer standalone | Thread the declared param type into the literal emitter |
| T2 | Strings emit `String::from(…)`; a `&str` param fails at compile, not at `validate` | Type-aware literal emission |
| T4 | `{:?}` Debug serialization — no structs, no enums | `serde_json`, once T14 gives Rust a dependency path |
| T11 | Cache never evicts | LRU by access time when the directory is measurably large |

---

## PR checklist

Mirrors plan §7. The last item is not optional.

- [ ] Gate green, test count recorded and up
- [ ] `npx tsc --noEmit` clean
- [ ] `sonar-analyze` clean on every non-trivial diff
- [ ] F5 manual pass done for every `vscode`-coupled task
- [ ] `ARTIFACT_LEETCODE_FILE_FORMAT.md` updated in the same change as any format change
- [ ] `CLAUDE.md` invariants rewritten (no-runtime-deps, one-temp-file)
- [ ] Jira tickets created, keys filled into [jira-tickets.md](jira-tickets.md)
- [ ] Anything worth keeping promoted out of `docs/` into `CLAUDE.md` / the format spec / JSDoc
- [ ] **`git rm -r docs` committed — the PR diff contains no `docs/` path**
