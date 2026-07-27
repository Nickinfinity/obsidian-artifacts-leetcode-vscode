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

### Artifact harnesses (grade the `.md`, not the code)

```bash
node scripts/verify-exercise.mjs "<file.md>"                      # conformance + own solutions green
node scripts/verify-exercise.mjs "<file.md>" --expecteds <r.json> # diff stored vs recomputed expecteds
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
It turns `type: leetcode` notes in an Obsidian vault into runnable coding challenges: parse
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
│   └── test-envs/      # (test type × language) environments — validate/emit/parse a suite
│       └── function/   # The five `function` envs, all built by makeFunctionEnv(spec)
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
`node:fs/promises`, `node:os`, `node:path`) only. `highlight.js` from the core repo is **not**
a dependency; the preview panel does not syntax-highlight.

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

Orientation: a `type: leetcode` note carries frontmatter (`function`/`functions`, `params`,
`returns`, `practice`, `test`), a description, `## Examples`, `## Tests`, `## Final Tests`,
`# Setup`, `# Solutions`, and an extension-written `# Attempts`. Behaviour the spec does
**not** cover:

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
  a compiler.

### Language registry — the one authority

[src/types/languages.ts](src/types/languages.ts) holds `LangId`, the `LANGUAGES` registry
(`displayName`, `fileExt`, `commentPrefix`, `detectCmd`, `aliases`), `LANG_IDS`, and the
`isLangId` guard. It is the single home of **runnable** language metadata; the parallel
tables that used to drift beside it (`RUNNERS`, `SupportedLang`, a per-language runner
folder) are gone.

**Adding a runnable language = four rows, no scattered edits:**

1. a `LANGUAGES` entry (`src/types/languages.ts`),
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
parses its output into per-case outcomes. `testEnvFor(type, langId)` returns
`TestEnv | undefined` — the absence of a pair **is** the matrix, and `languagesForType(type)`
drives the language selector directly, so there is no second table to keep in sync.

The five `function` envs come from `makeFunctionEnv(spec)`
([make-function-env.ts](src/services/test-envs/function/make-function-env.ts)), which owns
`type: 'function'`, the two-file emit shape, and the shared sentinel parser; each language
supplies only its `runnerSource` / `candidateContent` / `validate`. They are self-contained —
the extension ships zero runtime dependencies and has no install path, so it cannot assume a
JUnit jar exists. `TestEnv.requires` / `detect()` exist so a version- or library-gated env can
run its own extra check without touching the runner; TypeScript's env is the first to use it,
gating on a Node version floor rather than a missing package (see the four-rows section above).

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

### Test runner

- `runSuite(code, tests, parsed, env)` — `env.validate` gate, one `mkdtemp`, `env.emit()`,
  write every file, run `compile` then `run` (both `cwd` = temp dir), `env.parse(stdout)`. A
  compiled language pays `javac` **once per suite**, not per case. The runner orchestrates
  only — the env owns the commands. Pure result mapping lives in
  [leetcode-runner.helpers.ts](src/services/leetcode-runner.helpers.ts).
- A **contract violation** (`env.validate` non-null) fills every case with the message and
  runs nothing; a **compile error** fills every case with `compilation error: …`.
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
