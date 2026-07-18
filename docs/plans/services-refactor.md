# Services Refactor — Orchestrated (Opus → Sonnet) Workflow

## Plan Files — start here (run only this one)

**This file is the single entry point.** Running it drives the three companions automatically —
do **not** run them as separate tasks:

| File | Role | Driven by this plan |
|---|---|---|
| **`services-refactor.md`** (this) | The plan + task queue T1–T7 + Phase 0/8. | You run this. |
| **`services-refactor-progress.md`** | Resume ledger — checkboxes, gate log, **RESUME HERE**. | Orchestrator **ticks + commits** it every phase (inner-loop step 6). Read it to resume across sessions. |
| **`services-refactor-findings.md`** | Knowledge log — Discovered / Changed / Improved / Rule-learned per phase. | Orchestrator **appends** to it every phase (step 6). |
| **`claude-md-rewrite.md`** | Slim + update `CLAUDE.md`. | **Runs last, after this refactor merges**, consuming `services-refactor-findings.md` as its input. Separate PR — not part of this run. |

So: one command starts the refactor; the ledger + findings log are written *as it runs*; the
CLAUDE.md rewrite is a distinct follow-up fed by the findings.

## Context

`src/services/` grew to ~4,400 lines across 30 files. The subsystem that matters most —
running diverse tests for diverse languages — is the least DRY part of it: adding **one**
language today requires edits in **~15 scattered places**, and the parallel "supported
language" lists have already drifted (`leetcode-codegen.service.ts` knows `rust`; the env
registry and runners do not). Per-language `if (lang === …)` cascades, four byte-identical
`escapeRe` copies, three ~80%-identical function-env modules, and two competing "how to run
language X" tables (`lang-runners/` vs `test-envs/`) all fight the same future: more
languages, and new test *types* (class-based, React/JSX with companion languages,
library-backed envs).

**Goal:** cut function complexity and line count with **identical runtime results**, push
pure helpers to `src/utils`, config/constants to `src/types`, feature CSS to `src/ui`, and
make the language/test-type matrix **config-driven** so a new language is one config entry,
not fifteen edits.

**Decisions locked:**
1. **Central `LANGUAGES` registry + config dispatch** — one data entry per language drives
   the allowed-set, extension, comment prefix, primitives, box rules; codegen `if`-cascades
   become map dispatch. Exact emit strings preserved, only relocated.
2. **Fold run infra into one** — delete `lang-runners/`; `detectCmd`/`displayName` move into
   the language config / `TestEnv`.
3. **CSS: delete dead + split live** — remove ~350 dead lines, split live LeetCode blocks
   into their own file.
4. **Whole coupling** — agents edit coupled files outside `src/services` (types, utils, ui,
   the `RUNNERS` table in `commands/`) when a DRY move requires it.

**Invariant (non-negotiable):** behavior is preserved. Every pre-existing test keeps passing
unmodified (the count only grows as TDD adds tests, never shrinks), and codegen emit output is
byte-identical pre/post. This is a refactor, not a rewrite.

---

## Guiding Principles (every agent upholds these)

The orchestrator's prompt to **every** subagent must state these as the bar the work is
judged against — not decoration, the actual acceptance criteria:

- **DRY** — one source of truth. Reuse an existing helper/const/type before writing one; a
  second copy of anything is a defect, not a convenience.
- **KISS** — the simplest thing that works. No abstraction without a second concrete caller
  today. Boring over clever.
- **DOTW (Do One Thing Well / Unix philosophy)** — one file, one concern; one function, one
  job. If a function needs a `// ── section ──` banner to navigate, it wants splitting.
- **Performance & efficiency** — fewer lines for the same result, no needless allocations or
  re-scans; a compiled language pays `javac` once per suite, not per case (keep that). Never
  trade correctness for terseness.
