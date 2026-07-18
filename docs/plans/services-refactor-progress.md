# Services Refactor — Progress Ledger

Source of truth for resume. Orchestrator updates + **commits** this after every phase's inner
loop closes. Plan: [`services-refactor.md`](services-refactor.md). Branch: `refactor/services-dry`
(off `main`).

**Baseline: 467 mocha passing (2026-07-17), compile + lint clean.** Every gate: zero failures,
pass count **≥ 467** (never below the baseline floor), codegen emit byte-identical. NOTE: the
"never below the *previous* gate" rule has one sanctioned exception — **deleting tests that cover
deleted code** (T4a removed the `LangRunner`-config tests when `lang-runners/` was deleted). Such a
drop is fine when documented loudly (commit + findings) and live coverage is relocated; a *silent*
drop still means a lost test. **Always `rm -rf dist` before gating after any file delete/rename** —
`tsc` leaves orphaned `dist/*.js` that keep running and inflate the count.

> **RESUME HERE:** T5 done + committed (T5a `67a8957` safe-json+section-bounds, T5b `02d7452`
> parser split, gate **499**). Next unchecked = **T6** (narrow I/O extractions + type relocation).
> Execution is **inline** (user declined subagent spawns) — the Opus orchestrator edits directly,
> same per-phase gate+review+commit loop. (T7 CSS still pending, parallel-safe.)

Legend: `[ ]` pending · `[~]` in progress · `[x]` done + gated + committed.
Sub-steps per task: edit → gate#1 → mastering-typescript → sonar-analyze → review → remediate →
gate#2 → committed.

- [x] **T0 Baseline** — 467 passing, compile+lint clean; branch + plan docs created. (orchestrator)
- [x] **T1** Shared utils + constants (escapeRe 4→1, time.helpers, FENCE, SOLUTION_MARKER, config consts) — **done in prior work; verified gate 467**
- [x] **T2** Central `LANGUAGES` registry (`languages.ts` + bigo derive + drift test) — gate 493
- [x] **T3** Codegen dispatch collapse (TYPE_SYNTAX + LANG_CODEGEN maps; golden byte-identical) — gate 504
- [x] **T4** Run-infra unify + `makeFunctionEnv` (deleted lang-runners+LangRunner; envs→factory) — gate 491
- [x] **T5** Section-slice/JSON dedupe + parser split (safeJsonParse, sectionBounds, parser 539→114L + helpers 431L) — gate 499
- [ ] **T6** Narrow I/O extract + type relocation — needs T3/T4
- [ ] **T7** CSS delete dead + split live — **parallel-safe**
- [ ] **Phase 8** Finalize (orchestrator) — security sweep + open PR
- [ ] **After merge:** separate plan [`claude-md-rewrite.md`](claude-md-rewrite.md)

Gate log (zero failures; pass-count ≥ previous row, baseline **467**):

| Task | Result | Pass count | Commit |
|---|---|---|---|
| T0 | ✅ baseline | 467 | branch created, docs only |
| T1 | ✅ verified (prior work) | 467 | already on branch |
| T2 | ✅ registry + bigo derive | 493 | 106d549 |
| T3 | ✅ codegen dispatch maps | 504 | 6d67bbc |
| T4a | ✅ delete lang-runners (dead-code test drop, documented) | 485 | 1c61be6 |
| T4b | ✅ makeFunctionEnv factory | 491 | 96a215e |
| T5a | ✅ safeJsonParse + sectionBounds | 499 | 67a8957 |
| T5b | ✅ parser split + scanIndentedBlock | 499 | 02d7452 |

**Gotcha:** T1 & T7 both edit `leetcode-run.handlers.ts` → run serially, never concurrent.
