# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

## Commands

```bash
pnpm install       # Install deps (no node_modules by default — run after clone)
pnpm compile       # One-off TypeScript build → dist/
pnpm watch         # Watch mode (preferred during active development)
pnpm lint          # ESLint over src/
pnpm test          # compile + lint + tests
npx tsc --noEmit   # Type-check only — IDE diagnostics go stale; this is the truth
```

`pnpm test` launches a real VS Code instance and fails on this checkout with `listen EINVAL
… 1.12-main.sock … longer than 103 chars` — the repo path pushes the IPC socket past the
macOS limit and `--user-data-dir` is ignored. Every test module is `vscode`-free, so run
**the gate** straight from `dist/`:

```bash
pnpm compile && pnpm lint && \
  node node_modules/.pnpm/mocha@*/node_modules/mocha/bin/mocha.js --ui tdd "dist/test/**/*.test.js"
```

`tsc` does **not** delete orphaned `dist/*.js` — after deleting or renaming any file,
`rm -rf dist` first or stale compiled tests keep running and inflate the pass count.
Press **F5** for the Extension Development Host — the only check for `vscode`-coupled code.

### ⚠️ Artifacts live in the vault, never in this repo

**Never create or keep `.md` exercise artifacts inside this repository.** There is no
`examples/` folder and none may be reintroduced — it was deleted precisely because a second
home for artifacts drifts from the vault that actually runs them, and because a repo copy
invites a test to guard the copy instead of the real thing.

- Artifacts belong in the **Obsidian vault**, under the exercises directory the picker
  resolves (`LeetCode/` by default, the vault root when `useVaultRoot` is on).
- Need an artifact to validate or reproduce something? Create it in the vault under a **`Tests/`**
  tree — the home for smoke and regression artifacts. There are two, and they are not
  interchangeable: `<vault>/CoderByte/Tests/{function,project,service}/` holds the smoke
  artifacts (including `CoderByte/Tests/project/react-counter.md`, the `package` smoke
  artifact used for the F5 pass), and `<vault>/Tests/{Projects,Services}/` holds the larger
  multi-file spikes. **Paths are vault-relative** — the vault root is whatever the extension's
  settings resolve to, never a `/Users/…` literal.
  **Those directory names are the pre-axes spelling and the artifacts inside them have moved
  on**: every file under `Tests/project/` now declares `leetcodeType: package` and every file
  under `Tests/service/` declares `leetcodeType: stack`. New worked examples land under
  `<vault>/CoderByte/Tests/{function,package,stack}/` — named for the axis, not for the test
  type that used to stand in for it. Renaming the two legacy directories is a vault-write task
  in its own right and has deliberately not been folded into a doc change.
- Tests in `test/` use **inline fixtures** (`CLAUDE.md`, *Code Style*). A test must never walk
  a vault directory or depend on a machine-local absolute path — it would pass or fail
  depending on whose checkout ran it. To sweep real artifacts, loop the CLI instead:
  ```bash
  fail=0; total=0
  while IFS= read -r f; do
    grep -q '^artifactType: leetcode' "$f" || continue   # a vault holds plain notes too
    total=$((total + 1))
    node scripts/verify-exercise.mjs "$f" || { fail=$((fail + 1)); echo "FAILED: $f"; }
  done < <(find "$VAULT" -name '*.md' \
             -not -path '*/.obsidian/*' -not -path '*/.git/*' -not -path '*/.trash/*')
  echo "verified $total · failures $fail"
  [ "$total" -ge "${EXPECTED_ARTIFACTS:-79}" ] || { echo "SWEEP DID NOT SEE THE VAULT: $total"; exit 1; }
  ```
  Three things the loop does that a one-line `find -exec` cannot, all of which have bitten:
  **it filters on the `artifactType: leetcode` discriminator** (a vault holds ordinary notes —
  `CoderByte/Tests/README.md` is `.md` and is not an exercise), **it counts failures**
  (`find … -exec cmd {} \;` discards every exit status, so a fully-broken sweep prints its
  failures and still exits `0`), and **it asserts the count**.

  **`failures 0` is only half a pass — `total` is the other half.** The `grep` that selects
  candidates reads the very key the format rename rewrote, so a filter left on the old
  `^type: leetcode` spelling now matches **nothing**: the loop prints `verified 0 · failures 0`
  and every gate downstream reads it as green. A pass by vacancy. Measured on this vault:
  **79** of 80 `.md` files are artifacts (the odd one out is `CoderByte/Tests/README.md`,
  correctly excluded) — 65 `function`, 10 `package`, 4 `stack`. **Raise the default in the same
  change that adds an artifact.** A floor below the true total is worse than no floor: it still
  passes a sweep that silently missed a dozen files, which is the exact failure it exists to
  catch. There is also a second sweep — `node scripts/coverage-sweep.mjs "$VAULT"` — which asks
  the other question, whether every *implemented* cell of the capability matrix has an artifact
  behind it at all.

  `verifyExercise` already enforces everything a parse-only guard could (missing title,
  missing `function:`, the case floors, `params`/`returns`) and more.
- Scratch files for a debugging session go in the session scratchpad, not the repo.

### Artifact harnesses (grade the `.md`, not the code)

```bash
node scripts/verify-exercise.mjs "<file.md>"                      # conformance + own solutions green
node scripts/verify-exercise.mjs "<file.md>" --expecteds <r.json> # diff stored vs recomputed expecteds
node scripts/verify-exercise.mjs "<file.md>" --starter-red        # package/stack: starter must FAIL
node scripts/grade-candidate.mjs "<file.md>" <lang> <candidate>   # grade an EXTERNAL candidate
```

Both import from `dist/` — `pnpm compile` first; both fail loud if the build is missing.
`grade-candidate` exits `0` solved · `1` not solved · `2` bad input · `3` no environment
(reserved type, unknown language, runtime absent), and masks a failing **final** case as
`hidden` so grading against it cannot leak the hidden suite.

**A blind independent solve is an oracle for the stored `expecteds`.** The harness only
proves an artifact is self-consistent — its reference solution reproduces its own expected
values, which a wrong expected value trivially satisfies if the reference is wrong the same
way. One independent solver (a fresh agent given the statement with `# Solutions` and
`## Final Tests` stripped) whose candidate grades **solved** through `grade-candidate.mjs`
is strong evidence the expecteds are actually correct — the cheaper cousin of a full
recompute cross-check, and cheap enough to run per exercise.

---

## What This Extension Does

**Obsidian Artifacts: AI LeetCode Trainer** is a standalone, LeetCode-only sibling of the
core *Obsidian Artifacts: AI Snippets & Tools* extension (Jira **VSX-35** / **VSX-64…68**).
It turns `artifactType: leetcode` notes in an Obsidian vault into runnable coding challenges: parse
→ generate boilerplate + a per-language test harness → run solutions against JSON test cases
via local runtimes (Java / Python / JavaScript / Rust / TypeScript) → show pass/fail in a
preview panel. No
artifact-type machinery, no parser/render/varset pipeline — the only shared concept kept is
a trimmed vault-folder picker.

User flow: **Settings** (first run) picks the vault root holding `.obsidian/` and, by
default, auto-creates a `LeetCode/` subfolder — a `useVaultRoot` toggle in Settings switches
to browsing/storing exercises at the vault root instead, creating no subfolder — → **Open
LeetCode Exercise** browses the resolved exercises directory in a `QuickPick`
(see *Exercise picker* below) and renders the challenge screen → **Solve It** writes starter code to a fresh temp file under
`globalStorageUri/attempts/`, applies the editor restrictions and starts the clock → **Run
Tests** grades the live buffer against the *public* suite (writes nothing, clock and
restrictions stay — the iteration loop) → **Submit** grades *public + hidden* and ends the
run either way: all green → `status: solved` + a `<!-- meta: … -->` duration comment, any
failure → `status: attempted`, editor settings restored on both paths. **Create LeetCode
Exercise** is a registered placeholder; scaffolding is planned.

---

## Folder Structure

```
src/
├── extension.ts        # activate() / deactivate(), command + view registration
├── commands/           # VS Code command handlers + run orchestration (picker, solveIt, submit)
├── services/           # Domain logic: parse, codegen, runner, challenge/timer, vault, attempts
│   └── test-envs/      # (test type × language) envs, each declaring the leetcode types it serves
│       ├── function/   # The five `function` envs, all built by makeFunctionEnv(spec)
│       └── project/    # Multi-file, check-graded: files writer, installer, render driver, check kinds
├── ui/
│   ├── panels/         # Webview HTML renderers + message handling (settings, preview)
│   ├── views/          # Activity-Bar WebviewView providers (sidebar)
│   ├── styles.css      # Shared webview chrome
│   └── leetcode-preview.css   # LeetCode-specific blocks (sidebar, nav, badges, settings)
├── types/              # constants.ts · languages.ts · leetcode.types.ts
└── utils/              # Pure, dependency-free: nonce, canonical-json, html, regex, safe-json, time
test/                   # One *.test.ts per source concern; fixtures inline, no test/fixtures/
```

**Naming:** `*.service.ts` = one concern (stateful *or* pure — the suffix names the
concern, not impurity); `*.helpers.ts` = its pure-function sibling.

---

## Architecture

### Entry point

[src/extension.ts](src/extension.ts) — `activate()` registers `obsidian-leetcode.settings`,
`.create`, `.open`, `.endChallenge`, runs `migrateLegacyVaultPath()`, then awaits
`refreshVaultContext(context)` so menus reflect vault state before the first interaction,
and auto-opens Settings when no vault path is stored. There is **no**
`onDidChangeConfiguration` listener — the vault path is not configuration; the settings
panel calls `refreshVaultContext(context)` directly after saving.

