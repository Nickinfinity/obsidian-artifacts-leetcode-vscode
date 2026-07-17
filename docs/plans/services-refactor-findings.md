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