- **CUPID + TDD + DDD** (the repo's stated methodology) — domain names first, small
  composable predictable units, tests prove them.
- **Tooling** — every TypeScript edit invokes `Skill mastering-typescript` (type-safe
  patterns, TS 5.9+ idioms). Every touched file is verified with **SonarQube**
  (`sonarqube:sonar-analyze <file>` per changed file, or the `sonarqube-reviewer` agent on
  the phase diff) on top of `eslint` + `tsc`. Blocker/Critical Sonar findings are fixed
  before a phase closes.
- **Security (secure TypeScript + general)** — a refactor must **not widen the attack
  surface**. This extension shells out to compile/run solution code and renders untrusted
  `.md` content in webviews, so every existing safeguard is preserved and none regressed:
  - **Untrusted input is typed and guarded** — parsed frontmatter, `## Tests`/`## Final Tests`
    JSON, and solution buffers are attacker-controlled. No `any`, no unchecked casts, no
    `JSON.parse` without the existing try/guard on that boundary.
  - **No command injection** — keep `child_process` calls on **argument arrays** with a
    validated temp-dir `cwd`; never interpolate a user path/name into a shell string. The
    candidate is written as a file and linked, never spliced (keep that model).
  - **No path traversal** — vault/attempt file names stay routed through `slugify` + validated
    `path.join` under `globalStorageUri`; never join raw user text into a filesystem path.
  - **Webview XSS** — all interpolated content stays `escHtml`-escaped under the existing CSP +
    `getNonce`; `localResourceRoots` stays restricted. A CSS split must not loosen the CSP.
  - **No secret leakage** — nothing sensitive in generated code, logs, the findings log, or
    committed artifacts. SonarQube's security rules + secrets scan are part of every review.

### Tooling prerequisite (one-time, before Sonar steps work)
SonarQube runs via MCP inside a container. Before any Sonar step functions, run
`/sonarqube:sonar-integrate`, `sonar auth login`, and start a container runtime
(Docker/Podman/Nerdctl). **If Sonar is unavailable**, the Gate's `pnpm lint` already
enforces the SonarSource `S`-rules (`S3776` cognitive-complexity, `S6594`, `S6557`,
`S4624`, …) as the fallback — proceed and note that deep Sonar analysis was skipped.
`mastering-typescript` has no such dependency; it is always available.

---

## Orchestration Workflow

**Roles.** One **Opus orchestrator** (drives the serial loop, runs gates + reviews, never
edits code itself). Each phase is executed by a **Sonnet subagent** — `caveman:cavecrew-builder`
only for genuinely 1–2 file edits (it hard-refuses 3+ files), `general-purpose` (model: sonnet)
for anything wider.

**Every spawned agent runs under caveman + ponytail + mastering-typescript (for TS edits).**
The orchestrator's prompt to each agent must include:

> Invoke `Skill ponytail` and `Skill caveman` first; for any TypeScript edit also invoke
> `Skill mastering-typescript` and apply its type-safe patterns. Honor the Guiding Principles
> above — **DRY, KISS, DOTW, performance**. Apply the ponytail ladder: reuse before writing;
> shortest diff that works; delete over add; no speculative abstraction. Respond caveman-terse.
> **Do not** change runtime behavior — this phase must leave the Gate green with zero failures
> (pass count may only grow, never shrink), and any codegen emit output byte-identical.
> **TDD:** for any pure,
> `vscode`-free unit you touch, ensure a failing/covering test exists **before** you refactor
> (add or update one if missing); make it green; then refactor. **JSDoc & comments:** every
> function and interface you add or change keeps a full JSDoc block (description, `@param`,
> `@returns`, `@example`); update stale comments; comments explain *why*. **Security:** treat
> parsed `.md`/test-JSON and solution buffers as untrusted (typed + guarded, no unchecked casts);
> keep `child_process` on argument arrays (no shell-string interpolation of user paths); no path
> traversal; keep webview `escHtml` + CSP + nonce; no secrets in output. Expect a
> **SonarQube** pass on your changed files after your edit; clear any Blocker/Critical finding
> (use `sonarqube:sonar-fix-issue <rule> <file>:<line>` if helpful). Report a diff receipt:
> files touched, lines removed/added, what was reused, tests added/updated.

**Per-phase inner loop (the key control).** Each phase is not "spawn → gate". It is:

1. **Task (TDD-first).** Agent writes/updates the test first where it makes sense, then makes
   the refactor pass it.
2. **Gate #1.** Orchestrator runs the Gate (below). Red → `SendMessage` the failure to the
   **same** agent to fix; repeat until green.
3. **Review (SonarQube + DRY/KISS/DOTW/perf).** Run `sonarqube:sonar-analyze` on each changed
   TS file (or the `sonarqube-reviewer` agent on the phase diff) for deep quality/security
   findings, then a human-eye pass for a fresh duplicate, a leftover cascade, a function over
   ~50 lines or cognitive-complexity ~15, a missing/wrong JSDoc, a dead branch, a needless
   scan. Combine the Sonar findings with `ponytail:ponytail-review` and/or
   `caveman:cavecrew-reviewer` output into one findings list.
4. **Remediate.** Send the findings back to the **same** agent (`SendMessage`, context intact)
   to apply — it may use `sonarqube:sonar-fix-issue <rule> <file>:<line>` for a specific Sonar
   hit. It fixes, updating tests + JSDoc as needed.
5. **Gate #2 + re-review.** Re-run the Gate, re-review the touched files. Loop 3–5 until the
   review is clean (no Blocker/Critical Sonar findings) **and** green.
6. **Record.** Orchestrator (a) appends a findings entry — **Discovered / Changed / Improved**
   (metrics) **/ Rule learned** — to `docs/plans/services-refactor-findings.md`; (b) ticks the
   phase off in the ledger `docs/plans/services-refactor-progress.md` (gate pass-count + commit
   sha); (c) commits the phase (Conventional Commits, e.g. `refactor(codegen): map dispatch`);
   (d) mirrors a one-line status to `memory/services-refactor-run-state.md`; and advances. The findings log is the input the
   separate CLAUDE.md-rewrite plan consumes.

**Gate (compile + lint + tests):**
```bash
pnpm compile
pnpm lint
node node_modules/.pnpm/mocha@*/node_modules/mocha/bin/mocha.js --ui tdd "dist/test/**/*.test.js"
```
(`compile` is `tsc -p ./`, so a separate `tsc --noEmit` adds nothing.)
Green = **zero failures and pass count ≥ the previous gate's** (baseline 467). TDD *adds*
tests, so the count grows — it must never *decrease* (a drop means a test was deleted or
silently skipped). Record the new count in the ledger each gate. (Do **not** use
`pnpm test` — it launches VS Code and fails on this repo's socket-path length; see CLAUDE.md.)

**Parallelism.** Phase 7 (CSS) and Phase 1 (utils) are independent of the codegen chain and
may run in parallel with phases above them. Everything else is serial (shared language
registry). Default: **serial**, for safe gates.

---

## Reuse Before Writing (existing assets — do not re-implement)

| Asset | Path | Use as |
|---|---|---|
| `escHtml` | `src/utils/html.helpers.ts` | HTML escaping — already reused ~30×, no new copies |
| `canonicalJson` | `src/utils/canonical-json.ts` | Comparison source of truth; generated per-language serializers must match it |
| `languagesForType` | `src/services/test-envs/env.registry.ts:59` | **Model** non-hardcoded pattern — derive from a registry, don't list |
| `VALID_OPTION_IDS`/`VALID_TEST_TYPES` | `src/services/leetcode-parser.service.ts:37` | **Model** for deriving an allowed-set from a constants array |
| `parseSentinelLines` | `src/services/test-envs/sentinel.helpers.ts:26` | Shared env `parse()` — the three envs already delegate here |
| `resolveLangId`/`extForLang` | `src/services/language-map.service.ts` | Already table-driven off `LANG_ALIAS`/`LANG_EXT`; extend to read `LANGUAGES` |
| `register`/`testEnvFor` | `src/services/test-envs/env.registry.ts` | Registry mechanism — keep; make registration data-driven |

---

## Phases

### Phase 0 — Baseline (orchestrator, no edits)
Branch off `main` (`refactor/services-dry`). Run the Gate; **record the mocha pass count** —
the behavior-preservation contract for every later gate. The existing codegen unit tests
assert exact emit output and serve as the golden lock; they must stay green. Create the
progress ledger `docs/plans/services-refactor-progress.md` (all tasks unchecked, baseline
recorded) and confirm the SonarQube tooling prerequisite above (or note it skipped).

### Phase 1 — Shared utils + constants moves (pure, unblocks the chain)
- **`escapeRe` (4 copies → 1):** keep the exported one at `leetcode-candidate.helpers.ts:59`
  **or** move to `src/utils/regex.helpers.ts`; delete the three local copies in
  `test-envs/function/{java,javascript,python}.env.ts` and import the shared one.
- **ms formatting (2 near-dups → 1):** new `src/utils/time.helpers.ts` with a shared
  `splitMs()` + thin `formatClock` (MM:SS) and `formatDuration` (XmYs). Rewire
  `leetcode-challenge.helpers.ts:27` and `leetcode-timer.service.ts:88`. Add unit tests first.
- **Constant dedupe:** `FENCE='```'` (`leetcode-run.handlers.ts:33` + `attempts-writer.service.ts:4`)
  → `src/types/constants.ts`. Fix re-hardcoded `'<<SOLUTION>>'` in
  `leetcode-codegen.service.ts:140,160,178,338` → import existing `SOLUTION_MARKER`.
- **Config-like literals → `constants.ts`:** `LEETCODE_DIR`, `TICK_MS`, `CONFIG_NS`,
  `VAULT_PATH_KEY`, `VAULT_CONFIGURED_KEY`, `END_CHALLENGE_COMMAND`, `SOLUTION_HINT`. Derive
  `VALID_DIFFICULTY` from a `DIFFICULTIES` array (kill the hardcoded set at parser:35).

### Phase 2 — Central `LANGUAGES` registry (the core)
- Define `LangId` + a `LANGUAGES` data map in `src/types/constants.ts` (if it pushes the file
  past ~400 lines, extract to sibling `src/types/languages.ts` re-exported). Each entry:
  `id`, `displayName`, `fileExt`, `commentPrefix`, `aliases`, `primitives`, box rules,
  container syntax, `detectCmd`.
- **Derive, don't duplicate:** rebuild `LANG_ALIAS`, `LANG_EXT`, `HASH_COMMENT_LANGS`,
  `SUPPORTED_LANGS`, and the bigo `SupportedLang` union **from** `LANGUAGES`. The `rust`
  drift disappears by construction. Add a test asserting the derived sets match expectations.

### Phase 3 — Codegen dispatch collapse (highest risk — behavior-critical)
- Split `leetcode-codegen.service.ts` (354L) into a `src/services/codegen/` folder: thin
  orchestrator + one module per language registered in `CODEGEN_BY_LANG: Record<LangId, LangCodegen>`.
- Replace the five `if (lang === …)` cascades (`mapType` containers, `wrapArray`/`wrapMap`,
  `generateBoilerplate`, `generateTestHarness`, `jsonToLiteral`/`boolLiteral`/`arrayLiteral`)
  with map dispatch. **Emit strings unchanged.**
- Dedupe `wrapBareBody` (`leetcode-candidate.helpers.ts:76`) against codegen decl shapes —
  one shared per-language decl fn.
- **Gate must confirm byte-identical golden codegen output** — existing codegen tests are the
  primary net; extend them to lock each dispatch path.

### Phase 4 — Unify run infra + function-env factory
- Delete `src/services/lang-runners/`; move `detectCmd`/`displayName` into `LANGUAGES` /
  `TestEnv`. Update `leetcode-run.handlers.ts` `RUNNERS` (:36) + `resolveRunSetup` (:197) +
  `detectRuntime` (`leetcode-runner.service.ts:72`) to read from config — removes the
  `RUNNERS`↔registry hand-sync.
- Collapse the three function envs into `makeFunctionEnv(spec)`: shared `parse` (via
  `parseSentinelLines`), shared `emit` skeleton + arg-row builder (`java.env.ts:125`,
  `javascript.env.ts:93`, `python.env.ts:92` are identical shape), shared `validate` pattern;
  per-language `spec` supplies `runnerSource` + the one validation rule. Register envs by
  iterating the function-capable languages. Add a factory unit test.

### Phase 5 — Section-slicing + safe-JSON dedupe + parser split
- Unify heading/section slicing: `leetcode-sections.helpers.ts` (reader) and
  `attempts-writer.service.ts` (writer, comment admits it "mirrors" the reader) → one boundary
  helper feeding both.
- Unify the `try { JSON.parse } catch` guard (`sections.helpers.ts:105,336` +
  `sentinel.helpers.ts:31`) into one util.
- **Parser 538L → under 400:** extract the six near-identical indented-line block parsers into
  a shared indented-block scanner in a new `leetcode-parser.helpers.ts` sibling. Parser tests
  must stay green throughout.

### Phase 6 — Narrow I/O extractions + type relocation
- Extract genuinely-pure-but-buried logic: `collectResults`/`errorResult`
  (`leetcode-runner.service.ts:212`) → `runner.helpers.ts`; `collectSettings`
  (`practice-mode.service.ts:89`) → helper; split validate-vs-toast in `vault.service.ts:20`.
  New pure helpers get new unit tests (TDD).
- Move cross-boundary **pure** types to `src/types/leetcode.types.ts`: `BigOConfidence`/
  `BigOEstimate` (`leetcode-bigo.service.ts:13,23`), `AttemptEntry`
  (`attempts-writer.service.ts:16`). **`PanelCtx` stays in `leetcodeView.provider.ts`** — it
  holds `vscode.ExtensionContext`/`WebviewView`/`Uri`, and the domain model in `src/types/`
  must stay free of VS Code types (repo rule). Leave runtime session objects
  (`ChallengeSession`/`ChallengeCallbacks`) and the co-located `test-envs/env.types.ts` in place.

### Phase 7 — CSS (independent; may run parallel)
- **Delete dead blocks** (zero TS references — verified during planning): var-set diff
  (`styles.css:570-633`), hljs syntax highlighting (~:416-568), code-block line-numbers (:513).
  Re-verify each block's class names have no TS hit before cutting.
- **Split live LeetCode blocks** (:635–925) → `src/ui/leetcode-preview.css`; keep settings +
  shared chrome in `styles.css`. Wire the extra `<link>`/`cssUri` in `leetcodeView.provider.ts`
  and the preview shell in `leetcode-run.handlers.ts:315`.
- Verify via F5 (CSS is not unit-tested).

### Phase 8 — Finalize (orchestrator)
Full Gate. Final `ponytail:ponytail-review` + `caveman:cavecrew-reviewer` pass on the whole
branch diff, plus a **SonarQube security sweep** of the branch (`sonarqube-reviewer` /
`sonar-analyze`) — no unresolved Blocker/Critical, secrets scan clean. `.md` format spec
untouched → no `ARTIFACT_LEETCODE_FILE_FORMAT.md` change. **CLAUDE.md is updated by a separate
plan — [`docs/plans/claude-md-rewrite.md`](claude-md-rewrite.md) — run after this refactor
merges** (it needs the final tree + the findings log). Open PR.

---

## Critical Files

| Concern | Files |
|---|---|
| Language registry | `src/types/constants.ts` (+ maybe `src/types/languages.ts`), `src/types/leetcode.types.ts` |
| Codegen dispatch | `src/services/leetcode-codegen.service.ts` → `src/services/codegen/`, `src/services/leetcode-candidate.helpers.ts` |
| Run infra | `src/services/lang-runners/*` (delete), `src/services/test-envs/function/*.env.ts`, `src/services/test-envs/env.registry.ts`, `src/services/leetcode-runner.service.ts`, `src/commands/leetcode-run.handlers.ts` |
| Parser | `src/services/leetcode-parser.service.ts` (+ new `.helpers.ts`) |
| Slicing/JSON dedupe | `src/services/leetcode-sections.helpers.ts`, `src/services/attempts-writer.service.ts`, `src/services/test-envs/sentinel.helpers.ts` |
| Utils | `src/utils/regex.helpers.ts` (new), `src/utils/time.helpers.ts` (new) |
| CSS | `src/ui/styles.css`, `src/ui/leetcode-preview.css` (new) |

---

## Verification

Behavior preservation is the whole point — verify it, don't assume it.

1. **Gate after every phase** (compile / `tsc --noEmit` / lint / mocha) — pass count equals
   the Phase 0 baseline. Plus the **per-phase review→remediate→re-test loop** above.
2. **Golden codegen** after Phase 3: the codegen unit tests assert exact emit output for the
   sample two-sum in java/python/javascript — must stay green (extend to cover each dispatch path).
3. **End-to-end run** (F5): open a `type: leetcode` note, Solve It, Run Tests, Submit — pass
   and fail paths, java + python + javascript. Timer (bounded down / unlimited up), status
   writes, restrictions restore.
4. **CSS visual** (F5): settings, preview, sidebar, result rows, practice controls render
   unchanged after the split/delete.
5. **New-language smoke** (proves the goal): add a throwaway language as a `LANGUAGES` config
   entry + its codegen module + env spec, confirm it appears in the selector and runs, then
   revert. Adding a language should now be ~2 files, not ~15.
6. **Security check:** SonarQube security rules + secrets scan clean on the branch; no new
   `child_process` call built from an interpolated user string (argument arrays only); webview
   output still `escHtml`-escaped under the unchanged CSP + nonce; untrusted `.md`/test-JSON
   parsing still typed and guarded; no path traversal in attempt-file naming. Fallback if Sonar
   is unavailable: manual review + `pnpm lint`.

---

## Progress Tracking & Resume (survive a session limit)

Two synced records, so work continues cleanly in a fresh session:

1. **Ledger (source of truth, git-committed):** `docs/plans/services-refactor-progress.md` —
   a checkbox per task (T0–T7) with the inner-loop sub-steps (edit → gate#1 → mastering-typescript
   → sonar-analyze → review → remediate → gate#2 → committed), the current mocha pass-count
   (zero failures, **≥ 467**, never decreasing), a **RESUME HERE** pointer, and the last commit sha. The orchestrator
   updates and **commits** it at the end of every phase (inner-loop step 6). Because it is
   committed to `refactor/services-dry`, the state is on disk regardless of session.
2. **Findings log (knowledge, git-committed):** `docs/plans/services-refactor-findings.md` — per
   phase: Discovered / Changed / Improved (metrics) / Rule learned. Captures *what was learned*
   (vs the ledger's *status*), and is the primary input to the separate CLAUDE.md-rewrite plan.
3. **Memory mirror (auto-recall):** `memory/services-refactor-run-state.md` — one-line status
   loaded at session start, pointing back at the ledger, findings log, and the plan.

**To resume in a new session:** read `docs/plans/services-refactor-progress.md`, find
**RESUME HERE**, verify the branch + `git log`, re-run the Gate to confirm the pass-count, then
dispatch the next unchecked task. No context from the prior session is required — the ledger +
this plan are self-sufficient.

---

## Subagent Task Queue (copy-ready dispatch specs)

Phase 0 and Phase 8 are **orchestrator-only** (baseline + finalize). Tasks **T1–T7** below
are the Sonnet subagents. Dispatch **serially** in order, except **T7** (CSS) and **T1**
(utils) which may run in parallel with the chain. After each task, run the **per-phase inner
loop** (Gate #1 → DRY/KISS/DOTW review → remediate via `SendMessage` to the same agent →
Gate #2 + re-review → record resume point) before advancing.

### Standard preamble — prepend to EVERY task prompt
> You are a Sonnet subagent in an Opus-orchestrated refactor. First invoke `Skill ponytail`
> and `Skill caveman`; for any TypeScript edit also invoke `Skill mastering-typescript`.
> Honor the Guiding Principles: **DRY, KISS, DOTW (do one thing well),
> performance/efficiency**. Ponytail ladder: reuse before writing, shortest working diff,
> delete over add, no speculative abstraction. Respond caveman-terse.
> **Behavior invariant:** do not change runtime behavior — the Gate must stay green with zero
> failures (pass count only grows), and codegen emit output byte-identical. **TDD:** for any pure,
> `vscode`-free unit you touch, ensure a covering/failing test exists **before** refactoring
> (add/update if missing), green it, then refactor. **JSDoc/comments:** every function &
> interface you add or change carries a full JSDoc block (description, `@param`, `@returns`,
> `@example`); fix stale comments; comments say *why*. Only touch the files this task names
> (plus their direct importers when a move requires it). **Security:** untrusted `.md`/test-JSON
> + solution buffers stay typed and guarded; `child_process` on argument arrays (no shell-string
> interpolation); no path traversal; keep webview escaping/CSP/nonce; no secrets in output. Your
> changed files get a **SonarQube** pass — clear Blocker/Critical findings
> (`sonarqube:sonar-fix-issue <rule> <file>:<line>` if useful). **Receipt:** report files touched,
> lines ±, what you reused, tests added/updated. Gate command (green = zero failures, pass count
> never below the previous gate's):
> `pnpm compile && pnpm lint && node node_modules/.pnpm/mocha@*/node_modules/mocha/bin/mocha.js --ui tdd "dist/test/**/*.test.js"`

### T1 — Shared utils + constants moves
- **Agent:** `general-purpose` (sonnet) — spans ~15 files. **Depends:** T0 baseline. **Parallel-safe.**
- **Touches:** `src/utils/regex.helpers.ts` (new), `src/utils/time.helpers.ts` (new),
  `test-envs/function/{java,javascript,python}.env.ts`, `leetcode-challenge.helpers.ts`,
  `leetcode-timer.service.ts`, `leetcode-codegen.service.ts`, `leetcode-run.handlers.ts`,
  `attempts-writer.service.ts`, `leetcode-parser.service.ts`, `vault.service.ts`,
  `vault-path.store.ts`, `context.service.ts`, `leetcode-challenge.service.ts`,
  `exercise-file.helpers.ts`, `src/types/constants.ts`.
- **Do:** collapse `escapeRe` (4→1); shared `splitMs`+`formatClock`/`formatDuration` in
  `time.helpers.ts`; dedupe `FENCE`; replace re-hardcoded `'<<SOLUTION>>'` with
  `SOLUTION_MARKER` import; move `LEETCODE_DIR`/`TICK_MS`/`CONFIG_NS`/`VAULT_PATH_KEY`/
  `VAULT_CONFIGURED_KEY`/`END_CHALLENGE_COMMAND`/`SOLUTION_HINT` to `constants.ts`; derive
  `VALID_DIFFICULTY` from a `DIFFICULTIES` array.
- **TDD:** new tests for `time.helpers` (both formats) and `regex.helpers`.
- **Done-when:** zero duplicate `escapeRe`/`FENCE`/`'<<SOLUTION>>'` literals remain; Gate green.

### T2 — Central `LANGUAGES` registry
- **Agent:** `general-purpose` (sonnet). **Depends:** T1.
- **Touches:** `src/types/constants.ts` (+ `src/types/languages.ts` if >~400 lines),
  `language-map.service.ts`, `leetcode-codegen.service.ts`, `leetcode-bigo.service.ts`,
  `exercise-file.helpers.ts`.
- **Do:** define `LangId` + `LANGUAGES` data map (id, displayName, fileExt, commentPrefix,
  aliases, primitives, box rules, container syntax, detectCmd). Re-derive `LANG_ALIAS`,
  `LANG_EXT`, `HASH_COMMENT_LANGS`, `SUPPORTED_LANGS`, bigo `SupportedLang` **from** it.
- **TDD:** test asserting derived sets equal the current values (locks no behavior drift).
- **Done-when:** one source of truth for the language set; `rust` drift resolved; Gate green.

### T3 — Codegen dispatch collapse (behavior-critical)
- **Agent:** `general-purpose` (sonnet). **Depends:** T2.
- **Touches:** `src/services/leetcode-codegen.service.ts` → new `src/services/codegen/`
  folder (orchestrator + per-language modules + `CODEGEN_BY_LANG` map),
  `leetcode-candidate.helpers.ts`.
- **Do:** **step 1 (before touching code):** extend the codegen tests to lock the exact emit
  strings of every dispatch path (boilerplate + harness + literals, per language) against the
  *current* implementation — this is the golden net. **Step 2:** replace the 5 `if (lang===…)`
  cascades with map dispatch under those unchanged tests; dedupe `wrapBareBody` against the
  per-language decl fn.
- **TDD:** the step-1 golden tests are written first and never edited during step 2 — they
  passing unchanged **is** the byte-identical proof.
- **Done-when:** no per-language `if` cascade left in codegen; golden tests untouched + green;
  Gate green.

### T4 — Unify run infra + function-env factory
- **Agent:** `general-purpose` (sonnet). **Depends:** T2 (T3 preferred first).
- **Touches:** delete `src/services/lang-runners/`; `test-envs/function/*.env.ts`,
  `test-envs/env.registry.ts`, `leetcode-runner.service.ts`, `leetcode-run.handlers.ts`.
- **Do:** fold `detectCmd`/`displayName` into `LANGUAGES`/`TestEnv`; rewire `RUNNERS`/
  `resolveRunSetup`/`detectRuntime` to read config; collapse 3 envs into
  `makeFunctionEnv(spec)` (shared parse/emit skeleton/arg-row builder; per-lang spec supplies
  `runnerSource` + validate rule); register envs by iterating function-capable languages.
- **TDD:** unit test for `makeFunctionEnv` (emit/validate/parse for one language).
- **Done-when:** `lang-runners/` gone; single run authority; Gate green.

### T5 — Section-slicing + safe-JSON dedupe + parser split
- **Agent:** `general-purpose` (sonnet). **Depends:** T1.
- **Touches:** `leetcode-sections.helpers.ts`, `attempts-writer.service.ts`,
  `sentinel.helpers.ts`, `leetcode-parser.service.ts` (+ new `leetcode-parser.helpers.ts`).
- **Do:** one shared heading/section-boundary helper for reader+writer; one shared
  safe-JSON-parse guard; extract the 6 indented-block parsers into a shared scanner; parser
  file back under ~400 lines.
- **TDD:** parser + sections tests stay green; add a test for the shared boundary helper.
- **Done-when:** slicing/JSON logic single-sourced; parser <400L; Gate green.

### T6 — Narrow I/O extractions + type relocation
- **Agent:** `general-purpose` (sonnet). **Depends:** T3, T4.
- **Touches:** `leetcode-runner.service.ts` (+ new `runner.helpers.ts`),
  `practice-mode.service.ts`, `vault.service.ts`, `leetcode-bigo.service.ts`,
  `attempts-writer.service.ts`, `leetcodeView.provider.ts`, `src/types/leetcode.types.ts`.
- **Do:** extract pure `collectResults`/`errorResult`, `collectSettings`, vault
  validate-vs-toast; move `BigOConfidence`/`BigOEstimate`/`AttemptEntry` types to
  `leetcode.types.ts`. **`PanelCtx` stays put** (vscode types — `src/types/` stays
  vscode-free). Leave `ChallengeSession`/`ChallengeCallbacks` + `env.types.ts` in place.
- **TDD:** new unit tests for the extracted pure helpers.
- **Done-when:** narrow helpers extracted + tested; cross-boundary types relocated; Gate green.

### T7 — CSS: delete dead + split live
- **Agent:** `general-purpose` (sonnet) — 4 files. **Depends:** none. **Parallel-safe.**
- **Touches:** `src/ui/styles.css`, new `src/ui/leetcode-preview.css`,
  `leetcodeView.provider.ts`, `leetcode-run.handlers.ts`.
- **Do:** re-verify zero TS refs, then delete var-set (:570-633), hljs (~:416-568),
  code-block line-numbers (:513); split live LeetCode blocks (:635-925) into
  `leetcode-preview.css`; wire the extra `<link>`/`cssUri`.
- **Verify:** F5 visual (no unit test for CSS) — settings/preview/sidebar/results unchanged.
- **Done-when:** ~350 dead lines gone; live LeetCode CSS in its own file; F5 renders unchanged.