All four commands share the `Obsidian Artifacts:` palette category; the first three also
appear in an **Obsidian Artifacts** `submenu` in `editor/context`. `.create` is a
placeholder ([createExercise.command.ts](src/commands/createExercise.command.ts));
`.endChallenge` is palette-only and is the status-bar clock's `command`, so clicking the
clock ends the run and restores the editor settings.

### Vault path storage (per-installation)

- **Storage:** `context.globalState` keys `vaultPath` and `useVaultRoot`, both machine-local.
  `setKeysForSync` is **never** called — a synced absolute path caused `ENOENT` across
  macOS/Linux, and the boolean stays unsynced beside it for consistency.
- [vault-path.store.ts](src/services/vault-path.store.ts) — `getVaultPath()` / `setVaultPath()`
  / `getUseVaultRoot()` / `setUseVaultRoot()` / `migrateLegacyVaultPath()` (one-time: copies any
  legacy synced `obsidianLeetcodeTrainer.vaultPath` into `globalState`, then clears the synced
  setting). The `obsidianLeetcodeTrainer.*` configuration contribution is gone from
  `package.json`. `getExercisesSubdir(context)` also lives here — the thin, `vscode`-coupled
  wrapper both `refreshVaultContext` and the picker call to resolve where exercises live,
  never re-hardcoding `'LeetCode'`.
- [vault.helpers.ts](src/services/vault.helpers.ts) — pure `exercisesSubdir(useVaultRoot)`:
  `false` → `LEETCODE_DIR`, `true` → `''` (vault root, no subfolder). The one unit-tested
  authority `getExercisesSubdir` wraps.
- [context.service.ts](src/services/context.service.ts) — `refreshVaultContext(context)` sets
  `obsidian-leetcode.vaultConfigured` (the single `when` gate in `package.json`) and, only when
  `getExercisesSubdir` resolves to a non-empty subdir, **create-only** ensures it exists (never
  deletes — no data loss). `useVaultRoot: true` creates and deletes nothing — flipping the
  toggle only changes where the picker looks.
- [vault.service.ts](src/services/vault.service.ts) — `validateObsidianVault()` (requires
  `.obsidian/`, toasts on failure — both callers want the toast) and `createVaultDirectory()`.

### Exercise picker — folder-tree browsing

The exercises directory (`LeetCode/` by default, the vault root when `useVaultRoot` is on) is
a **tree**, not a flat drop: solvers classify exercises into topic folders (`Arrays/`,
`Strings/`, …). `pickLeetCodeExercise` → `pickLeetCodeFile`
([leetcode.command.ts](src/commands/leetcode.command.ts)) resolves `getExercisesSubdir(context)`
**at open time** (never cached from activation, so a toggle flipped in Settings takes effect
on the very next open) and browses it **one level at a time** in a loop, never a full-tree walk:

- Each level does exactly **one** `readDirectory`; `splitDirEntries(entries)`
  ([quickpick-item.helpers.ts](src/commands/quickpick-item.helpers.ts)) returns
  `{ dirs, files }` — subfolders alphabetical, `.md` files for `buildQuickPickItems` to sort.
- Row order is **`..` → folders → exercises**. The `$(arrow-left) ..` row appears only below
  the root and targets `parentPath(cwd)`. Picking a folder sets `cwd` and re-renders; picking
  an exercise returns its URI. Esc cancels the whole browse.
- Only the *current* level's frontmatter is read (`parseFrontmatterOnly`), so a deep vault
  costs one directory read per step instead of parsing every `.md` in the tree.
- Exercise rows carry the **bare** file name, so `buildQuickPickItems`' category label stays
  empty and the folder shows once — in the picker title (`LeetCode artifacts · Arrays`).
- **SECURITY:** a symlinked directory is never emitted as a row, so it can never be entered —
  containment lives in `splitDirEntries` (pure, unit-tested), not in the `vscode` layer.
- **Dotfile hygiene:** `splitDirEntries` also drops any entry (folder or file) whose name
  starts with `.` — harmless in `LeetCode/` subfolder mode, essential when `useVaultRoot`
  browses the vault root directly, where `.obsidian/` (and any `.git/`, `.trash/`, …) must
  never appear as a browsable row.

### Ported couplings

Three cross-module couplings were rewired so this repo has no dependency on the core repo:
`escHtml` → [utils/html.helpers.ts](src/utils/html.helpers.ts) · `patchFrontmatterField` →
[frontmatter-patcher.service.ts](src/services/frontmatter-patcher.service.ts) ·
`validateObsidianVault` → trimmed [vault.service.ts](src/services/vault.service.ts).

### Webview ↔ extension message protocol

| Direction | Command | Payload |
|---|---|---|
| webview → ext | `open` | none — sidebar empty-state "Open exercise" |
| webview → ext | `solveIt` | `{ language, options, timeLimitMinutes }` |
| webview → ext | `runTests` | `{ language }` — public suite, live buffer |
| webview → ext | `submit` | `{ language }` — public **+** final suite |
| webview → ext | `selectLanguage` | `{ language }` |
| webview → ext | `back` | none — discard, no confirmation |
| webview → ext | `close` | none — discard while running, modal-confirmed |
| ext → webview | `testResults` | `{ html }` — rendered results table |
| ext → webview | `challengeState` | `{ active, editorOpen? }` — `editorOpen` tracks the attempt tab |
| ext → webview | `viewState` | `{ phase }` — `ChallengePhase` |
| ext → webview | `tick` | `{ unlimited, ms }` — once a second while `running` |

A locked artifact (`practice.locked: true`) makes the extension ignore the posted
`options` / `timeLimitMinutes` and use its own frontmatter.

**Never re-assign `webview.html` to push an update.** It restarts the webview: a
`postMessage` fired right after can land before the listener attaches and be dropped, and a
running timer dies. Terminal renders *seed* their state into the document
(`renderLeetCodePreviewHtml`'s `resultsHtml` / `timer` args); everything live is `postMessage`.

**No runtime dependencies** — VS Code API + Node built-ins (`node:child_process`,
`node:crypto`, `node:fs/promises`, `node:os`, `node:path`) only. `highlight.js` from the core
repo is **not** a dependency; the preview panel does not syntax-highlight.

Precisely: **the extension ships zero; an exercise declares its own.** A `libs:` block is
installed at run time into a shared cache under `os.tmpdir()`, never into this repo's
`package.json` — so the invariant is about what is *bundled*, not about what an artifact may
resolve. See *Library support* below and `ARTIFACT_LEETCODE_FILE_FORMAT.md` §9.4.

---

## LeetCode Vault File Format

> **The authoritative on-disk spec is
> [ARTIFACT_LEETCODE_FILE_FORMAT.md](ARTIFACT_LEETCODE_FILE_FORMAT.md)** — every frontmatter
> field, section heading regex, fence info-string, the type-mapping table, the capability
> matrix, the language aliases, and the `<!-- meta: … -->` / `<!-- attempt: … -->` shapes.
> **Any change to the `.md` format must update that file in the same change.** It is
> grounded in [leetcode-parser.service.ts](src/services/leetcode-parser.service.ts) +
> [leetcode-parser.helpers.ts](src/services/leetcode-parser.helpers.ts) +
> [leetcode-sections.helpers.ts](src/services/leetcode-sections.helpers.ts); when doc and
> parser disagree, the parser wins and the doc is the bug.

Orientation: an `artifactType: leetcode` note carries **summary-and-shape frontmatter**
(`artifactType`, `leetcodeType`, `title`, `difficulty`, `status`, `algorithm`, `tags` — in
**that** canonical order, and nothing else), a description, `## Examples`, `## Tests`,
`## Final Tests`, `# Setup`, `# Solutions`, and an extension-written `# Attempts`.

**Two independent axes, and this is the whole point of the format.** `leetcodeType`
(frontmatter) says what the artifact **is** — `function` (one buffer) · `package` (one tree)
· `stack` (several trees); `test.type` or a check's `kind:` says how a case is **delivered
and compared**. One value used to answer both questions, which is why four test types were
reserved and why a `service` could be opened but never graded. Three rules fall out, all
enforced rather than remembered:

- **`artifactType` is a hard cut.** A bare `type: leetcode` with no `artifactType:` is a
  named `verifyExercise` failure, as is an absent or non-`leetcode` value. A renamed
  discriminator is derivable from nothing, so it fails loudly instead of guessing.
- **`leetcodeType` is derived when absent**, from the legacy `test.type`
  (`function`→`function`, `project`→`package`, `service`→`stack`, anything else→`function`),
  reading the **raw** scalar before the unknown-value fallback. A default, not a dual read.
- **The key order is checked.** `orderViolation`
  ([frontmatter-order.helpers.ts](src/services/frontmatter-order.helpers.ts)) owns the one
  canonical list; the parser stays order-independent, so a mis-ordered file still parses and
  fails with a message. `patchFrontmatterField` inserts an absent `status:` at its canonical
  index rather than appending — otherwise the extension's own Submit would author a file its
  own verifier rejects (12 vault artifacts carry no `status:`).

**Execution configuration lives in the body**, in ` ```yaml leetcode ` fences placed next to
what they configure: `function`/`functions`/`params`/`returns` after the description,
`test`/`practice` before `## Tests`, `libs`/`packages` before `# Setup` or `## Files`.
(`packages:` is now the key on disk **and** in `BODY_SET_KEYS`; `services:` is gone from both.
It has a grammar — [packages-parser.helpers.ts](src/services/packages-parser.helpers.ts) — but
**no caller yet**: nothing in `parseLeetCode` invokes `parsePackages`, so the block is
recognised and validated in isolation rather than reaching a run. See
`ARTIFACT_LEETCODE_FILE_FORMAT.md` §9.3.)
Placement is convention — the parser is order-independent — but the marker is not: `yaml`
first (so Obsidian still highlights it), then a **bare** `leetcode` token, because a
`## Files` entry always carries `path=` and must never be mistaken for config. Fence content
starts at **column 0**, since every fence body is concatenated with the frontmatter for a
single `parseFrontmatter` call.

**The cut is hard: there is no dual read.** One of those nine keys left in frontmatter is
ignored — *not parsed* — warned about, and fails `verifyExercise`. A v1 artifact therefore
parses to `functionName: ''` and `params: []` rather than half-working.

**Case data in `## Tests` / `## Final Tests` accepts ` ```yaml ` or ` ```json `** — the
info-string picks the parser, so this is two notations, not a dual read. The YAML is
**JSON's type system with YAML's syntax** ([yaml-cases.helpers.ts](src/services/yaml-cases.helpers.ts)):
an unquoted scalar types only as `true`/`false`, `null`/`~`, or a strict JSON number, and
**everything else stays a string**. That is deliberate and load-bearing — full YAML 1.1
would silently re-type this vault's data (`"0051"` → 41, `"1:1"` → 61, `"no"` → false,
`""` → null), and a coerced *expected* makes the harness verify green while teaching the
wrong answer, because the reference solution is graded against that same value. The emitter
quotes anything ambiguous, and `emit → parse` is pinned as the identity.

