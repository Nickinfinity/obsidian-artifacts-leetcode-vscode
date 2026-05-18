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
   auto-created. The path is saved to `obsidianLeetcodeTrainer.vaultPath`.
2. `Obsidian LeetCode: Open LeetCode Problem` (command palette or editor
   context menu) opens a `QuickPick` listing `.md` files in `LeetCode/`.
3. Selecting a file parses it and opens the LeetCode preview panel — problem
   description, examples, language selector, solution code, and **Run Tests** /
   **Submit** buttons backed by the child-process runner.

---

## Folder Structure

```
src/
├── extension.ts                       # Entry point — activate() / deactivate()
├── commands/
│   ├── openSettings.command.ts        # Registers obsidian-leetcode.settings
│   └── leetcode.command.ts            # openLeetCodePicker — QuickPick + preview panel session
├── services/
│   ├── vault.service.ts               # validateObsidianVault(), createVaultDirectory(), LEETCODE_DIR
│   ├── context.service.ts             # refreshVaultContext(), CONFIG_NS — single vaultConfigured key
│   ├── frontmatter-patcher.service.ts # patchFrontmatterField() — status writeback on Submit
│   ├── leetcode-parser.service.ts     # parseLeetCode() — .md → ParsedLeetCode
│   ├── leetcode-codegen.service.ts    # mapType(), generateBoilerplate(), generateTestHarness(),
│   │                                  # jsonToLiteral(), injectSolution()
│   ├── leetcode-runner.service.ts     # detectRuntime(), runSingleTest(), runAllTests()
│   ├── leetcode-timer.service.ts      # LeetCodeTimer — start/stop/getElapsed/reset
│   └── lang-runners/
│       ├── runner.types.ts            # Re-export of LangRunner from types/
│       ├── java.runner.ts             # javaRunner config
│       ├── javascript.runner.ts       # jsRunner config
│       └── python.runner.ts           # pythonRunner config
├── ui/
│   ├── panels/
│   │   ├── settings.panel.ts          # Vault-folder picker webview (no artifact toggles)
│   │   └── leetcodePreview.panel.ts   # renderLeetCodePreviewHtml(), renderTestResultsHtml()
│   └── styles.css                     # Webview stylesheet — loaded via webview.asWebviewUri()
├── types/
│   └── leetcode.types.ts              # LeetCodeStatus, LeetCodeDifficulty, ParamDef,
│                                      # TestCase, TestResult, LeetCodeSolution,
│                                      # ParsedLeetCode, LangRunner
└── utils/
    ├── helpers.ts                     # getNonce() for CSP nonces
    └── html.helpers.ts                # escHtml() for webview HTML escaping
test/
├── leetcode-parser.test.ts            # parseLeetCode coverage
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
`obsidian-leetcode.settings` and `obsidian-leetcode.open`, awaits
`refreshVaultContext()` so menus reflect vault state before the first
interaction, and auto-opens Settings when no vault path is stored. An
`onDidChangeConfiguration` listener re-runs `refreshVaultContext()` on any
`obsidianLeetcodeTrainer.*` change (Settings Sync / manual edits).

### Vault config (trimmed from core)

- **Settings namespace:** `obsidianLeetcodeTrainer.*` — only `vaultPath`.
- **Context key:** `obsidian-leetcode.vaultConfigured` — the single `when`
  clause gate in `package.json`.
- [services/context.service.ts](src/services/context.service.ts) —
  `refreshVaultContext()` sets that key and, when configured, **create-only**
  ensures the `LeetCode/` directory exists (never deletes — no data loss).
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
| webview → ext | `runTests` | `{ language }` — first 3 test cases |
| webview → ext | `submit` | `{ language }` — all test cases |
| webview → ext | `selectLanguage` | `{ language }` |
| ext → webview | `testResults` | `{ html }` — rendered results table |

### No runtime dependencies

Only the VS Code API and Node built-ins (`node:child_process`,
`node:fs/promises`, `node:os`, `node:path`) are used. `highlight.js` from the
core repo is **not** a dependency — the LeetCode preview panel does not
syntax-highlight solution code.

---

## LeetCode Vault File Format

A `type: leetcode` artifact carries problem metadata, a Markdown description,
`## Examples`, `## Tests`, and a `# Solutions` tree:

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
| `tags` | string[] | no | `[]` | Organisational tags |

### Section semantics

- **Description** — Markdown between closing `---` and first `#`/`##` heading.
- **Examples** — `` ```example `` fences under `## Examples`, each with `input:` / `output:` lines.
- **Tests** — `` ```json `` fence under `## Tests`. Array of `{ input: Record<string, unknown>, expected: unknown }`. Input keys must match `params` names.
- **Solutions** — `# Solutions` → `## <Language>` → optional `### <Label>` + fenced code block. Multiple solutions per language allowed; unlabelled ones are auto-numbered `Solution #1`, `#2`, …
- **Solution metadata** — `<!-- meta: { "solved_at": "ISO-8601", "duration": "XmYs" } -->` comment immediately preceding the fence is parsed into `LeetCodeSolution.solvedAt` / `.duration`.

### Code generation

Boilerplate is two-layered:

| Layer | Source | Purpose |
|---|---|---|
| 1 | Built-in language templates | Default runnable wrapper from `function` + `params` + `returns` (Java: `class Main` + `Scanner`; Python: `input()`; JS: `readline`) |
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
- **Run Tests** executes the first 3 test cases (quick dev feedback).
- **Submit** executes all test cases; on full pass it updates `status: 'solved'` in frontmatter (via `patchFrontmatterField`) and writes the `<!-- meta: … -->` line for the active solution.

### Timer

`LeetCodeTimer` starts on the first Run Tests press and stops on a successful
Submit. Elapsed time is formatted as `XmYs` and recorded in the solution
metadata comment.

### Preview panel

[ui/panels/leetcodePreview.panel.ts](src/ui/panels/leetcodePreview.panel.ts)
renders the LeetCode view: description, difficulty badge (green/orange/red),
status badge, algorithm tag, examples as cards, language selector (populated
from parsed solutions), solution code, Run Tests / Submit buttons, and a
results table with pass/fail, actual vs expected, per-test duration, and
summary.

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
