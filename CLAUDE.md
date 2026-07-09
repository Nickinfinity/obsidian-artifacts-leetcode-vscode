# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install           # Install deps (no node_modules by default — run after clone)
npm run compile        # One-off TypeScript build (outputs to dist/)
npm run watch          # Watch mode for development (preferred during active development)
npm run lint           # ESLint check (runs against src/)
npm run test           # Compile + lint + run all tests
npx tsc --noEmit       # Type-check only — IDE diagnostics can be stale; use this to verify
```

> `npm run test` launches a real VS Code instance and currently fails on this
> checkout with `listen EINVAL … 1.12-main.sock … longer than 103 chars` — the
> repo path pushes the IPC socket past the macOS limit, and `--user-data-dir` is
> ignored. Every test module is `vscode`-free, so run them straight from `dist/`:
>
> ```bash
> npm run compile
> node node_modules/.pnpm/mocha@*/node_modules/mocha/bin/mocha.js --ui tdd "dist/test/**/*.test.js"
> ```

Press **F5** in VS Code to launch the Extension Development Host.

---

## What This Extension Does

**Obsidian Artifacts: AI LeetCode Trainer** is a standalone, LeetCode-only
sibling of the core *Obsidian Artifacts: AI Snippets & Tools* extension. It
turns `type: leetcode` notes in an Obsidian vault into runnable coding
challenges: parse → auto-generate boilerplate + a per-language test harness →
run solutions against JSON test cases via local runtimes (Java / Python /
JavaScript) → display pass/fail in a dedicated preview panel.

Extracted from the core repo per Jira **VSX-35** (epic) / **VSX-64…68**
(migration stories). No artifact-type machinery, no parser/render/varset
pipeline — the only shared concept retained is a trimmed vault-folder picker.

The user flow:

1. First run opens the **Settings** panel — the user selects their Obsidian
   vault root (the folder containing `.obsidian/`). A `LeetCode/` directory is
   auto-created. The path is saved per-installation in `context.globalState`
   (machine-local — **not** Settings Sync; see "Vault path storage" below).
2. `Obsidian Artifacts: Open LeetCode Exercise` (command palette, or the
   **Obsidian Artifacts** submenu in the editor context menu) opens a
   `QuickPick` listing `.md` files in `LeetCode/`. `Obsidian Artifacts:
   Create LeetCode Exercise` is registered alongside it as a placeholder
   (scaffolding is a planned feature).
3. Selecting a file parses it and opens the LeetCode preview panel — problem
   description, examples, language selector, `# Setup` starter code, reference
   solutions (collapsed behind a `<details>`), practice-mode checkboxes, a time
   limit, and **Solve It** / **Submit** buttons.
4. **Solve It** writes the starter code for the selected language to a temp file
   under `globalStorageUri/attempts/`, opens it in the main editor group, applies
   the selected editor restrictions, and starts the countdown. **Submit** runs
   the live buffer against every test case; on green it patches `status: solved`,
   restores the editor settings, and ends the challenge.

---

## Folder Structure