Behaviour the spec does **not** cover:

- **`functions:`** overrides `function` per language — language-specific code reads
  `functionNameFor(parsed, langId)`, **never** `parsed.functionName`.
- **Final Tests** are the hidden grading suite: counts render (`2 public · 3 final`), inputs
  never do (rows for `kind: 'final'` mask theirs as `<span class="masked">hidden</span>`). A
  missing section falls back to the public list — resolved in `submitSuite`, never in the
  parser, so the list is never doubled.
- **Setup** takes only the **first** fence per language (a starter stub, not a labelled list)
  — exactly what lands in the temp file. No setup → `generateBoilerplate()`.
- **Practice options** map to VS Code settings in `PRACTICE_OPTIONS`
  ([types/constants.ts](src/types/constants.ts)). VS Code has no per-editor config scope, so
  `PracticeMode` writes them at **global** scope and restores the previous `globalValue` on
  teardown (panel dispose, successful Submit, `End LeetCode Challenge`, `deactivate()`).
- A **reserved** `test.type` parses and validates, but no env is registered, so
  `languagesForType()` returns `[]` and the panel explains itself instead of crashing inside
  a compiler. In `verifyExercise` a reserved type has **no candidate function**, so
  *everything that measures one* is skipped: the run step, the `params`/`returns` presence
  floors, the input-key match, and the `## Examples ⊆ ## Tests` pin. `ok` there means
  **well-formed**, never **executed** — and `verify-exercise.mjs` says so out loud
  (`structure only — no environment for test.type 'class', so this mode ran neither its
  solutions nor its checks; --starter-red does grade the checks`) rather than a bare `OK`.
- **Opening and grading are different questions, answered by different authorities — and the
  answer is now the leetcode-type axis, not a test-type id.** *Can it be opened?* is
  `isMultiFile(leetcodeType)` ([types/constants.ts](src/types/constants.ts)), which reads
  `LEETCODE_TYPES[…].shape !== 'buffer'` — the one home of "this artifact is a file tree",
  read by the parser, `startChallenge` and `availableLanguages`. `MULTI_FILE_TYPES` is
  **deleted**; a second list of which ids are trees is exactly the drift the table prevents.
  *Can it be graded?* is the registry, **plus** an artifact-level refusal.
- **The old `test.type === 'project'` gate is gone from all three dispatch sites** (Run Tests,
  Submit, `verify-exercise.mjs --starter-red`) and must not be reintroduced. It could not
  survive the migration: the format now deletes the `type:` line from every check-graded
  artifact, so all three comparisons went false on exactly the files that need grading.
  **What replaces it is not `refusalFor`.** That function asks "is this
  `(leetcodeType × testType × language)` triple registered?", and on the directory path the
  answer is always yes — the project envs serve both `package` and `stack`, and the path is
  reached only once `isMultiFile` is true, so a guard consulting it refuses **nothing**. That
  guard was built twice, gated green twice, and was inert both times. The faithful signal is
  the **artifact's own dropped kinds**: `projectGradeRefusal`
  ([leetcode-run.helpers.ts](src/commands/leetcode-run.helpers.ts)) reads the structured
  `unimplementedKinds` the project parser records and refuses the artifact **as a whole**,
  by name, before anything is written — *"checks declare kind(s) no environment implements
  yet: http — the whole artifact is ungradeable, not just the checks that parsed."* Grading
  only the survivors is the false-green vector: a tree whose `http` checks were dropped at
  parse time would otherwise pass on its surviving `build` check and be reported **solved**.
- **Verification deliberately answers differently from grading.** An artifact with an
  unimplemented kind is refused for grading and still reports structure-only `ok` — *well
  formed* and *executable* are different claims — and the CLI prints
  `structure only for kind(s) http — no environment implements them, so those checks were
  dropped at parse time and never graded`. Four vault artifacts declare `kind: http`; had the
  refusal failed verification instead, no vault sweep could ever read `failures 0`.

### Language registry — the one authority

[src/types/languages.ts](src/types/languages.ts) holds `LangId`, the `LANGUAGES` registry
(`displayName`, `fileExt`, `commentPrefix`, `detectCmd`, `aliases`), `LANG_IDS`, and the
`isLangId` guard. It is the single home of **runnable** language metadata; the parallel
tables that used to drift beside it (`RUNNERS`, `SupportedLang`, a per-language runner
folder) are gone.

**Adding a runnable language = four rows, no scattered edits:**

1. a `LANGUAGES` entry (`src/types/languages.ts`) — including its `ecosystem`, which is what
   `libs:` resolves through,
2. a `TYPE_SYNTAX` row (type mapping),
3. a `LANG_CODEGEN` row (boilerplate + harness — the template itself lives in its own file
   under [src/services/codegen/](src/services/codegen/), e.g. `rust.codegen.ts`,
   `typescript.codegen.ts`, imported into the row, never inlined),
4. a `makeFunctionEnv(spec)` env (`test-envs/function/`).

A version- or library-gated language doesn't add a fifth row — it uses `TestEnv.requires` /
`detect()` on row 4's registration instead. TypeScript is the first env to do this:
`typescriptFunctionEnv.detect()` gates on the running Node satisfying
`nodeSupportsStripTypes` (≥ 22.18 on the 22.x line, ≥ 23.10 on 23.x) before the language ever
reaches the selector — `LANGUAGES.typescript.detectCmd` (`node --version`, row 1) only proves
*some* Node is installed, not that it's new enough for `node:module.stripTypeScriptTypes`.

`TYPE_SYNTAX` and `LANG_CODEGEN` are **two** tables in
[leetcode-codegen.service.ts](src/services/leetcode-codegen.service.ts), deliberately not
merged: `TYPE_SYNTAX: Record<string, …>` covers the *type-mappable* set (currently
java/python/javascript/rust/typescript, open-ended for a future display-only language),
`LANG_CODEGEN: Record<LangId, …>` the *runnable* set — compiler-checked exhaustive over
`LangId`, so a type-mappable language that never becomes runnable can't force a fake codegen
entry. Both tables happen to cover the same five languages today now that Rust and TypeScript
are runnable, but the split still guards against the next type-mappable-only addition. The
broad **cosmetic** tables (`LANG_ALIAS`, `LANG_EXT` — 40+ fence→id/ext entries) stay in
`constants.ts` and are *not* folded into the runnable-language registry; a consistency test
guards them against drift.

### Code generation

| Layer | Source | Purpose |
|---|---|---|
| 1 | Built-in templates (`LANG_CODEGEN`) | Runnable wrapper from `function` + `params` + `returns` (Java `class Main` + `Scanner`; Python `input()`; JS `readline`) |
| 2 | `# Setup` blocks | The starter stub the solver begins from — preferred over Layer 1 |
| 3 | Override code blocks | Only when the default wrapper does not fit |

The wrapper holds a `<<SOLUTION>>` marker; `injectSolution()` replaces it preserving
indentation. **At run time** `buildExecutable(parsed, langId, code)`
([leetcode-candidate.helpers.ts](src/services/leetcode-candidate.helpers.ts)) normalises the
candidate to a bare declaration of the function name — the env supplies arguments as literals
and emits its own driver, so a candidate must **never** read stdin. A bare body is wrapped in
a minimal declaration, deliberately *not* via `generateBoilerplate()`, whose Layer-1 template
reads stdin and would block forever inside a driver.

### Test environments — the capability matrix

How a test *executes* is data, not an `if/else`. A **test environment** is a
`(test type × language)` pair that validates a candidate, emits a runnable program, and
parses its output into per-case outcomes, and which declares the **leetcode types** it serves.
`testEnvFor(testType, langId, leetcodeType?)` returns `RegisteredEnv | undefined` — the absence
of a pair **is** the matrix, and `languagesForType(testType, leetcodeType?)` drives the language
selector directly, so there is no second table to keep in sync.

**One registry, two execution contracts.** `RegisteredEnv = TestEnv | ProgramEnv`. A `TestEnv`
runs the whole suite in **one** process and recovers outcomes from `__LEET__` sentinel lines; a
`ProgramEnv` starts **one process per case** and reads each answer back from `$LEET_OUT` (P5,
D6). Neither can implement the other without a lying stub — `TestEnv.emit` returns a *string*
`run` executed once, and `parse(stdout)` is the wrong channel entirely — so they are a union,
discriminated by `isBatchEnv(env)`, which every caller narrows with **before** reaching
`runSuite`. They share the registry because it answers *can this triple be graded?*, which is a
different question from *how does a suite execute?*: keeping `program` out of it would leave the
matrix, `refusalFor` and `coverage-sweep.mjs` all reporting an implemented cell as missing.

