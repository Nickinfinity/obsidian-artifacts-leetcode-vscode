# Services Refactor — Findings / Conclusions Log

Knowledge artifact appended each phase (inner-loop step 6): **Discovered / Changed / Improved**
(metrics) **/ Rule learned**. Primary input to [`claude-md-rewrite.md`](claude-md-rewrite.md).
Distinct from the [progress ledger](services-refactor-progress.md) (status) — this captures what
was *learned*.

---

## Phase 0 — Discovery (planning exploration)

**Discovered:**
- Adding one language today = **~15 scattered touch points**; a new test type = ~5. The env
  registry (`test-envs/env.registry.ts`) already **is** the capability matrix (Map keyed
  `type::language`) — good bones, under-used.
- **Parallel language authorities that DRIFT:** `RUNNERS` (run.handlers), `SUPPORTED_LANGS` +
  `PRIMITIVES` + `JAVA_BOX` (codegen), `SupportedLang` (bigo), `LANG_ALIAS`/`LANG_EXT`
  (constants), `HASH_COMMENT_LANGS`. Codegen knows `rust`; the registry and runners do not —
  proof the duplication has already drifted.
- **Duplication:** `escapeRe` ×4 (canonical in `candidate.helpers`); section-slicing reader
  (`sections.helpers`) vs writer (`attempts-writer`, whose comment admits it "mirrors" the
  reader); env arg-row builder ×3; ms-format `formatRemaining` vs `formatDuration`;
  safe-JSON-parse guard ×3; two parallel run tables (`lang-runners` vs `test-envs`).
- The 3 function envs are ~80% boilerplate (identical `parse`, duplicated `escapeRe`, same
  `emit` skeleton) — collapsible to a `makeFunctionEnv(spec)` factory.
- **~350 lines of DEAD CSS** in `styles.css` (var-set `:570-633`, hljs highlight `~:416-568`,
  code-block line-numbers `:513`) — zero TS references, leftover from the ported core extension.
- No CSS embedded in `.ts` (already good). `TestEnv.requires`/`detect` are wired but unused
  (forward hook for library-backed envs).
- `SOLUTION_MARKER` re-hardcoded in codegen despite the constant existing; `FENCE` literal
  duplicated across two files.

**Rule learned (→ CLAUDE.md candidates):**
- Never hardcode a language/test-type list inline — **derive from the constants registry**
  (models: `languagesForType`, `VALID_*`).
- One config-driven source of truth per cross-cutting concern; a second copy is drift waiting to
  happen.
- `.service.ts` naming ≠ impure — several "services" are already 100% pure; name by concern, put
  pure logic in `*.helpers.ts` siblings.

**Baseline metrics:** `src/services` ~4,400 lines / 30 files; parser 538L; `styles.css` 925L;
**467 tests** green.

---

<!-- Per-phase entries appended below as the run proceeds (T1…T7). -->

## T1 — Shared utils + constants (verified already landed)

**Discovered:** T1 was **already implemented + committed** in prior work, though the ledger/memory
said "not started". Reality on branch: `escapeRe` single-sourced in `src/utils/regex.helpers.ts`
(3 envs import it, `candidate.helpers` re-exports); `src/utils/time.helpers.ts` exists with
`splitMs`/`formatClock`/`formatDuration`, and `leetcode-challenge.helpers` re-exports
`formatClock as formatRemaining`; `FENCE`, `SOLUTION_MARKER`, and all config consts
(`LEETCODE_DIR`/`TICK_MS`/`CONFIG_NS`/`VAULT_*`/`END_CHALLENGE_COMMAND`/`SOLUTION_HINT`) live in
`constants.ts`; `VALID_DIFFICULTY` derived from a `DIFFICULTIES` array. Tests
`time.helpers.test.ts` + `regex.helpers.test.ts` present.

**Rule learned:** trust the tree over the ledger — verify each task's claimed state before
dispatching. Re-run the Gate and grep for the target literals first.

## T2 — Central LANGUAGES registry

**Changed:** added `src/types/languages.ts` — `LangId` union + `LANGUAGES` registry (id,
displayName, fileExt, commentPrefix, detectCmd, aliases) + `LANG_IDS` + `isLangId` guard. Rewired
`leetcode-bigo.service.ts` `SupportedLang`/`toSupportedLang` to derive from it. Added
`leetcode-languages.test.ts` locking the registry against `LANG_ALIAS`/`LANG_EXT` drift and pinning
the runnable set.

**Improved:** the runnable-language set now has ONE home; bigo's hand-typed 3-way `||` gone.
Gate 467 → **493** passing (+8 registry tests, zero failures).

**Rule learned (scoping):** the plan's "derive LANG_ALIAS/LANG_EXT/HASH_COMMENT_LANGS/
SUPPORTED_LANGS from LANGUAGES" over-reaches. Those are **not duplicated** (each lives once) and
serve different concerns:
- `LANG_ALIAS`/`LANG_EXT` are broad **cosmetic** tables (40+ languages, fence→id/ext) — folding
  them into a 3-language runnable registry would bloat, not simplify. Guarded against drift with a
  consistency test instead.