```
src/
├── extension.ts                       # Entry point — activate() / deactivate()
├── commands/
│   ├── openSettings.command.ts        # Registers obsidian-leetcode.settings
│   ├── createExercise.command.ts      # Registers obsidian-leetcode.create (placeholder)
│   └── leetcode.command.ts            # openLeetCodePicker — QuickPick + preview panel session
├── services/
│   ├── vault.service.ts               # validateObsidianVault(), createVaultDirectory(), LEETCODE_DIR
│   ├── vault-path.store.ts            # getVaultPath/setVaultPath/migrateLegacyVaultPath — globalState
│   ├── context.service.ts             # refreshVaultContext(context) — single vaultConfigured key
│   ├── frontmatter-patcher.service.ts # patchFrontmatterField() — status writeback on Submit
│   ├── leetcode-parser.service.ts     # parseLeetCode(), defaultPracticeConfig() — frontmatter
│   ├── leetcode-sections.helpers.ts   # extractDescription/Examples/Tests/Setups/Solutions
│   ├── leetcode-codegen.service.ts    # mapType(), generateBoilerplate(), generateTestHarness(),
│   │                                  # jsonToLiteral(), injectSolution()
│   ├── leetcode-runner.service.ts     # detectRuntime(), runSingleTest(), runAllTests()
│   ├── leetcode-timer.service.ts      # LeetCodeTimer — start/stop/getElapsed/reset
│   ├── leetcode-challenge.service.ts  # startChallenge/endChallenge/activeChallenge + countdown
│   ├── exercise-file.service.ts       # resolveStarterCode(), exerciseFileUri(), openExerciseFile()
│   ├── practice-mode.service.ts       # PracticeMode — apply/restore editor restrictions
│   ├── language-map.service.ts        # resolveLangId(), extForLang(), extForFenceLang()
│   └── lang-runners/
│       ├── runner.types.ts            # Re-export of LangRunner from types/
│       ├── java.runner.ts             # javaRunner config
│       ├── javascript.runner.ts       # jsRunner config
│       └── python.runner.ts           # pythonRunner config
├── ui/
│   ├── panels/
│   │   ├── settings.panel.ts          # Vault-folder picker webview (no artifact toggles)
│   │   ├── leetcodePreview.panel.ts   # renderLeetCodePreviewHtml(), renderTestResultsHtml()
│   │   └── leetcodePreview.controls.ts# renderLanguageRow/Setups/PracticeControls/Actions
│   └── styles.css                     # Webview stylesheet — loaded via webview.asWebviewUri()
├── types/
│   ├── constants.ts                   # LANG_ALIAS, LANG_EXT, PRACTICE_OPTIONS, ATTEMPTS_DIR,
│   │                                  # EXERCISE_FILE_PREFIX, SOLUTION_MARKER
│   └── leetcode.types.ts              # LeetCodeStatus, LeetCodeDifficulty, ParamDef,
│                                      # TestCase, TestResult, LeetCodeSolution, ExerciseSetup,
│                                      # PracticeOption(Id), PracticeConfig, ParsedLeetCode,
│                                      # LangRunner
└── utils/
    ├── helpers.ts                     # getNonce() for CSP nonces
    └── html.helpers.ts                # escHtml() for webview HTML escaping
test/
├── leetcode-parser.test.ts            # parseLeetCode coverage
├── leetcode-setup-practice.test.ts    # # Setup section + practice: frontmatter block
├── leetcode-language-map.test.ts      # resolveLangId / extForLang / extForFenceLang
├── leetcode-typemap.test.ts           # mapType primitives / arrays / maps / passthrough
├── leetcode-codegen.test.ts           # generateBoilerplate / generateTestHarness / jsonToLiteral
├── leetcode-runners.test.ts           # java/javascript/python runner configs
├── leetcode-runner.test.ts            # detectRuntime / runSingleTest / runAllTests
├── leetcode-timer.test.ts             # LeetCodeTimer class
├── leetcode-inject.test.ts            # injectSolution
└── leetcode-preview.test.ts           # renderLeetCodePreviewHtml / renderTestResultsHtml
```

> The `fixture()` helper used by the codegen tests is defined inline in the
> test files — there is no `test/fixtures/` directory.

---

## Architecture

### Entry point

[src/extension.ts](src/extension.ts) — `activate()` registers
`obsidian-leetcode.settings`, `obsidian-leetcode.create`,
`obsidian-leetcode.open`, and `obsidian-leetcode.endChallenge`, runs
`migrateLegacyVaultPath()` then awaits
`refreshVaultContext(context)` so menus reflect vault state before the first
interaction, and auto-opens Settings when no vault path is stored. There is no
`onDidChangeConfiguration` listener — the vault path is not configuration; the
settings panel calls `refreshVaultContext(context)` directly after saving.