**The `Map` stays keyed `"<testType>::<language>"`** and the lookup *filters* on the env's
declared `leetcodeTypes`. A three-key table would be mostly empty slots plus a second list to
drift out of sync with the first. The third argument is **optional and appended**, not
prepended and required: it has seven call sites spread across three phases of work, and a
required parameter would have made the tree red in a wave that could only be cleared by
editing four other concerns' files. It becomes required once the last call site passes it.

**A check `kind:` is not resolved here.** `build` / `dom-assert` / `css-assert` have no
registry entry at all (`languagesForType('build')` is `[]`) — they are dispatched per check by
`runOneCheck` against an already-written directory. Both draw from the one `TEST_TYPES`
vocabulary; only one of them goes through the registry.

The five `function` envs come from `makeFunctionEnv(spec)`
([make-function-env.ts](src/services/test-envs/function/make-function-env.ts)), which owns
`type: 'function'`, the two-file emit shape, and the shared sentinel parser; each language
supplies only its `runnerSource` / `candidateContent` / `validate`. The **generated driver**
is still self-contained — it can never assume a JUnit jar, because nothing the extension ships
installs one. What an *artifact* declares is a different matter: `libs:` is resolved before
`emit`, and the env consumes it through environment variables (see *Library support*).
`TestEnv.requires` / `detect()` exist so a version-gated env can run its own extra check
without touching the runner; TypeScript's env is the first to use it, gating on a Node version
floor rather than a missing package (see the four-rows section above).

`spec.withLibs` is the escape hatch for a language whose *shape* changes when libraries are
present — only Rust sets it, swapping the bare `rustc` emit for a Cargo project.

**The candidate is never spliced.** `env.emit(ctx)` returns `{ files, compile?, run }`. The
solver's code is written **verbatim** as one file; a generated *driver* links to it, so their
imports, helpers, and structure survive and cannot collide with the driver's class or `main`:

| Language | Candidate file | Driver links via |
|---|---|---|
| java | `Solution.java` (method wrapped in `class Solution`) | second compilation unit — `javac Solution.java Runner.java`, `java Runner` |
| python | `sol.py` | `importlib`; an `if __name__=='__main__'` guard keeps the solver's own main dormant |
| javascript | `sol.js` | Node's `vm` — fresh context, pull the function from the sandbox |
| rust | `solution.rs` (leading `fn` rewritten `pub fn`) | second compilation unit — generated `runner.rs` declares `mod solution;`, `rustc -O runner.rs -o runner` pulls it in, `./runner` |
| typescript | `sol.ts` (written verbatim) | generated `runner.js` reads it, strips types with `node:module.stripTypeScriptTypes`, evaluates the result in a `vm` sandbox — same shape as the javascript env plus one call |

(Splicing into a generated `class Main` was the old model; it collided the moment a solver
wrote their own `import`, `class Main`, or `main()`.) Commands run with the temp dir as
`cwd`, so they name files bare. **`env.validate(ctx)`** runs before any file is written and
returns a plain user-facing message (or `null`) — a Java method wrapped in the solver's own
`class`, a Python `def` nested in a class, a JS buffer that never names the function — so the
panel shows *"Java setup must be a bare method, not a class"* instead of a compiler dump.

### `package` and `stack` — checks, not one return value

A `package` (and a `stack`) is a **file tree graded by declared checks**
([`test-envs/project/`](src/services/test-envs/project/)); *solved = every check green*. It
is parsed and graded today, registered for **every `LANG_IDS`** (`projectEnvs =
LANG_IDS.map(projectEnvFor)`) — derived, not hand-listed, because `build` and `function`
checks are language-agnostic and a second language list is exactly the drift `LANGUAGES`
exists to prevent. **`project` survives only as the registry key and the directory name**
under `src/services/test-envs/`; on disk the axis is `leetcodeType: package | stack`, and
those envs declare `leetcodeTypes: ['package', 'stack']`. Never `javascriptreact`/`typescriptreact`: those are display ids with no
runtime, and a `.jsx`/`.tsx` file maps onto its runnable pair at bundle time. The registered
env is a **capability-matrix entry only** — its `validate` refuses every candidate
(*"a project exercise is graded as a file tree, not as a single solution buffer"*), because
grading goes through `gradeProjectDir`, never `runSuite`.

| Piece | File | Owns |
|---|---|---|
| Grammar | [project-parser.helpers.ts](src/services/project-parser.helpers.ts) | `## Files`, `libs:`, `checks:`, `check=<name>` case binding, warnings |
| Containment | [files.writer.ts](src/services/test-envs/project/files.writer.ts) | `resolveContained` — **the** path authority; writes the tree, `role: readonly` → mode `0o444` |
| Toolchain | [libs/](src/services/libs/) | grammar → argv install → shared cache under `os.tmpdir()`, one door (`ensureLibEnv`) |
| Linking | [modules.linker.ts](src/services/test-envs/project/modules.linker.ts) | per-run `node_modules` of symlinks into that cache — pnpm's layout |
| Render | [render.driver.ts](src/services/test-envs/project/render.driver.ts) | esbuild bundle + jsdom mount, one `__LEET__` line per case |
| Check kinds | [checks.ts](src/services/test-envs/project/checks.ts) · [build.check.ts](src/services/test-envs/project/build.check.ts) | `dom-assert` / `css-assert` / `build` |
| Orchestration | [project.runner.ts](src/services/test-envs/project/project.runner.ts) | temp run dir → write tree → dispatch every check |

Rules that are load-bearing, not stylistic:

- **`verifyExercise` dispatches on the leetcode type, through a registry — it does not branch.**
  `VERIFY_RULES: Record<LeetcodeTypeId, VerifyRule>`
  ([`exercise-verify/rules.registry.ts`](src/services/exercise-verify/rules.registry.ts)) is
  compiler-exhaustive over the axis, and the function floors (`params`/`returns`, 6 public / 3
  final, `## Examples ⊆ ## Tests`) live in `function.rules.ts` **and nowhere else** — so a
  check-graded exercise is never measured against floors it does not have. Adding a type extends
  the table, never a conditional chain. Four **frontmatter** rules run before any of that, in
  `frontmatter.rules.ts`: legacy body-set keys, the legacy `type:` rename, canonical key order,
  and the discriminator's presence and value.
- **`package.rules.ts` owns the mirror rule:** `checks:` present ⟺ no genuine `test.type`. An
  absent `type:` is the target state — the migration deletes that line — so the default and the
  legacy shape markers (`project`/`service`) are tolerated and only a deliberately named strategy
  is refused. Without it a check-graded artifact that omits `type:` inherits the default
  `function`, verifies as a single empty `call` suite with no params and no cases, and the checks
  that actually grade it are never consulted.
- **Nothing artifact-authored becomes code.** The render driver embeds the entry path, cache
  dir and every case as JSON literals; a case is a declarative `RenderStep[]`
  (`click`/`change`/`text`/`count`/`attr`/`style`), never a snippet to eval.
- **React is `external` to the bundle.** Bundling it gives the component a second React and
  every hook throws `Invalid hook call`.
- **`css-assert` refuses layout geometry.** jsdom computes no layout, so `width`/`height`/
  `margin`/… are rejected at validation rather than answered from whatever is declared inline.
- **A `change` step refuses a field a user could not type into — and a `click` never does.**
  The asymmetry is load-bearing, not an oversight. `change` writes through the prototype
  `value` setter, which ignores both `readOnly` and `disabled`, so a frozen form registered a
  state change and graded **green**; that path is refused by name. A `click` on a disabled
  target is *already* inert for the driver exactly as for a real user (React never fires the
  handler), so the observed no-op is faithful and the step is left alone. Guarding it too —
  tried once, for a nicer message — **broke `disabled={alreadyTaken}`**, which is idiomatic and
  which suites deliberately click against to assert the no-op. Pinned in both directions by the
  opt-in E2E test.
- **Visibility is still ungradeable, and that is a ceiling not a bug.** With no layout there is
  no `display`/`visibility`/occlusion answer: a component rendering every element under
  `display: none` passes its `dom-assert` suite. `css-assert` can pin the *declared* property,
  but "the solver's UI is actually visible" is outside what any check here can assert.
- **A case with no sentinel line fails.** A killed driver must never read as an empty, and
  therefore green, suite.
- **Zero *bundled* dependencies still holds.** esbuild/jsdom — and every artifact-declared
  library — install into the shared cache at run time, never into `package.json`. The end-to-end render tests are therefore opt-in
  (`LEET_PROJECT_E2E=1`) and `pending` otherwise — the gate stays deterministic offline.
- **The run directory gets its own `node_modules` — pnpm's layout, not one big symlink.**
  A `build` check spawns its toolchain with `cwd = runDir`, and a compiler resolves by walking
  **up** from there; the shared cache is not an ancestor, so a bare `argv: ['tsc']` used to
  resolve nothing. `linkModules` therefore makes `runDir/node_modules` a **real** directory
  whose entries are symlinks into the cache (`@scope` and `.bin` likewise real, holding links
  one level down). Symlinking the whole tree instead would let a tool's own writes —
  `node_modules/.vite`, `.cache` — mutate what every other exercise resolves from; a cache per
  exercise would isolate them but lose the dedup the lib-set key already buys. Resolution works
  because Node realpaths a symlink *before* walking up for transitive deps.
