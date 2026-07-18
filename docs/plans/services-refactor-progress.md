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

> **DONE:** T1–T7 + Phase 8 complete on `refactor/services-dry` (17 commits ahead of main, gate
> 467→**509**, security sweep clean). **Held local per user — NOT pushed, NO PR opened.** Two
> outstanding manual items before merge: (1) **F5 visual pass** of settings/preview/sidebar/results
> after the CSS split (selector-diff proves loss-free but rendering wasn't visually confirmed);
> (2) push + open PR when ready. Follow-up: separate [`claude-md-rewrite.md`](claude-md-rewrite.md)
> after merge.

Legend: `[ ]` pending · `[~]` in progress · `[x]` done + gated + committed.
Sub-steps per task: edit → gate#1 → mastering-typescript → sonar-analyze → review → remediate →
gate#2 → committed.

- [x] **T0 Baseline** — 467 passing, compile+lint clean; branch + plan docs created. (orchestrator)
- [x] **T1** Shared utils + constants (escapeRe 4→1, time.helpers, FENCE, SOLUTION_MARKER, config consts) — **done in prior work; verified gate 467**
- [x] **T2** Central `LANGUAGES` registry (`languages.ts` + bigo derive + drift test) — gate 493
- [x] **T3** Codegen dispatch collapse (TYPE_SYNTAX + LANG_CODEGEN maps; golden byte-identical) — gate 504
- [x] **T4** Run-infra unify + `makeFunctionEnv` (deleted lang-runners+LangRunner; envs→factory) — gate 491
- [x] **T5** Section-slice/JSON dedupe + parser split (safeJsonParse, sectionBounds, parser 539→114L + helpers 431L) — gate 499
- [x] **T6** Narrow I/O extract + type relocation (runner.helpers, practice-mode.helpers, 3 types→types/; vault split skipped) — gate 509
- [x] **T7** CSS delete dead + split live (styles.css 925→442L + new leetcode-preview.css 302L; cssUris wiring) — gate 509 (F5 pending)
- [x] **Phase 8** Finalize — full gate 509, security sweep clean, spec/manifest untouched. **PR held per user (kept local, not pushed).**
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
| T6 | ✅ pure-helper extract + type relocation | 509 | b8c2de9 |
| T7 | ✅ CSS dead-delete + split (F5 pending) | 509 | 71303a4 |

**Gotcha:** T1 & T7 both edit `leetcode-run.handlers.ts` → run serially, never concurrent.