- codegen `SUPPORTED_LANGS` includes `rust` because rust is **type-mappable** (has typemap tests)
  but not **runnable** — a correct distinction, not the drift bug. Left for T3 (codegen owns it);
  dropping rust would break `leetcode-typemap.test.ts` (invariant violation).
- `HASH_COMMENT_LANGS` (`{python,ruby,shellscript,perl,r,yaml}`) lives once and its non-executable
  entries are **unreachable** (`generateBoilerplate` returns `''` for them before the prefix line).
  No dedup to gain; left alone.
So T2's registry covers the genuinely hand-synced **executable-language metadata** only. `detectCmd`/
`displayName` sit ready for T4 to consume when it **deletes** `lang-runners/` (editing those files
in T2 just to delete them in T4 would be churn — transient dup removed by deletion).

## T3 — Codegen dispatch collapse (behavior-critical)

**Changed:** killed the genuine multi-way per-language cascades in
`leetcode-codegen.service.ts` — `wrapArray` (3-way), `wrapMap` (5-way), the `SUPPORTED_LANGS` gate,
and the `generateBoilerplate`/`generateTestHarness` 4-way ifs — replacing them with two dispatch
tables: `TYPE_SYNTAX: Record<string, TypeSyntax>` (java/python/javascript/**rust**, drives
`mapType`) and `LANG_CODEGEN: Record<LangId, LangCodegen>` (runnable set from the T2 registry,
drives boilerplate + harness via an `isLangId` gate). Adding a language = one row per table.

**Improved:** first real consumer of the T2 registry (`isLangId`/`LangId`). File 354→353L (neutral;
the win is one dispatch source, not fewer lines). Gate 493→**504** (+11 byte-exact golden tests).

**Golden net:** captured the pre-refactor emit for every boilerplate/harness path as byte-exact
`strictEqual` snapshots (`test/leetcode-codegen-golden.test.ts`) **before** editing — these + the
already-byte-exact `leetcode-typemap` (all 4 langs incl. rust, java-box, passthroughs) and
`jsonToLiteral` suites are the byte-identical proof. Wrote golden first, never edited during the
refactor.

**Rule learned / deviations (grounded in KISS + CLAUDE.md's own 400-line rule):**
- **Two dispatch tables, not one `CODEGEN_BY_LANG`.** Type-mapping spans 4 langs (rust is
  type-mappable≠runnable — dropping it breaks `leetcode-typemap.test.ts`); boilerplate/harness span
  the runnable 3. Forcing one `Record<LangId,…>` would silently drop rust type-mapping. The two
  concerns get two correctly-keyed tables — better DDD than a lossy merge.
- **No `codegen/` folder split.** Plan wanted a folder; file is 353L, under CLAUDE.md's 400
  threshold. Splitting cohesive sub-400 logic into 5 files hurts navigation for zero gain.
- **jsonToLiteral's python/java branches left as binary `? :` specializations.** They aren't
  sprawling cascades — they're 2-way (special-vs-default) with a graceful default for *unknown*
  languages. Mapping them would need `?? default` everywhere = more code, and would risk the
  defensive default. Not the defect the phase targets.
- **`wrapBareBody` (candidate.helpers) cross-dedup declined.** Plan wanted a "shared per-language
  decl fn" between it and codegen. The overlaps are one-line signature fragments with different
  indentation/marker/class-wrapping; a shared helper parameterised over all that reads worse than
  two small functions. Cross-file coupling for a one-liner is negative value.

## T4 — Run-infra unify + makeFunctionEnv (two commits)

**T4a (run infra):** deleted `src/services/lang-runners/` (4 files) + the `LangRunner` type. The
candidate-splice execution model was replaced by `env.emit()` long ago, so `LangRunner`'s
`compile`/`run`/`fileName`/`fileExtension`/`id` were **dead** — only `detectCmd`/`displayName` were
still read, and both already live in the T2 registry. `resolveRunSetup` now gates via `isLangId` +
reads `LANGUAGES[langId]`; `detectRuntime` takes a `detectCmd: string`; `runtimeReady` reads
`lang.detectCmd`/`displayName`. The `RUNNERS`↔registry hand-sync is gone.

**T4b (factory):** collapsed the 3 function envs onto `makeFunctionEnv(spec)` — it owns
`type:'function'`, the two-file emit shape, and the shared `parseSentinelLines` (was copied 3×);
each env passes its per-language `runnerSource`/`candidateContent`/`validate` as a spec. Envs
549L/3 files → 516L/4 files.

**Improved:** one run authority; adding a runnable language is now ~a registry row + a codegen
row/module + a `makeFunctionEnv` spec — no `RUNNERS`/`SUPPORTED_LANGS`/`SupportedLang` hand-sync.

**Test count — justified drop 504→485→491.** Deleting `lang-runners/` obsoleted
`leetcode-runners.test.ts` (it only exercised the deleted `LangRunner` config fields, incl. the
dead ones). Its **live** assertions (exact `detectCmd`/`displayName`, the `detectRuntime` probe)
were relocated to `leetcode-languages.test.ts` + `leetcode-runner.test.ts`; T4b added a factory
test. Net 491 ≥ 467 baseline. This is the sanctioned "delete tests for deleted code" case, done
loudly (documented here + in the commit), not silently.

**Rule learned (process):** `tsc` does **not** remove orphaned `dist/*.js` — after deleting a
source/test file the stale compiled `.js` keeps running under the mocha glob and inflates the pass
count (saw a phantom 507). **Always `rm -rf dist` before the gate whenever a file was deleted or
renamed.** Byte-identical proof for T4b came from the unchanged per-language `function-env-*` tests
passing against the factory-built envs.

## T5 — Section-slice + safe-JSON dedupe + parser split (two commits)

**T5a (`67a8957`):** two single-sourcings. `safeJsonParse<T>` (`src/utils/safe-json.ts`) replaces the
guarded `JSON.parse` copied in `parseSentinelLines`, `extractJsonCases`, and `parseHtmlCommentJson`.
`sectionBounds(text, headingRe, boundaryRe)` (`leetcode-section-bounds.helpers.ts`) replaces the
identical find-heading→find-boundary→compute-bounds math the reader
(`extractSection`/`extractTopLevelSection`) and the writer (`locateTopSection`, whose own comment
said it "mirrors the reader") each had. Reader slices `[headingEnd,bodyEnd)`, writer splices around
them; the writer's private `TopSection` type is now the shared `SectionBounds`.

**T5b (`02d7452`):** split the 539L parser. Public API (`parseLeetCode`, `parseFrontmatterOnly`,
`functionNameFor`) stays in `leetcode-parser.service.ts` (**114L**); all frontmatter-block parsing
moved to `leetcode-parser.helpers.ts` (431L), re-exporting the two config defaults so existing
importers are unaffected. Extracted `scanIndentedBlock(lines, start, onLine)` — the
`while(/^\s/){trim; skip-blank}` loop the 6 block parsers shared; each now supplies only its
per-line dispatch. Merged params' two equivalent early-returns.

**Improved:** guarded-JSON single-sourced (3→1); section slicing single-sourced (3→1, reader+writer
no longer drift); parser god-file broken up. Gate 491→**499** (+5 section-bounds, +3 safe-json).

**Rule learned:**
- **The helpers file landed at 431L, over the plan's "<400" target.** Kept it: it's *one* cohesive
  concern (frontmatter parsing), under CLAUDE.md's own 500 "plan a split" / 700 "must split"
  thresholds, and JSDoc-mandated density inflates it. Splitting the dispatcher from its 6 tightly
  coupled block parsers just to hit 400 would fragment one concern across two files — worse to read.
  The real goal (no 539L god-file mixing public API + internals) is met: 114L API + 431L internals.
- **`sectionBounds` slices *include* the leading `\n`** after the heading (the `$` heading match
  stops before the newline) — exactly as the pre-refactor `extractSection` did; callers trim or
  fence-match past it. My first boundary-helper test asserted the trimmed form and failed 3× — the
  function was right, the naive test was wrong. Real sections/parser tests staying green was the
  proof of byte-identity; I corrected the new test to the true bounds.

## T6 — Narrow I/O extractions + type relocation (`b8c2de9`)

**Changed:**
- `collectResults`/`errorResult`/`RunFailure` → `leetcode-runner.helpers.ts`. Pure result-mapping
  (timeout attribution, canonical compare, error mapping) that was buried in the subprocess-driving
  runner service; now unit-tested directly (6 tests) instead of only via slow integration runs.
- `collectSettings` → `practice-mode.helpers.ts`. The one pure, `vscode`-free function trapped in
  the vscode-coupled `PracticeMode`; extracting it makes the option→settings flattening testable
  without the editor (4 tests).
- Types `BigOConfidence`/`BigOEstimate`/`AttemptEntry` → `src/types/leetcode.types.ts` (canonical
  home). `bigo.service` + `attempts-writer` import them; `panel`/`handlers` import from types
  (merged into existing type-imports to avoid S3863 duplicate-import).

**Improved:** two pure units lifted out of I/O/vscode modules and covered by fast unit tests; domain
types consolidated in `types/`. Gate 499→**509** (+6 runner-helpers, +4 practice-mode).

**Deviation:** skipped the planned `vault.service` validate-vs-toast split. Both callers
(`settings.panel`, `leetcode.command`) invoke it as `if (!validateObsidianVault(...))` and *want*
the failure toast — no caller needs a toast-free predicate, so extracting the one-line
`fs.existsSync` check into its own module + fs-test is speculative abstraction for zero current gain.
`PanelCtx` (holds vscode types) and `ChallengeSession`/`ChallengeCallbacks`/`env.types.ts` left in
place, per the plan (domain `types/` stays vscode-free).