- **`node_modules` is a reserved path segment at *every* depth, matched case-insensitively.**
  No artifact-declared path — `## Files` `path=`, a `build` check's `dir:`, a `function` or
  render check's `file:` — may resolve inside one, because a write through a link escapes into
  the shared cache. The rule lives in `resolveContained` so all four inputs inherit it, and it
  is per **normalised segment**, never a substring: `client/node_modules/react/index.js` is
  refused while `my_node_modules/x` is untouched. (`src/../../node_modules/x` is refused too,
  but by the earlier *escape* check — it leaves the run directory before any segment is read.)
  **First-segment-only was safe exactly as long as there was one linked tree at the run root**
  — a `stack` links a tree per sub-package, so a deeper `node_modules` is a real door into the
  cache. The fold is `normalize('NFKC')` then `toLowerCase()`, and both halves are load-bearing:
  APFS and NTFS fold case, so `NODE_MODULES/react/index.js` reached the same directory on disk;
  and `.toLowerCase()` alone is not Unicode case folding, so `node_moduleſ` (U+017F) walked
  straight through it and poisoned the shared cache end to end. Linux consequently over-refuses
  a directory genuinely named `NODE_MODULES` — the deliberate trade, since a guard whose safety
  depends on which machine graded the artifact is worse than a uniform one.
- **One install per grading run, under one cache key.** `gradeProjectDir` installs the union of
  **every** `parsed.libs[lang]` (all languages — a `libs.python` project must not silently
  install nothing), widened to `renderLibsFor(...)` **only** when a `dom-assert`/`css-assert`
  check is declared, then links once and passes the cache dir down to `runRenderCheck` as its
  fourth argument. `runRenderCheck` installs only when not given one, so direct/E2E callers
  still work. Without that hand-off the render check installed its own superset under a
  *different* key — two cold installs per React exercise, and a linked tree the render driver
  did not resolve from. An empty set installs nothing, links nothing, and leaves no
  `node_modules` in the solver's folder.
- **Warm means the packages are on disk, not that the marker is — and the probe has to be
  deep enough to notice.** `isWarm` checks `.leet-installed`, **then** every path the installer
  declares (`warmPaths`), **then** its optional `verifyWarm`. Each layer was added because the
  one above it read warm over a broken tree: macOS prunes `/var/folders` **file by file**, so a
  swept entry keeps its directory skeleton and loses its contents. Probing for a *directory* per
  spec therefore proved nothing — pnpm now declares `node_modules/<name>/package.json` per spec,
  and `verifyWarm` additionally checks that every declared **executable** still exists, because
  a swept `typescript/bin/tsc` sat behind a perfectly present `package.json`. **All four
  installers now probe files, not directories** — maven a jar per coordinate rather than a bare
  `jars/`, cargo the pre-warm `target/release/leet_warm` rather than a bare `target/`. Those two
  were left behind by the fix that repaired pnpm, and an emptied directory read warm for months.
- **A failed probe now genuinely repairs the entry — it did not before, and the old text here
  said it did.** The mechanism, not just the probe, was broken: a relocatable install is built
  in `<key>.tmp-<pid>` and renamed, and a failing rename was treated as a lost race, so the
  freshly built repair was **deleted** and the gutted tree kept — every run, forever. Two
  consecutive verify passes produced the identical `Cannot find module 'jsdom'`; 13 of 75 vault
  artifacts failed that way. The fix asks the same question up front: only a **warm** winner
  keeps its directory, a stale squatter is swapped out for the build that just succeeded.
  **If a cache-shaped failure looks self-healing, prove it heals — run it twice and compare.**
- **A swept *transitive* dependency is caught too, by counting files — and the old claim that it
  self-repaired was false.** `warmPaths` can only name paths a spec predicts up front, so a sweep
  that took a file *inside* an installed package went unseen: `.pnpm/iconv-lite@0.6.3/…/lib/
  bom-handling.js` gone with its siblings intact, every per-spec `package.json` present, five
  committed artifacts failing `Cannot find module './bom-handling'` identically on two
  consecutive runs. This file used to say the package manager's own reify repaired that "on the
  next reinstall this triggers" — **no reinstall was ever triggered, because the probe passed.**
  So `.leet-installed` now records the install's **file count** and a tree holding fewer files
  reads cold. Strictly fewer: a tool writing into the cache after install only ever adds, and
  must not invalidate a healthy entry. A marker with **no** recorded count reads **cold**, and
  that reversal was measured, not reasoned: treating a countless marker as "no opinion" was
  tried first, to avoid re-installing every pre-existing entry — and it made the whole check
  **inert on exactly the entries that were already broken.** One real entry kept its legacy
  plain-text marker over a swept tree, passed every probe, and failed the same five artifacts on
  two consecutive runs *after the fix had supposedly landed*. Grandfathering the old marker
  format grandfathers the defect with it. Each pre-existing entry now reinstalls **once**, earns
  a count, and is checked properly forever — bounded, one-time, and the alternative is a fix
  that never repairs anything that predates it.
  **The real remaining ceiling:** a count is not a manifest, so a sweep that removes one file
  while something else adds another still balances out, and a file swept *and later recreated*
  restores the count. Both are far narrower than what this replaced, neither is repaired
  automatically, and the walk costs one directory traversal per otherwise-warm resolve —
  paid only by artifacts that declare `libs:`.
- **`linkModules` never trusts `fs.mkdir(…, { recursive: true })`.** It succeeds silently when
  `runDir/node_modules` is already a symlink to a directory, and every later write then lands in
  the link target. Unreachable in the harness (a fresh `mkdtemp`), but the solve flow keeps its
  attempt directory across Run Tests and Submit and a `build` check's argv is arbitrary code by
  design, so that subprocess can swap the directory between two gradings. It `lstat`s and throws.
- **A `build` check sees the run's own `.bin` first.** `runBuildCheck` prepends
  `runDir/node_modules/.bin` to the child's `PATH` (via `path.delimiter`, prepended not
  replaced), so the artifact's declared toolchain version is what runs. **Never `shell: true`** —
  that would hand artifact-authored argv to a command interpreter. POSIX-only: Windows resolves
  from the parent's environment block and the winning spelling between `Path` and `PATH` after an
  object spread is unspecified.
- **The links land in the solver's live attempt tree too, deliberately** — their editor then
  resolves their imports. Discard deletes that tree through `vscode.workspace.fs.delete`, not the
  Node `fs.rm` this repo verified link-safe, so it was worth checking: VS Code's
  `DiskFileSystemProvider.delete` routes a recursive delete to its own `rimraf` in
  `RimRafMode.MOVE` — `fs.promises.rename` to a temp path, then
  `fs.promises.rm(…, { recursive: true, force: true })`. Both steps operate on the link, not its
  target, so **discarding an attempt does not touch the shared cache** (confirmed against the
  shipped extension-host bundle and re-tested with those exact options).
- **One install per grading run, per registry.** `installSetsFor` groups `libs:` by
  `ecosystemFor(language)` and resolves each through `ensureLibEnv`, so a FastAPI-plus-React
  exercise gets a venv **and** a node environment. Unioning them would fetch the unrelated npm
  package named `requests`, which no name-shape grammar can distinguish. Only the **npm** dir is
  `linkModules`'d into the run — a write through a link escapes into the shared cache, and every
  other ecosystem arrives as an environment variable. See `ARTIFACT_LEETCODE_FILE_FORMAT.md` §9.4.
- **The installer is `pnpm add --dir`, and dependencies' install scripts do not run.** pnpm is
  what this project uses everywhere, and pnpm 10+ refuses a dependency's build scripts unless
  approved — so an artifact-declared package can no longer execute a postinstall, which the npm
  this replaced allowed. `--config.strict-dep-builds=false` is passed because pnpm 11 turns that
  refusal into a **non-zero exit**, which would report every usable esbuild install as
  `install failed`. esbuild itself is unaffected: its platform binary is an optional dependency,
  not a postinstall download (verified — `transformSync` runs from a scripts-blocked install).
  The residual ceiling is a package that genuinely needs a build step installing quietly
  incomplete; the fix would be a hardcoded `--allow-build=<pkg>` list in the installer, never one
  read from an artifact.

**The solve flow is a directory, not a buffer.** *Solve It* on a **multi-file** leetcode type
(`isMultiFile(leetcodeType)` — `package` **or** `stack`) materialises the
starter tree into a fresh `globalStorageUri/attempts/project_<slug>_<run>/`
([project-file.service.ts](src/services/project-file.service.ts)) and opens every
`editable`/`readonly` file as a tab (`hidden` files are written, never opened). The session
carries `projectDir`, and `fileUri` points at the primary tab so every existing consumer —
live buffer, close, delete — keeps working. **Run Tests / Submit save the dirty documents
first and grade the directory in place** (`gradeProjectDir`): a project's checks bundle and
execute real files, so grading an unsaved buffer would silently grade the previous version.
Discard removes the whole directory. The public/final boundary is **per check**
(`ProjectCheck.publicCount`), because each check binds its own fences — Run Tests grades
`cases.slice(0, publicCount)` and the hidden suite never reaches the mid-challenge loop. A
project Submit records no Big-O: the heuristic reads one candidate function, and a component
tree has none, so the field is omitted rather than fabricated.

**`## Files` is the starter; `# Solutions` fences carrying the same `path=` are the
reference overlay.** The harness grades the overlaid tree (`runProjectChecks(parsed,
{ withSolutions: true })`), a solver's run grades the starter — which is what lets an
exercise ship unsolved and still verify green. An exercise whose *starter* passes is a bug,
and it is **enforced, not remembered**:

- `verifyExercise` refuses a project that grades green while declaring **no** overlay at all.
  No second grading run is needed to know it — green ∧ no overlay ⟺ `withSolutions` had
  nothing to apply ⟺ what passed *is* the starter. `react-counter.md` shipped that way, so
  *Solve It* → *Submit* marked a run solved with nothing written.
