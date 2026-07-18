# Services Refactor — Progress Ledger

Source of truth for resume. Orchestrator updates + **commits** this after every phase's inner
loop closes. Plan: [`services-refactor.md`](services-refactor.md). Branch: `refactor/services-dry`
(off `main`).

**Baseline: 467 mocha passing (2026-07-17), compile + lint clean.** Every gate: zero failures,
pass count **≥ 467 and never below the previous gate's** (TDD adds tests — count grows, a drop
means a deleted/skipped test), codegen emit byte-identical.

> **RESUME HERE:** T2 done + committed (`106d549`, gate **493**). Next unchecked = **T3** (codegen
> dispatch collapse — golden byte-identical emit). Execution is **inline** (user declined subagent
> spawns) — the Opus orchestrator does the edits directly, same per-phase gate+review+commit loop.

Legend: `[ ]` pending · `[~]` in progress · `[x]` done + gated + committed.
Sub-steps per task: edit → gate#1 → mastering-typescript → sonar-analyze → review → remediate →
gate#2 → committed.

- [x] **T0 Baseline** — 467 passing, compile+lint clean; branch + plan docs created. (orchestrator)
- [x] **T1** Shared utils + constants (escapeRe 4→1, time.helpers, FENCE, SOLUTION_MARKER, config consts) — **done in prior work; verified gate 467**
- [x] **T2** Central `LANGUAGES` registry (`languages.ts` + bigo derive + drift test) — gate 493
- [ ] **T3** Codegen dispatch collapse — needs T2; golden emit byte-identical
- [ ] **T4** Run-infra unify + `makeFunctionEnv` — needs T2/T3
- [ ] **T5** Section-slice/JSON dedupe + parser split <400L — needs T1
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

**Gotcha:** T1 & T7 both edit `leetcode-run.handlers.ts` → run serially, never concurrent.