All four commands are surfaced in the command palette as `Obsidian
Artifacts: …` (shared `category`); the first three also appear under an
**Obsidian Artifacts** `submenu` in `editor/context`.
`obsidian-leetcode.create` is a placeholder
([commands/createExercise.command.ts](src/commands/createExercise.command.ts)).
`obsidian-leetcode.endChallenge` is palette-only and is also the `command` of
the countdown status-bar item, so clicking the clock ends the run and restores
the editor settings.

### Vault path storage (per-installation)

- **Storage:** `context.globalState` key `vaultPath`, machine-local.
  `setKeysForSync` is **never** called, so the path is excluded from Settings
  Sync — each install keeps its own OS-correct path (a synced absolute path
  caused `ENOENT` across macOS/Linux).
- [services/vault-path.store.ts](src/services/vault-path.store.ts) —
  `getVaultPath()` / `setVaultPath()` / `migrateLegacyVaultPath()` (one-time:
  copies any legacy synced `obsidianLeetcodeTrainer.vaultPath` into
  `globalState`, then clears the synced setting so a stale cross-OS path stops
  propagating). The `obsidianLeetcodeTrainer.*` configuration contribution was
  removed from `package.json`.
- **Context key:** `obsidian-leetcode.vaultConfigured` — the single `when`
  clause gate in `package.json`.
- [services/context.service.ts](src/services/context.service.ts) —
  `refreshVaultContext(context)` sets that key and, when configured,
  **create-only** ensures the `LeetCode/` directory exists (never deletes — no
  data loss).
- [services/vault.service.ts](src/services/vault.service.ts) — only
  `validateObsidianVault()` (requires a `.obsidian/` dir) and
  `createVaultDirectory()`. The core extension's `detectVaultDirs` /
  `deleteVaultDirectory` / artifact-type logic was intentionally dropped.
- [ui/panels/settings.panel.ts](src/ui/panels/settings.panel.ts) — folder
  picker webview; no per-artifact enable/disable checkboxes.

### Ported couplings

The LeetCode pipeline was moved unchanged from the core repo. Only three
cross-module couplings were rewired so this repo has no dependency on the core
artifact code:

| Original (core) | Here |
|---|---|
| `escHtml` from `artifactPicker/preview.helpers.ts` | [utils/html.helpers.ts](src/utils/html.helpers.ts) |
| `patchFrontmatterField` from `artifact-patcher.service.ts` | [services/frontmatter-patcher.service.ts](src/services/frontmatter-patcher.service.ts) |
| `validateObsidianVault` from full `vault.service.ts` | trimmed [services/vault.service.ts](src/services/vault.service.ts) |

### Webview ↔ extension message protocol (preview panel)

| Direction | Command | Payload |
|---|---|---|
| webview → ext | `solveIt` | `{ language, options, timeLimitMinutes }` — opens the temp file, arms practice mode |
| webview → ext | `submit` | `{ language }` — all test cases |
| webview → ext | `selectLanguage` | `{ language }` |
| ext → webview | `testResults` | `{ html }` — rendered results table |

`runTests` was removed — the preview panel is a briefing screen, not a test
runner. A locked artifact (`practice.locked: true`) causes the extension to
ignore the `options` / `timeLimitMinutes` fields and use its own frontmatter.

### No runtime dependencies

Only the VS Code API and Node built-ins (`node:child_process`,
`node:fs/promises`, `node:os`, `node:path`) are used. `highlight.js` from the
core repo is **not** a dependency — the LeetCode preview panel does not
syntax-highlight solution code.

---

## LeetCode Vault File Format

A `type: leetcode` artifact carries problem metadata, a Markdown description,
`## Examples`, `## Tests`, a `# Setup` tree, and a `# Solutions` tree:

```md
---
type: leetcode
title: Two Sum
difficulty: easy
function: twoSum
algorithm: hash-map
status: unsolved
params:
  - { name: nums, type: int[] }
  - { name: target, type: int }
returns: int[]
practice:
  timeLimit: 30
  locked: false
  options: [noCompletion, noAiAgents]
tags: [leetcode, arrays, hash-map]
---

Problem description as Markdown prose.

## Examples
```example
input: nums = [2,7,11,15], target = 9
output: [0,1]
```

## Tests
```json
[
  { "input": { "nums": [2,7,11,15], "target": 9 }, "expected": [0,1] },
  { "input": { "nums": [3,2,4], "target": 6 }, "expected": [1,2] }
]
```

# Setup

## JavaScript
```javascript
// function definition
function twoSum(nums, target) {
  // solution here
}
```

# Solutions

## Java
### Hash Map
<!-- meta: { "solved_at": "2025-05-12T14:30:00", "duration": "8m22s" } -->
```java
public static int[] twoSum(int[] nums, int target) { /* … */ }
```

## Python
```python
def two_sum(nums, target): ...
```
```

### Frontmatter fields

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `type` | `'leetcode'` | yes | — | Discriminator |
| `title` | string | yes | — | Display title |
| `difficulty` | `LeetCodeDifficulty` | no | `'easy'` | `easy` / `medium` / `hard` |
| `function` | string | yes | — | Function name to implement |
| `algorithm` | string | no | — | Category tag (e.g. `hash-map`) |
| `status` | `LeetCodeStatus` | no | `'unsolved'` | Auto-updated on successful Submit |
| `params` | `{ name, type }[]` | yes | — | Generic types (see mapping below) |
| `returns` | string | yes | — | Generic return type |
| `practice` | `PracticeConfig` | no | see below | Pre-selected practice-mode restrictions |
| `tags` | string[] | no | `[]` | Organisational tags |

### `practice:` block

| Sub-key | Type | Default | Notes |
|---|---|---|---|
| `timeLimit` | number (minutes) | `0` | `0` = no countdown. Negative / unparsable → `0` |
| `locked` | boolean | `false` | `true` renders the panel controls disabled and makes the settings mandatory |
| `options` | `PracticeOptionId[]` | `[noCompletion, noAiAgents]` | Inline `[a, b]` or YAML `- a` list; unknown ids dropped. `options: []` = no restrictions |

`PracticeOptionId` ∈ `noCompletion` | `noAiAgents` | `noSnippets` |
`noParameterHints`. Each maps to a set of VS Code settings in
`PRACTICE_OPTIONS` ([types/constants.ts](src/types/constants.ts)). VS Code has
no per-editor configuration scope, so `PracticeMode` writes them at **global**
scope and restores the previous `globalValue` on teardown (panel dispose,
successful Submit, `Obsidian Artifacts: End LeetCode Challenge`, or
`deactivate()`).

### Section semantics

- **Description** — Markdown between closing `---` and first `#`/`##` heading.
- **Examples** — `` ```example `` fences under `## Examples`, each with `input:` / `output:` lines.
- **Tests** — `` ```json `` fence under `## Tests`. Array of `{ input: Record<string, unknown>, expected: unknown }`. Input keys must match `params` names.
- **Setup** — `# Setup` → `## <Language>` → fenced code block. Only the **first** fence per language is taken: a setup is a single starter stub (the function definition, not the solution), never a labelled list. This is exactly what lands in the temp file on **Solve It**. A language with no setup falls back to `generateBoilerplate()`.
- **Solutions** — `# Solutions` → `## <Language>` → optional `### <Label>` + fenced code block. Multiple solutions per language allowed; unlabelled ones are auto-numbered `Solution #1`, `#2`, …
- **Solution metadata** — `<!-- meta: { "solved_at": "ISO-8601", "duration": "XmYs" } -->` comment immediately preceding the fence is parsed into `LeetCodeSolution.solvedAt` / `.duration`.

### Code generation

Boilerplate is two-layered:

| Layer | Source | Purpose |
|---|---|---|
| 1 | Built-in language templates | Default runnable wrapper from `function` + `params` + `returns` (Java: `class Main` + `Scanner`; Python: `input()`; JS: `readline`) |
| 2 | `# Setup` blocks in `.md` | Starter stub the solver begins from — preferred over Layer 1 |
| 3 | Override code blocks in `.md` | Used only when the default wrapper does not fit |