- `--starter-red` catches the residual case the rule above cannot: overlays exist, but the
  starter passes anyway. Opt-in, because it costs a second full grading run. It accepts a
  `package` **or** a `stack` artifact — it dispatches on `isMultiFile(leetcodeType)`, not on a
  test-type id — and exits `2` on anything else, so a sweep of every check-graded artifact in
  the vault is both trees' folders, not just the projects.
  **It exits `2` a second way, and that one is not bad input:** it consults
  `projectGradeRefusal` before grading anything, so an artifact declaring a kind nothing
  implements is refused by name. Four vault artifacts declare `kind: http` and exit `2` for
  exactly that reason — read the message, not the status.
- **`--starter-red` cannot yet tell "the starter genuinely failed" from "the toolchain is
  broken", and it reports both as red.** Its pass condition is *some check failed*, so a
  `Cannot find module 'jsdom'` from a swept cache satisfies it exactly as an incomplete starter
  does. It is the **only** evidence a check-graded exercise ships unsolved, so read a red
  result together with the failure detail rather than the exit status alone.
  **The `program` path inherits this through different code**, so a fix must cover both:
  `runProgramArtifact` reports "never ran" as a **one-element** failed suite, which
  `--starter-red` then prints as `starter fails 1/1 case(s), as it must` and exits `0` — the
  same confusion, reached via a missing toolchain rather than a swept cache.
- **A fence without `path=` is not an overlay.** It parses into `solutionFiles` as nothing at
  all — the failure mode is silent, and it has now bitten three artifacts (the Next.js spike,
  and both `stack` spikes, where the fences are deliberately fragments and say so).

`<vault>/CoderByte/Tests/project/react-counter.md` is the smoke artifact: the smallest
`leetcodeType: package` that grades green through `verify-exercise.mjs`, and the file to open
for an F5 pass. (The folder keeps its pre-axes name; the artifact inside declares the axis.)
It ships **unsolved** like every other exercise — a stub in `## Files`, the working component
in a `path=`-carrying `# Solutions` fence.

