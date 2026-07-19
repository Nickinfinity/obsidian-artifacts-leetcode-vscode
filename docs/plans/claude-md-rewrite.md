# CLAUDE.md Rewrite — Slim + Standing Rules

## Context

`CLAUDE.md` is long and, after the services refactor, partly out of date. This plan cuts its
bulk **and** encodes the refactor's new approach as **standing rules every future task
inherits** — so the config-driven architecture, file-placement conventions, and secure-coding
+ tooling loop are applied automatically, not re-derived each time.

**Runs after [`services-refactor.md`](services-refactor.md) merges** — it documents the *final*
tree (new `src/services/codegen/`, deleted `lang-runners/`, new `src/ui/leetcode-preview.css`,
new `src/utils/{regex,time}.helpers.ts`) and is **grounded in the findings log**
`docs/plans/services-refactor-findings.md` (the "Rule learned" entries), not guesses.

**Scope:** `CLAUDE.md` only. `ARTIFACT_LEETCODE_FILE_FORMAT.md` stays the authoritative on-disk
spec and is unchanged.

**Invariant:** **drop no currently-enforced rule silently.** Shorter must not mean weaker — every
rule removed from prose is either still enforced by tooling (ESLint/tsc/SonarQube) or restated
more tersely. This is a compression + update, not a loosening.

---

## Why it's separate from the refactor

The refactor changes code with a behavior-preservation invariant and a mocha gate; this changes
one Markdown file with no runtime surface. Different risk, different review, cleanly its own PR.
It also *depends on* the refactor being done, so coupling them would block the doc on the code.

---

## Approach (single Sonnet subagent, orchestrated)

One `general-purpose` (sonnet) agent under **ponytail + caveman + mastering-typescript**
(mastering-typescript is a no-op here — docs only — but keep the standard preamble uniform).

**Do:**

1. **Cut duplication (biggest size win).** `CLAUDE.md` re-documents the whole `.md` file format —
   the frontmatter field table, the `test:`/`practice:` blocks, section semantics. That is
   `ARTIFACT_LEETCODE_FILE_FORMAT.md`'s job. Replace those long tables with a **short pointer** to
   the spec, keeping only a few lines of orientation.
2. **Update architecture facts** to the post-refactor tree: central `LANGUAGES` registry +
   config-driven extensibility (**a new language ≈ 1 config entry + 1 codegen module + 1 env
   spec, not ~15 edits**); `src/services/codegen/` folder; `lang-runners/` deleted; run infra
   unified on `TestEnv`/config; `src/ui/leetcode-preview.css`; `src/utils/{regex,time}.helpers.ts`.
   Pull the concrete before/after numbers from the findings log.
3. **Codify the standing rules — tight:**
   - **Principles:** DRY, KISS, DOTW (do one thing well) — reuse before writing, simplest thing
     that works, one concern per file/function.
   - **Security (secure TypeScript + general):** untrusted `.md`/test-JSON + solution buffers are
     typed and guarded (no `any`/unchecked casts, no unguarded `JSON.parse`); `child_process` on
     **argument arrays**, never shell-string interpolation of user paths; no path traversal
     (route file names through `slugify` + validated `path.join`); webview output stays
     `escHtml`-escaped under CSP + `getNonce`, `localResourceRoots` restricted; no secrets in code
     or logs.
   - **File-placement decision flow (where files go):** domain logic → `services/*.service.ts`
     (+ `*.helpers.ts` sibling for pure fns); types/interfaces → `src/types/` (widely-depended
     config → `src/types/constants.ts`, else a sibling in the same folder); pure cross-cutting →
     `src/utils/` (general → `helpers.ts`, else own file); webview HTML/handlers →
     `src/ui/panels|views`; CSS → shared → `src/ui/styles.css`, feature-specific → own file in
     `src/ui`.
   - **Ordering / complexity limits:** one concern per file, `*.helpers.ts` siblings for pure
     fns, ~400 lines/file, ~50/function, cognitive-complexity ≤15, split before growing.
   - **Config-driven rule:** never hardcode a language/test-type list inline — derive from the
     constants registry (models: `languagesForType`, `VALID_*`).
   - **Tooling-in-the-loop:** TS edits use `mastering-typescript`; verify with SonarQube
     (`sonarqube:sonar-analyze`) + `eslint` + `tsc`; TDD-first for pure units.
4. **Keep it scannable:** target **~30–40% shorter** overall.

**Review:** `ponytail:ponytail-review` on the `CLAUDE.md` diff for over-documentation; confirm
every folder/file the refactor created or deleted is reflected, and cross-check against the
findings log that no "Rule learned" was missed.

---

## Verification

1. `CLAUDE.md` is meaningfully shorter (~30–40%) yet still names: the commands, the folder
   structure (post-refactor), the complexity limits, the ESLint gotchas, TDD/CUPID/DDD, the new
   config-driven + security + file-placement rules.
2. Every path it mentions exists in the tree; nothing references deleted `lang-runners/` or the
   old codegen file layout.
3. Gate still green (docs-only change, but run it):
   `pnpm compile && pnpm lint && node node_modules/.pnpm/mocha@*/node_modules/mocha/bin/mocha.js --ui tdd "dist/test/**/*.test.js"`
4. Diff-read: no enforced rule silently dropped — spot-check each removed paragraph is either
   tooling-enforced or restated.

---

## Resume

Single task; if interrupted, the input is fully external: this plan + the merged refactor +
`docs/plans/services-refactor-findings.md`. Re-read those and continue. Tracked as a one-line
entry in `memory/services-refactor-run-state.md` once the refactor completes.