The wrapper holds a `<<SOLUTION>>` marker; `injectSolution(boilerplate, code)`
replaces it while preserving indentation.

### Generic → language type mapping

`mapType(generic, language)` translates frontmatter generics to language-native
types. Unknown generics pass through unchanged; unknown languages return the
generic as-is. Java boxes primitives inside generics (`int` → `Integer`).

| Generic | Java | Python | JavaScript | Rust |
|---|---|---|---|---|
| `int` | `int` | `int` | `number` | `i32` |
| `float` | `double` | `float` | `number` | `f64` |
| `string` | `String` | `str` | `string` | `String` |
| `bool` | `boolean` | `bool` | `boolean` | `bool` |
| `int[]` | `int[]` | `List[int]` | `number[]` | `Vec<i32>` |
| `int[][]` | `int[][]` | `List[List[int]]` | `number[][]` | `Vec<Vec<i32>>` |
| `map<string,int>` | `Map<String, Integer>` | `Dict[str, int]` | `Record<string, number>` | `HashMap<String, i32>` |

### Test runner

- `generateTestHarness(parsed, language)` emits per-language assert-based unit tests from the JSON test cases.
- `runSingleTest` / `runAllTests` spawn a child process per `LangRunner` (`javac` + `java`, `node`, `python3`), capture stdout, and compare against `expected`.
- 5 s timeout per test case.
- `detectRuntime(runner)` shells out `runner.detectCmd` to confirm the toolchain is installed.
- **Submit** executes all test cases against the **live text of the temp exercise file** (unsaved edits included), falling back to the artifact's stored solution when no challenge is running. On full pass it updates `status: 'solved'` in frontmatter (via `patchFrontmatterField`), writes the `<!-- meta: … -->` line, and ends the challenge.
- Runners exist for `java`, `javascript`, `python` only. A challenge may be *started* in any language that has a `# Setup` block; Submit will reject the ones without a runner.

### Challenge session

`startChallenge()` ([leetcode-challenge.service.ts](src/services/leetcode-challenge.service.ts))
owns the single in-flight run: the temp file, the `PracticeMode` snapshot, the
`LeetCodeTimer`, and the status-bar countdown. Only one session may be active
per window — starting a second ends the first, so a settings snapshot is never
stranded. The temp file is created under `globalStorageUri/attempts/` and is
**never overwritten** if it already exists: a mis-clicked *Solve It* reopens the
previous attempt rather than discarding it.

### Timer

`LeetCodeTimer` starts when the challenge starts and stops on a successful
Submit. Elapsed time is formatted as `XmYs` and recorded in the solution
metadata comment. When `practice.timeLimit > 0` a status-bar countdown ticks
down beside it; expiry warns but never closes the editor or lifts the
restrictions — abandoning a run is the user's call.

### Preview panel

[ui/panels/leetcodePreview.panel.ts](src/ui/panels/leetcodePreview.panel.ts)
renders the LeetCode view: description, difficulty badge (green/orange/red),
status badge, algorithm tag, examples as cards, language selector (union of
setup + solution languages), `# Setup` starter blocks, reference solutions
collapsed behind a `<details>` (they are spoilers), the practice-option
checkboxes + time-limit input, Solve It / Submit buttons, and a results table
with pass/fail, actual vs expected, per-test duration, and summary.

Row rendering for the selector, setups, practice controls, and action buttons
lives in the sibling
[leetcodePreview.controls.ts](src/ui/panels/leetcodePreview.controls.ts). The
webview script hides every setup/solution block whose `data-language` does not
match the selected language.

---

## Key Config Files