**Rust has no serde.** Results serialise through a local `LeetJson` trait (compact, key-sorted
JSON — `i32`/`f64`/`bool`/`String`/`Vec<T>`/`Option<T>`/`HashMap<String, T>`), not `{:?}` Debug:
`Vec` Debug-prints with `", "` separators (never `canonicalJson`'s `[0,1]`) and `HashMap` Debug
order is unspecified. Structs and enums are out of scope until a serde upgrade. **TypeScript
never invokes `tsc`.** Non-erasable syntax (`enum`, `namespace`, parameter properties,
decorators) throws straight out of `stripTypeScriptTypes` or `vm.runInContext` with that
runtime's own message, caught and reported per-case rather than crashing the child process.

**The batch protocol.** One process per suite, one sentinel line per case:

```
__LEET__{"index":0,"actual":"[0,1]","ms":3}
__LEET__{"index":1,"error":"IndexError: list index out of range","ms":1}
```

The `__LEET__` prefix means the solver's own `print` / `console.log` cannot corrupt parsing.
Each case is wrapped in the target language's try/catch, so one throw fails one case, not
the suite. Python and Java flush per line — both block-buffer a pipe, and a timeout-kill
would otherwise discard lines already produced. **Comparison** runs through `canonicalJson()`
(sorted keys, no whitespace) on both sides; raw string compare could never match Java's
`Arrays.toString` (`[0, 1]` vs `[0,1]`) and made object key order a coin flip.

### Library support — four registries, one door

An artifact's `libs:` is installed at run time into a shared cache; the extension itself
still bundles nothing. Everything lives under [src/services/libs/](src/services/libs/):

| Piece | File | Owns |
|---|---|---|
| Authority | [lib-ecosystem.ts](src/services/libs/lib-ecosystem.ts) | `LibEcosystem`, `ecosystemFor`, the `LibInstaller` contract, `ParsedLibSpec` |
| Grammars | [lib-spec.helpers.ts](src/services/libs/lib-spec.helpers.ts) | the four `parseSpec` subsets — **the** trust boundary |
| Cache | [lib-cache.service.ts](src/services/libs/lib-cache.service.ts) | `ensureLibEnv`: key, warm probe, tmp+rename, budget, named `ENOENT` |
| Consumption | [lib-env.helpers.ts](src/services/libs/lib-env.helpers.ts) | dir → `NODE_PATH` / `VIRTUAL_ENV` / `CLASSPATH` / `CARGO_TARGET_DIR` |
| Installers | `pnpm` · `pip` · `cargo` · `maven` `.installer.ts` | one argv shape each |

Rules that are load-bearing, not stylistic:

- **`LANGUAGES[lang].ecosystem` is the only map from language to toolchain.** Read it through
  `ecosystemFor`, which folds `*react` display ids and resolves aliases; never index a raw
  `libs:` key, which is untrusted text. The ids name the **tool** — `pnpm`, not `npm`, because
  pnpm is what gets invoked and an id that said otherwise made the name disagree with the
  behaviour. Packages still come from registry.npmjs.org.
- **Specs are ecosystem-native and parsed into fields**, never matched by one pattern: a maven
  coordinate is not an npm name, and one grammar would refuse the correct spelling for three
  registries out of four. Every field pattern is anchored, opens with an alphanumeric class,
  and holds a single quantifier over a single class — that is what keeps a 10 000-character
  spec linear rather than a backtracking hang (`S8786`).
- **No fetch-from-anywhere form is admitted anywhere.** npm `file:`/`link:`/`git+`/`workspace:`,
  pip direct references and env markers, cargo `git =`/`path =`/`registry =`, maven repository
  overrides. A grammar can bound the shape of a *name* and nothing at all about a URL.
- **An inline list splits on commas outside quotes.** `numpy>=2,<3` is the idiomatic pip bound
  and a comma is also the separator, so the unquoted form silently declared two entries and
  installed an unbounded numpy. Quote it, or use the block form.
- **The cache key is `sha256(ecosystem + sorted specs)`.** The ecosystem half is a defect fix:
  keyed on specs alone, `['react']` named one directory whether it meant the npm package or a
  PyPI one, so a python run could be served a `node_modules` and report green.
- **Validation runs on every resolve, before the warm check** — otherwise a warm key is a way
  to smuggle an unvalidated spec through.
- **Warm means the marker *and* every declared warm path.** macOS prunes `/var/folders` by age,
  and a swept entry keeping its marker over an emptied tree read warm forever. npm declares one
  path per package; cargo declares `Cargo.lock` **and** `target`, so a swept target cannot hand
  the next solve the cold build the pre-warm exists to avoid.
- **Installs build in `<key>.tmp-<pid>` and rename — except pip.** Losing that race is
  *success*: both runs wanted that directory. A venv opts out because its console scripts carry
  absolute shebangs, so a renamed venv has a dead `bin/pip`, `pytest` and `uvicorn`. For the
  same reason pip is invoked as `<venv>/bin/python3 -m pip`, never the `pip` shim.
- **The venv is created with `--clear`, and that is the *repair*, not hygiene.** Reusing the
  directory is what makes a swept venv unrepairable: `python -m venv <existing dir>` runs
  `ensurepip` only when it **creates** the environment, so it leaves the wreck exactly as it
  found it, and the next line — `<venv>/bin/python3 -m pip` — then fails with *"No module named
  `pip.__main__`"* on every run, forever. Measured on a real entry: the marker recorded **878**
  files and **7** survived, `site-packages/pip/__main__.py` among the casualties, and five vault
  artifacts failed identically with no way back except deleting the directory by hand. The
  count probe (`VSX-186`) correctly read that entry **cold** — detection was never the problem,
  the in-place rebuild was. A healthy entry reads warm and never reaches `install`, so nothing
  pays for the rebuild. **Proven by running the same artifact twice with nothing deleted:** pass
  one repaired it, pass two was warm and green.
- **Manifests are rendered from validated fields.** `Cargo.toml` and `pom.xml` are files a
  toolchain obeys; author text in one is TOML/XML injection. The pnpm installer authors **no**
  manifest at all — `pnpm add --dir` writes its own.
- **The consumption seam is environment variables, and only that.** Every `compile`/`run`
  command stays a fixed literal, so no cache path is ever interpolated into a command line.
  `EmittedProgram.pathPrepend` exists so `emit()` stays pure: prepending needs the inherited
  `PATH`, and an env that reads `process.env` makes its own golden assertions machine-dependent.
- **Java's run drops `-cp .` when libraries are present.** A command-line `-cp` overrides
  `CLASSPATH` outright, so the jars would compile in (javac reads the variable) and then be
  missing at run time. The classpath ends in `.` so `Runner` is still found in the temp dir.
- **Rust switches shape, not just environment.** Libraries mean a Cargo project, and `run` is
  `cargo run --offline --release --quiet` rather than a path into `target/`: `CARGO_TARGET_DIR`
  points into the shared cache, so `./target/release/…` does not exist under the run's `cwd`.
  The package name is hashed per run — concurrent suites share that target directory, and equal
  names compile over one another's binary.
- **The cargo installer pre-warms a build.** A cold dependency build mid-solve would spend the
  whole compile budget; paying it at install time puts it inside a budget that reports a slow
  install as one, and leaves the run an incremental link.
- **A venv needs no toolchain identity in its key, and that was measured.** `bin/python3` is a
  symlink chain to the base interpreter, so if that interpreter is removed the warm probe reads
  **cold** and reinstalls; if it merely stops being the default, the venv keeps using its own
  recorded interpreter and still works. The remaining exposure is a swept `site-packages` with
  the interpreter intact, which surfaces as an ImportError naming the module — the same
  transitive-sweep ceiling npm has.
- **`runSuite` is the only resolver.** A project's `function` check reaches libraries through
  the same call, so `gradeProjectDir` hands directories to `build` and render checks only.
- **A `program` suite resolves *no* libraries yet, and that is a stated ceiling, not an
  oversight.** `runProgramSuite` accepts a `libDir` and consumes it exactly as the function envs
  do (`CLASSPATH` / `NODE_PATH` / `VIRTUAL_ENV` / `CARGO_TARGET_DIR`), but no caller computes one:
  the run handlers and `runProgramArtifact` both pass none. So a `package` declaring `libs:` and
  graded by `program` builds without them and fails naming the missing import — a loud failure,
  never a false green. Closing it means resolving through `ensureLibEnv` at those two call sites,
  which is where the second resolver would otherwise creep in; do it there, not inside the runner.

### Test runner

- `runSuite(code, tests, parsed, env)` — `env.validate` gate, one `mkdtemp`, `env.emit()`,
  write every file, run `compile` then `run` (both `cwd` = temp dir), `env.parse(stdout)`. A
  compiled language pays `javac` **once per suite**, not per case. The runner orchestrates
  only — the env owns the commands. Pure result mapping lives in
  [leetcode-runner.helpers.ts](src/services/leetcode-runner.helpers.ts).
- A **contract violation** (`env.validate` non-null) fills every case with the message and
  runs nothing; a **compile error** fills every case with `compilation error: …`, and a build
  that outlives `COMPILE_TIMEOUT_MS` says `compilation timed out` rather than reporting the
  empty stderr a killed compiler leaves behind.
- **Timeout attribution.** One budget per suite (`cases × test.timeoutMs`, capped at 60 s).
  On a kill `exec` still returns the stdout already produced, so every case that printed
  keeps its real result and every case from the first missing index on is `timeout` — this is
  why the sentinel matters, partial stdout must stay parseable.
- `detectRuntime(detectCmd: string)` (in the handlers, before `runSuite`) shells out
  `LANGUAGES[langId].detectCmd`; `env.detect()` gates additionally when present.
- **Run Tests** — public suite, live buffer. Never writes frontmatter, never stops the clock,
  never lifts restrictions. Not offered outside a live challenge; the handler guards anyway.
- **Submit** — public + final against the live buffer, falling back to the stored solution
  when no challenge runs. All green → `status: 'solved'` + `<!-- meta: … -->`; failure
  **during a live challenge** → `status: 'attempted'`; failure with **no** live challenge
  writes nothing (a dry run must never downgrade a solved artifact). Submit is **one shot** —
  either way the challenge ends and restrictions lift; *Solve It* re-arms with a new file and
  `attempted → solved` is allowed.

### Challenge session

`startChallenge()` ([leetcode-challenge.service.ts](src/services/leetcode-challenge.service.ts))
owns the single in-flight run: temp file, `PracticeMode` snapshot, `LeetCodeTimer`, status-bar
clock, and a `state: ChallengeState` ([leetcode.types.ts](src/types/leetcode.types.ts)) read
through the `challengeState()` accessor. Only one session per window — starting a second ends
the first, so a settings snapshot is never stranded.

**No reopen-to-retry.** Every *Solve It* writes a **new**, uniquely-named temp file under
`globalStorageUri/attempts/` (`exerciseFileName` mints a fresh run suffix per call —
[exercise-file.helpers.ts](src/services/exercise-file.helpers.ts)); there is nothing to
overwrite. A run that ends without being explicitly discarded leaves its file on disk; only
`discardChallenge()` ([leetcode-run.handlers.ts](src/commands/leetcode-run.handlers.ts))
deletes one, via the view's Back (idle, no confirmation) or Close (running, modal). Back also
sweeps a stale attempt from an already-finished run — the view tracks the last attempt's URI
independently of the live session. Abandoned files are an accepted trade-off; cleanup belongs
to a future "resume unfinished runs" feature.

### Timer

`LeetCodeTimer` starts with the challenge and stops on a successful Submit; elapsed time is
formatted `XmYs` into the solution metadata. That stopwatch always runs, regardless of
`practice.timeLimit`.

The **status-bar clock and in-view header timer always run too** — every challenge gets one.
One pure function, `timerTick(startedAt, deadline, now): TimerTick`
([leetcode-challenge.helpers.ts](src/services/leetcode-challenge.helpers.ts)), decides both
modes from a single `deadline: number | null`: bounded (`timeLimit > 0`) counts **down** from
`startedAt + minutes × 60_000` and auto-submits at zero through the same `handleSubmit` a
click uses; unlimited (`deadline = null`) counts **up** and **never** auto-submits —
`expire()` fires only when `!unlimited && ms <= 0`. Both render through the same `MM:SS`
formatter (`formatClock`, [utils/time.helpers.ts](src/utils/time.helpers.ts)); the status bar
appends `· no limit` when unlimited. Ticks fan out from `startTimer()` through
`ChallengeCallbacks.onTick(tick)` to the view provider's `timerSeed()` (initial render) and
`postTick()` (live webview). Expiry warns but never closes the editor or lifts restrictions —
abandoning a bounded run stays the user's call.

### Preview panel

[leetcodePreview.panel.ts](src/ui/panels/leetcodePreview.panel.ts) renders the challenge
screen: nav header, title, difficulty/status/algorithm badges, description, example cards,
test-count line, `# Setup` starter blocks, reference solutions collapsed behind a `<details>`
(spoilers), state-gated controls, and the `<div id="results">` sink.

**The test-count line follows what actually grades the artifact.** `renderTestCounts` reads
`## Tests`/`## Final Tests` for a function exercise (`2 public tests · 3 final tests`), but a
`project` is graded by `checks:`, so it gets one line per check —
`app builds (build) · pass/fail on exit status`, `catalogue filter (function) · 2 public · 3
hidden`. Reading the function suite for a project told a build-only exercise it had **`0
tests`** and made the Next.js spike's second check invisible, so a solver could not see
everything gating their Submit. Check **names are artifact-authored** and go through `escHtml`;
case values never render, public or hidden.

The **description is Markdown** and renders through `renderMarkdownLite`
([utils/markdown-lite.ts](src/utils/markdown-lite.ts)) — paragraphs, headings, lists,
blockquotes, inline code, bold/italic, `http(s)` links, and nothing else. It is a *whitelist*
renderer, not a parser with an HTML passthrough: the source is `escHtml`'d **first** and markup
is only ever added by those rules, so an artifact's own prose cannot inject HTML, and a
`javascript:`/`data:`/relative link renders as its bare label. Everywhere else in the panel
still interpolates through plain `escHtml`.

Controls are **phase-driven, not `disabled`-gated**: `renderControls(state, parsed)` and
`renderNavHeader(state, …)` ([leetcodePreview.controls.ts](src/ui/panels/leetcodePreview.controls.ts))
switch wholesale on `ChallengeState['phase']` — `running` gives the close-✕, timer, Run Tests
and Submit; `idle`/`attempted` share the back-arrow, practice settings and a solo Solve It (a
failed run has nothing left to gate); `solved` shows the summary. The webview script hides
every setup/solution block whose `data-language` ≠ the selection; `data-language` carries the
*canonical* id, so an aliased heading (`## JS`) still matches `javascript`.

---

## Key Config Files

| File | Purpose |
|---|---|
| `tsconfig.json` | Strict, `ES2022`, `Node16` resolution, `rootDir: "."`, out to `dist/` |
| `package.json` | `"main": "./dist/src/extension.js"` — mirrors `rootDir: "."` |
| `eslint.config.mjs` | Naming conventions, curly braces, `===`, semicolons |
| `.vscode/launch.json` | Debug launch; other extensions disabled in the host |
| `.vscode/tasks.json` | `pnpm watch` is the default build task (runs on F5) |
| `.vscode-test.mjs` | Looks for compiled tests at `dist/test/**/*.test.js` |

## VS Code Extension Notes

- `activationEvents: ["onStartupFinished"]`.
- `dist/` is **gitignored** — `pnpm compile` after cloning.
- All imports carry explicit `.js` extensions (`'./helpers.js'`) — required by `Node16`
  resolution even in `.ts` source.
- Webview `localResourceRoots` is restricted to `extensionUri/src/ui` — **all** webview
  assets (both stylesheets) must live there.
- Webviews handling clicks need `enableScripts: true`.

---

## Code Style

### ⚠️ Methodology (READ FIRST)

**TDD, CUPID, DDD**, in that order.

> **Planning a multi-agent feature? Read [CREATING_A_PLAN.md](CREATING_A_PLAN.md) first.** It
> owns the process: where plan files live (`docs/plans/<feature>/`, branch-local, deleted
> before the PR merges — `develop` and `main` never carry them), the orchestrator/worker
> topology, the skills every agent loads (`caveman`, `ponytail`, `mastering-typescript`), the
> static-analysis rule (§3.1 — the IDE extension, **not** `sonar-analyze`), the six-field task
> format, and the ledger. This section stays the authority on *how to write the code*; that
> file is the authority on *how a plan is structured and executed*.

> **Dispatching workers in parallel? Disjoint `Owns` is not enough.** `tsc` compiles one
> project, so a sibling worker's half-finished refactor reddens *your* gate: a worker sees
> missing exports it did not cause, and cannot tell a real regression from a neighbour's
> in-flight edit. Measured on this repo — two workers with genuinely disjoint file sets, one
> mid-refactor, and the combined `dist/test/**/*.test.js` run red for both. Two consequences,
> and the second is the dangerous one: a worker may report a red tree it did not break, **and a
> worker may read a green tree as evidence when a sibling has not landed yet**. So either give
> each worker its own git worktree, or — cheaper and usually enough — tell every parallel
> worker to **gate only its own suite in isolation** and leave the combined gate to the
> orchestrator at wave close. Never gate a wave until every worker in it has finished.

- **TDD — test first, where it makes sense.** For any pure, `vscode`-free unit (parsers,
  codegen, env `emit`/`validate`, suite selection, helpers) write the failing test **before**
  the code. `test/*.test.ts` is the pattern: `node:assert`, Mocha **TDD** (`suite`/`test`),
  inline fixtures. Code that must import `vscode` (webviews, views, commands, timers) is
  verified by the **F5 manual pass** — don't contort it to be unit-testable; push the logic
  into a pure helper that *is* tested and keep the `vscode` layer a thin wire.
- **Behaviour-preserving refactors need a golden net first** — byte-exact `strictEqual`
  snapshots captured *before* editing and never touched during it
  (`test/leetcode-codegen-golden.test.ts` is the model).
- **Deleting tests for deleted code is allowed — loudly:** relocate any assertion still
  covering live behaviour and say so in the commit. Silent test-count drops are not.
- **CUPID:** **C**omposable (small surface, few deps), **U**nix-philosophy (one thing),
  **P**redictable (no hidden state), **I**diomatic (reads like its neighbours),
  **D**omain-based (LeetCode names, not framework names). When ambiguous, take the option
  that improves one without hurting another.
- **DDD:** exercise, challenge, attempt, suite, test environment, practice mode live in
  `src/types/` and drive the names in `services/`. The domain model stays free of VS Code
  types — `vscode` is an adapter at the edges (commands, panels, views), never in core
  services. New concepts get a named type before behaviour.

### ⚠️ Principles

- **DRY — one authority per cross-cutting concern.** A second copy is drift waiting to
  happen; this repo was already bitten (codegen knew `rust`, the runner table did not).
  **Never hardcode a language or test-type list inline** — derive it (`LANGUAGES`,
  `languagesForType`, `VALID_*`). Reuse `src/utils/` before writing a helper: `escapeRe`,
  `safeJsonParse`, `canonicalJson`, `escHtml`, `renderMarkdownLite`, `getNonce`,
  `splitMs`/`formatClock`/`formatDuration`, plus `sectionBounds` (shared by the section *reader* and the attempts
  *writer*, which used to mirror each other and drift).
  **Three authorities own reading a `.md` artifact's config, and none may be re-implemented**
  ([leetcode-config-blocks.helpers.ts](src/services/leetcode-config-blocks.helpers.ts)):
  `extractConfigBlocks` is the **only** thing that finds ` ```yaml leetcode ` fences — it
  returns their merged text *and* their `spans`, which is why `extractDescription` subtracts
  them rather than re-finding the fences with a second regex; `splitFrontmatter` is the
  **only** frontmatter/body split, so `parseLeetCode` and `verifyExercise` cannot disagree on
  where frontmatter ends (two regexes that disagree is how a config key hides from the hard-cut
  check); and `BODY_SET_KEYS` is the **only** list of the nine moved keys — `legacyFrontmatterKeys`
  and `withoutBodySetKeys` read it, and `project-parser.helpers.ts` **imports** it to build its
  known-key set instead of re-listing the names.
  **`warnings` is `undefined` for a clean `function` artifact and `[]` for a clean
  `project`/`service` one.** Inherited, not chosen: the field was `project?.warnings`, absent
  when `parseProjectArtifact` never ran. `JSON.stringify` omits an `undefined` key, so
  collapsing the two changes the serialised shape of every clean project — a golden-net
  regression that green tests elsewhere will not catch.
  **`sectionBounds` is fence-aware, and that is load-bearing.** A boundary heading inside a
  ``` fence does not end the section: a column-zero `#` is a *comment* in Python, shell, YAML
  and Dockerfile, and a heading only in a Markdown fence. Matching it truncated the section
  silently — a `# Solutions` whose Python fence opened with a comment parsed to **zero**
  solutions, dropping every other language with it, and `fastapi-react.md` lost its entire
  `## Files` tree the same way. An unterminated fence runs to end of text rather than
  resuming boundary matching inside it. Its `boundaryOutsideFence` is **exported** so
  `extractDescription` finds its "first heading" the same fence-aware way — v2 puts YAML in the
  body, so a column-zero `#` before the first heading is now reachable as a comment.
- **KISS / YAGNI** — the simplest thing that works. No interface with one implementation, no
  factory for one product, no config for a value that never changes. Don't extract a one-line
  predicate into its own module because a plan said so; extract when a second caller or a
  real test needs it.
- **DOTW** — one concern per file, per function, per class.

### ⚠️ Security

`.md` artifacts, their test JSON, and the solution buffer are all **untrusted input**.

- **Parse defensively:** no `any`, no unchecked casts, no unguarded `JSON.parse` — use
  `safeJsonParse<T>()` ([utils/safe-json.ts](src/utils/safe-json.ts)), which returns `null`
  instead of throwing. Malformed input degrades to a documented default, never a crash.
- **Subprocesses:** run commands are **fixed literals** owned by the env (`javac
  Solution.java Runner.java`, `node runner.js`) executed with the temp dir as `cwd`. User
  data reaches the child as **file contents and JSON literals, never command-string
  interpolation** — keep it that way; if a path ever must enter a command, switch that call
  to an argument array rather than escaping.
- **Filesystem:** attempts are written only under `globalStorageUri/attempts/` with names
  minted by `exerciseFileName`; vault reads stay under the validated root. Never join a raw
  title or user string into a path.
- **Webviews:** every interpolated value goes through `escHtml`; keep the CSP `<meta>`,
  `getNonce()`, and `localResourceRoots` restricted to `src/ui`.
- No secrets in code, logs, or committed fixtures.

### File complexity limits

**Never grow a file into a god-object.** Before adding to a file, check whether the logic
belongs in a sibling — one import line is cheap, a 1000-line file is paid for on every read.

- A `.ts` file SHOULD stay under **~400 lines**; at ~500 plan a split; **past 700 split
  before adding more.** One cohesive concern may sit between 400 and 500 (the parser helpers
  are 431L) — fragmenting *one* concern to hit a number reads worse. Splitting a *god-file*
  is not optional.
- A function SHOULD stay under **~50 lines**; ESLint enforces cognitive complexity ≤ 15
  (`S3776`) — extract sub-methods as you approach it.
- A class SHOULD own **one concern**. Needing a `// ── Section X ──` comment to navigate
  inside a class means that section wants its own file.
- **Refactor proactively** — crossed 400 during a feature → propose the split in that PR.

### Where files go

1. **Domain logic** → `services/*.service.ts` (one concern) + a `*.helpers.ts` sibling for
   its pure functions. Never in a command or panel file — those wire VS Code to services and
   hold no logic.
2. **Pure and stateless** → that `*.helpers.ts` (create it if absent); pure *and
   cross-cutting* → `src/utils/`, one file per concern.
3. **Types** → `src/types/`: widely-depended config in `constants.ts`, language metadata in
   `languages.ts`, domain types in `leetcode.types.ts`. Types that hold `vscode` types
   (`PanelCtx`, `ChallengeSession`, `env.types.ts`) stay beside their owner — `src/types/`
   stays `vscode`-free.
4. **Webview HTML + handlers** → `src/ui/panels` or `src/ui/views`.
5. **CSS** → shared chrome in `styles.css`, feature-specific in its own file under `src/ui/`.
   Never embed CSS in `.ts`.
6. Only if 1–5 are all "no" with a good reason: add to the existing file.

**Never trust a "dead code" label — verify.** A descendant selector (`.popup-body pre`) can
style live markup emitted under a shared body class. Grep every symbol/class for references
**and** check what the live code emits, then prove a removal loss-free with a before/after
diff of the removed set.

### Comments

- Every function and interface gets a JSDoc block: concise description, `@param` tags,
  `@returns`, and at least one `@example`.
- Group logical blocks in longer functions with `// ── Section name ───` comments.
- Explain **why**, not **what** — well-named identifiers already say what.

### ESLint gotchas

- `RegExp.exec(str)`, not `str.match(re)` — `S6594`.
- `str.startsWith(x)`, not `/^x/.test(str)` — `S6557`.
- No nested template literals; extract the inner expression first — `S4624`.
- Cognitive complexity ≤ 15 per function — `S3776`.
- One import statement per module — `S3863` (merge type-imports into the existing one).

### Tooling in the loop

Verify with `npx tsc --noEmit` + `pnpm lint` + the mocha gate before calling a change done.
**Trust the tree over any plan or ledger** — verify claimed state (grep the literals, run the
gate) before acting on a document; tasks here have turned out already done, or deliberately
done differently, by the time their plan was read.

**Static analysis is the *SonarQube for IDE* (SonarLint) extension, not `sonar-analyze`.** Its
findings arrive on their own as `<ide_diagnostics>` after every edit, rule-tagged
(`typescript:S3776`), and are **fixed, not filed**. Do **not** invoke or install
`sonar-analyze`, `mcp__sonarqube__*`, or the `sonar` CLI: each needs a SonarQube server or Cloud
org, and taint analysis is a Developer Edition feature — there is no free path for a private
repo.

**The ceiling this leaves, and it is load-bearing.** Standalone IDE analysis runs local rules
only — **no taint/dataflow analysis**, so no tool in this repo will ever catch an injection or
path-traversal defect. The threat model in the Security section above is therefore held by
construction alone: argv arrays via `execFile` (never command strings), normalise-and-assert
every user-influenced path before a write, `escHtml` every webview interpolation, guard every
parse. On those surfaces a human or reviewer read is not a second opinion — it is the only
check. If the extension is ever absent, say so rather than reporting a clean pass.

---

## Related

Core repo *Obsidian Artifacts: AI Snippets & Tools* (Jira **VSX-5**); this extension is Jira
epic **VSX-35**, migration stories **VSX-64…68**. Phase 3 (future): an MCP server exposing
LeetCode artifacts to the local IDE AI agent for solution evaluation, hints, and practice modes.