| File | Purpose |
|---|---|
| `tsconfig.json` | Strict mode, `ES2022` target, `Node16` module resolution, `rootDir: "."`, output to `dist/` |
| `package.json` | `"main": "./dist/src/extension.js"` — mirrors the `rootDir: "."` output path |
| `eslint.config.mjs` | Enforces naming conventions, curly braces, `===` equality, semicolons |
| `.vscode/launch.json` | Debug launch with `--extensionDevelopmentPath`; other extensions disabled in the host |
| `.vscode/tasks.json` | `pnpm watch` is the default build task (runs automatically on F5) |
| `.vscode-test.mjs` | Test runner looks for compiled tests at `dist/test/**/*.test.js` |

---

## VS Code Extension Notes

- `activationEvents: ["onStartupFinished"]` in `package.json` — the extension activates after window startup.
- Compiled output goes to `dist/` and is **gitignored**. Run `npm run compile` after cloning.
- All imports use explicit `.js` extensions (e.g. `'./helpers.js'`) — required by `Node16` module resolution even for `.ts` source files.
- Webview `localResourceRoots` is restricted to `extensionUri/src/ui` — all webview assets must live in `src/ui/`.
- Webview panels that handle button clicks must be created with `enableScripts: true`.

---

## Code Style

### ⚠️ File complexity limits (READ FIRST)

**Never grow a single file into a god-object.** Before adding code to an existing file, check whether the new logic belongs in a sibling file instead. The cost of one extra import line is trivial; the cost of a 1000-line file is paid every time anyone reads it.

**Hard rules:**
- A single `.ts` file SHOULD stay under **~400 lines**. At ~500 lines, plan a split. **Past 700 lines, split before adding more.**
- A single function SHOULD stay under **~50 lines**. ESLint enforces cognitive-complexity ≤ 15 (rule `S3776`); when you approach it, extract sub-methods.
- A single class SHOULD own **one concern**. If you find yourself writing a `// ── Section X ──` comment block to navigate inside a class, that section probably wants to be its own file or controller.

**Splitting pattern:** every domain feature gets a folder, not a file. Inside the folder:
- One `*.ts` per **concern** (one class / one orchestrator / one HTML renderer / one watcher).
- One sibling `*.helpers.ts` per concern for **pure functions, escapers, adapters, constants** that the main file uses but does not own state for.
- A `shared.ts` (or similar) for cross-concern singletons (output channels, view-type ids, etc.).

**Decision flow when you reach for a file that is already large:**
1. Does the new code belong to the **same concern** as the existing file? If no → new sibling file.
2. Is the new code **stateless / pure**? If yes → put it in the matching `*.helpers.ts` (create one if absent).
3. Is it a **service / cross-cutting**? If yes → `src/services/`, not the panel/command file.
4. Only if 1-3 are all "no"-with-good-reason: add it to the existing file.

**Refactor proactively, not reactively.** When you finish a feature and notice the file crossed 400 lines, propose a split in the same PR rather than letting debt accumulate.

### Comments
- Every function and interface must have a JSDoc block that includes: a concise description, `@param` tags, a `@returns` tag, and at least one `@example`.
- Add inline section comments (e.g. `// ── Section name ───`) to visually group logical blocks within longer functions.
- Comments should explain **why**, not **what** — well-named identifiers already describe what the code does.

### File organisation
- Follow the folder structure defined above.
- Functions and classes belong in a `services/` or `utils/` file, not in command or panel files.
- Types and interfaces go in `src/types/`.
- Webview panel logic (HTML generation + message handling) belongs in `src/ui/panels/`.

### ESLint gotchas
- Use `RegExp.exec(str)` not `str.match(re)` — rule `S6594`.
- Use `str.startsWith(x)` not `/^x/.test(str)` — rule `S6557`.
- No nested template literals — extract inner expression to a variable first — rule `S4624`.
- Cognitive complexity limit is 15 per function (`S3776`) — extract sub-methods when approaching it.

---

## Related

- Core extension repo: *Obsidian Artifacts: AI Snippets & Tools* (Jira **VSX-5**).
- Jira epic: **VSX-35**. Migration stories: **VSX-64…68**.
- Future (Phase 3): MCP server exposing LeetCode artifacts to the local IDE AI agent (Claude / OpenAI / Copilot) for solution evaluation, hints, and practice modes.
