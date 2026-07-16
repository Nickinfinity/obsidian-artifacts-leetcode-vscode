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
   the selected editor restrictions, and starts the countdown.
5. **Run Tests** (enabled only while a challenge is live) grades the live buffer
   against the *public* `## Tests` suite. Nothing is written, the clock keeps
   running, the restrictions stay. It is the iteration loop.
6. **Submit** grades *public + hidden* `## Final Tests` and ends the challenge
   either way: all green → `status: solved` plus a `<!-- meta: … -->` duration
   comment; any failure → `status: attempted`. Editor settings are restored on
   both paths. Solve It again starts a **fresh** attempt file, not a reopened
   one (see "Challenge session" below).

---

## Folder Structure

```
src/
├── extension.ts        # Entry point — activate() / deactivate(), command + view registration
├── commands/           # VS Code command handlers + the run orchestration (picker, solveIt, submit)
├── services/           # All domain logic: parse, codegen, runner, challenge/timer, vault, exercise-file
│   ├── test-envs/      # (test type × language) environments — validate/emit/parse a suite
│   │   └── function/   # The three built-in `function` envs (java, python, javascript)
│   └── lang-runners/   # Per-language toolchain configs (detectCmd, displayName)
├── ui/
│   ├── panels/         # Webview HTML renderers + message handling (settings, preview)
│   ├── views/          # Activity-Bar WebviewView providers (sidebar)
│   └── styles.css      # Shared webview stylesheet
├── types/              # constants.ts + leetcode.types.ts — literals, config, and all interfaces
└── utils/              # Pure, dependency-free helpers (nonce, canonical-json, html escaping)
test/                   # One `*.test.ts` per source concern; fixtures inline, no test/fixtures/ dir
```

**Where new code goes:** domain logic → `services/` (a new `*.service.ts` for a
stateful concern, a `*.helpers.ts` sibling for its pure functions); types →
`types/`; webview rendering/handling → `ui/panels` or `ui/views`; anything pure
and cross-cutting → `utils/`. Command/panel/view files stay thin — they wire
VS Code to services, they do not hold logic. See the complexity limits below.

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
| webview → ext | `runTests` | `{ language }` — public suite only, live buffer only |
| webview → ext | `submit` | `{ language }` — public **+** final suite |
| webview → ext | `selectLanguage` | `{ language }` |
| webview → ext | `back` | none — no-confirmation discard (see "Challenge session"), returns to the empty state |
| webview → ext | `close` | none — modal-confirmed discard while running, returns to the empty state |
| ext → webview | `testResults` | `{ html }` — rendered results table |
| ext → webview | `challengeState` | `{ active: boolean, editorOpen?: boolean }` — gates the Run Tests button; `editorOpen` reflects the attempt tab's live open/closed state |
| ext → webview | `tick` | `{ unlimited: boolean, ms: number }` — once a second while `running` (P7); writes `#challengeTimer` and toggles `#challengeNoLimit` |

`renderNavHeader(phase)` ([leetcodePreview.controls.ts](src/ui/panels/leetcodePreview.controls.ts))
renders the back-arrow (`#backBtn`, not running) / close-✕ (`#closeBtn`,
running) control that posts `back` / `close` — pure and unit-tested, but not
yet wired into `renderLeetCodePreviewHtml`'s body: that integration lands with
the button-state work, which switches the panel's rendering onto
`ChallengeState['phase']` wholesale. The extension-side handling (`back` /
`close` routing, `discardChallenge()`) is live today; only the HTML that emits
those messages is still pending.

A locked artifact (`practice.locked: true`) causes the extension to ignore the
`options` / `timeLimitMinutes` fields and use its own frontmatter.

`renderLeetCodePreviewHtml(parsed, cssUri, cspSource, resultsHtml)` takes an
optional fourth argument that seeds `<div id="results">`. Reassigning
`webview.html` restarts the webview, so a `postMessage` fired immediately after
can land before the listener attaches and be dropped — the terminal Submit
re-render therefore seeds its table into the document instead of posting it.

### No runtime dependencies

Only the VS Code API and Node built-ins (`node:child_process`,
`node:fs/promises`, `node:os`, `node:path`) are used. `highlight.js` from the
core repo is **not** a dependency — the LeetCode preview panel does not
syntax-highlight solution code.

---

## LeetCode Vault File Format

> **Authoritative on-disk spec: [ARTIFACT_LEETCODE_FILE_FORMAT.md](ARTIFACT_LEETCODE_FILE_FORMAT.md).**
> That file is the single source of truth for the file structure — every
> frontmatter field, section heading regex, fence info-string, and the
> `<!-- meta: … -->` / `<!-- attempt: … -->` comment shapes — grounded in the
> parser (`leetcode-parser.service.ts` + `leetcode-sections.helpers.ts`). The
> summary below stays for orientation; when the two disagree, the spec file (and
> the parser) win. **Any change to the `.md` format must update
> `ARTIFACT_LEETCODE_FILE_FORMAT.md` in the same change** — keep it in sync with
> the parser, always.

A `type: leetcode` artifact carries problem metadata, a Markdown description,
`## Examples`, `## Tests`, a `# Setup` tree, and a `# Solutions` tree:

```md
---
type: leetcode
title: Two Sum
difficulty: easy
function: twoSum        # default / fallback
functions:              # optional per-language override
  python: two_sum
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
test:
  type: function
  timeoutMs: 5000
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

## Final Tests
```json
[
  { "input": { "nums": [1,5,3], "target": 8 }, "expected": [1,2] }
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
| `function` | string | yes | — | Function name to implement — default and fallback |
| `functions` | `Record<string,string>` | no | — | Per-language override of `function` (e.g. `{ python: ab_check }`); keys resolve through the same language-alias table as setup/solution headings. Read via `functionNameFor(parsed, langId)`, never `parsed.functionName` directly, for any code that targets a specific language |
| `algorithm` | string | no | — | Category tag (e.g. `hash-map`) |
| `status` | `LeetCodeStatus` | no | `'unsolved'` | Auto-updated on successful Submit |
| `params` | `{ name, type }[]` | yes | — | Generic types (see mapping below) |
| `returns` | string | yes | — | Generic return type |
| `practice` | `PracticeConfig` | no | see below | Pre-selected practice-mode restrictions |
| `test` | `TestConfig` | no | see below | Execution strategy + per-case timeout |
| `tags` | string[] | no | `[]` | Organisational tags |

### `test:` block

| Sub-key | Type | Default | Notes |
|---|---|---|---|
| `type` | `TestTypeId` | `function` | Unknown values fall back to `function` |
| `timeoutMs` | number | `5000` | Per case. Clamped to `[100, 60000]`; suite budget is `cases × this`, capped at 60 s |

| `TestTypeId` | Status | Semantics |
|---|---|---|
| `function` | **implemented** | Call a free function with positional args, compare the return |
| `class` | reserved | Instantiate, invoke a method sequence, compare the returns (LRUCache, MinStack) |
| `stdin-stdout` | reserved | Feed raw stdin, compare trimmed stdout |
| `in-place` | reserved | Compare a mutated argument rather than the return (removeDuplicates) |

A reserved id parses and validates, but no environment is registered for it, so
`languagesForType()` returns `[]`, the language selector renders empty, and the
panel says why. That is the intended self-explaining failure — not a crash
inside a compiler.

### `practice:` block

| Sub-key | Type | Default | Notes |
|---|---|---|---|
| `timeLimit` | number (minutes) | `0` | `0`/empty ⇒ unlimited: the clock counts **up** from the start and shows a "no limit" label, never auto-submits. `>0` ⇒ bounded: the clock counts **down** and auto-submits at zero. Negative / unparsable → `0` |
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
- **Tests** — `` ```json `` fence under `## Tests`. Array of `{ input: Record<string, unknown>, expected: unknown }`. Input keys must match `params` names. This is the **public** suite: visible in the panel, run by **Run Tests**.
- **Final Tests** — same shape, under `## Final Tests`. The **hidden grading** suite, appended by **Submit**. Counts are shown (`2 public · 3 final`) but inputs and expected values are never rendered — result rows for final cases mask their input. An artifact with no such section falls back to grading the public list (resolved in `submitSuite`, never in the parser, so the list is never doubled).
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

**At run time** the candidate goes through
`buildExecutable(parsed, langId, code)`
([leetcode-candidate.helpers.ts](src/services/leetcode-candidate.helpers.ts)),
which normalises it to a bare declaration of `functionName` — the env supplies
arguments as literals and emits its own driver, so a candidate must **never**
be a program that reads stdin. A bare body is wrapped in a minimal declaration,
deliberately *not* in `generateBoilerplate()`, whose Layer-1 template reads
stdin and would block forever inside an env driver.

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

### Test environments — the capability matrix

How a test *executes* is data, not an `if/else`. A **test environment** is a
`(test type × language)` pair that validates a candidate, emits a runnable
program, and parses its output back into per-case outcomes.
`testEnvFor(type, langId)` returns `TestEnv | undefined`; the absence of a pair
**is** the capability matrix. `languagesForType(type)` drives the panel's
language selector directly, so there is no second table to keep in sync.

The three built-in `function` envs are self-contained — the extension ships zero
runtime dependencies and has no install path, so it cannot assume a JUnit jar
exists. `TestEnv.requires` / `detect()` exist so a library-backed env can be
added later without touching the runner.

**The candidate is never spliced.** `env.emit(ctx)` returns an `EmittedProgram`
= `{ files, compile?, run }`. The solver's code is written **verbatim** as one
of those files, and a generated *driver* file links to it — so the solver's own
imports, helpers, and structure survive intact and cannot collide with the
driver's class or `main`:

| Language | Candidate file | Driver links via |
|---|---|---|
| java | `Solution.java` (method wrapped in `class Solution`) | second compilation unit; `javac Solution.java Runner.java`, `java Runner` |
| python | `sol.py` | `importlib` — `import sol; sol.<fn>(…)`; an `if __name__=='__main__'` guard keeps the solver's own main dormant |
| javascript | `sol.js` | Node's `vm` — evaluate in a fresh context, pull `<fn>` from the sandbox |

This replaced the original model, which spliced the candidate into a generated
`class Main` at a `<<SOLUTION>>` marker. That collided the moment a solver wrote
anything but a bare method — their own `import`, `class Main`, or `main()` each
produced a raw `javac` error. Commands run with the temp dir as `cwd`, so they
name files bare.

**`env.validate(ctx)`** runs before any file is written and returns a plain,
user-facing message (or `null`). It catches the contract violations the linked
model still cannot accept — a Java method wrapped in the solver's own `class`, a
Python `def` nested inside a class, a JS buffer that never names the function —
so the panel shows *"Java setup must be a bare method, not a class"* instead of
a compiler dump.

**The batch protocol.** The generated driver runs the whole suite in one process
and prints one sentinel-prefixed line per case:

```
__LEET__{"index":0,"actual":"[0,1]","ms":3}
__LEET__{"index":1,"error":"IndexError: list index out of range","ms":1}
```

The `__LEET__` prefix means the solver's own `print` / `console.log` cannot
corrupt parsing. Each case is wrapped in the target language's try/catch, so one
throw fails one case rather than the suite. Python and Java flush after every
line — both block-buffer a pipe, and a timeout-kill would otherwise discard the
lines already produced.

**Comparison** goes through `canonicalJson()` (sorted keys, no whitespace) on
both sides. This replaced `stdout.trim() === JSON.stringify(expected)`, under
which Java's `Arrays.toString` (`[0, 1]`) could never match `[0,1]` and object
key order was a coin flip.

### Test runner

- `runSuite(code, tests, parsed, env)` — `env.validate` gate, one `mkdtemp`, `env.emit()`, write every `EmittedProgram.file`, run `program.compile` then `program.run` (both `cwd` = temp dir), then `env.parse(stdout)`. A compiled language pays `javac` **once per suite**, not once per case. The runner orchestrates only — it never learns Java from Python; the env owns the commands.
- A **contract violation** (`env.validate` non-null) fills every case with the message and runs nothing.
- **Timeout attribution.** The suite gets one budget (`cases × test.timeoutMs`, capped at 60 s). On a kill, `exec` still hands back the stdout already produced, so every case that printed keeps its real result and every case from the first missing index onward is marked `timeout`. This is why the sentinel matters — partial stdout must stay parseable.
- A **compile error** fills every case with the same `compilation error: …`.
- `detectRuntime(runner)` (in the handlers, before `runSuite`) shells out `runner.detectCmd`; `env.detect()` gates in addition when present.
- **Run Tests** executes the **public** suite against the live buffer. It never writes frontmatter, never stops the clock, never lifts the restrictions. Without a live challenge the button is `disabled` and the handler guards anyway.
- **Submit** executes **public + final** against the live buffer, falling back to the artifact's stored solution when no challenge is running. All green → `status: 'solved'` + `<!-- meta: … -->`. Any failure **during a live challenge** → `status: 'attempted'`. A failure with no live challenge writes nothing — a dry run against a stored solution must never downgrade a solved artifact.
- Submit is **one shot**: pass or fail, the challenge ends and the restrictions lift. *Solve It* opens a **new** temp file and re-arms the challenge; `attempted → solved` is allowed. The finished run's file is left on disk (see "Challenge session") until the sidebar view's Back control discards it.
- Runners exist for `java`, `javascript`, `python` only, and the selector is intersected with `languagesForType(test.type)` — a language with a `# Setup` block but no env is never offered.

### Challenge session

`startChallenge()` ([leetcode-challenge.service.ts](src/services/leetcode-challenge.service.ts))
owns the single in-flight run: the temp file, the `PracticeMode` snapshot, the
`LeetCodeTimer`, and the status-bar clock. Only one session may be active
per window — starting a second ends the first, so a settings snapshot is never
stranded. The session also carries a `state: ChallengeState`
([leetcode.types.ts](src/types/leetcode.types.ts)) — exercise URI, temp-file
URI, practice options, timing, and `phase` — read via the `challengeState()`
accessor by the sidebar view and (eventually) the button-state and timer
features.

**No reopen-to-retry.** Every *Solve It* writes a **new**, uniquely-named temp
file under `globalStorageUri/attempts/` (`exerciseFileName` mints a fresh run
suffix each call — see [exercise-file.helpers.ts](src/services/exercise-file.helpers.ts)) —
there is nothing to overwrite, and a second *Solve It* is always a fresh
attempt, never a resumed buffer. A run that ends without being explicitly
discarded (solved, attempted, or the window closed mid-run) leaves its temp
file on disk; only `discardChallenge()`
([leetcode-run.handlers.ts](src/commands/leetcode-run.handlers.ts)) deletes
one, via the sidebar view's Back (idle, no confirmation) or Close (running,
modal confirmation) control. Back also sweeps up a stale attempt left by an
already-finished run — the view tracks the last attempt's URI independently of
the live session so there is something to sweep once the session itself has
ended. Abandoned files are an accepted, intentional trade-off: a future
"resume unfinished runs" feature owns listing and cleanup
([resume-runs.md](docs/plans/resume-runs.md)).

### Timer

`LeetCodeTimer` starts when the challenge starts and stops on a successful
Submit. Elapsed time is formatted as `XmYs` and recorded in the solution
metadata comment, independent of everything below — that stopwatch always
runs regardless of `practice.timeLimit`.

The **status-bar clock and in-view header timer always run** (P7) — every
challenge gets one, not just runs with a time limit set. One pure function,
`timerTick(startedAt, deadline, now): TimerTick`
([leetcode-challenge.helpers.ts](src/services/leetcode-challenge.helpers.ts)),
decides both modes from a single `deadline: number | null`:

- **Bounded** (`practice.timeLimit > 0`): `deadline = startedAt + minutes *
  60_000`. The clock counts **down** (`{ unlimited: false, ms: remaining }`,
  clamped to `0`), the status bar reads `$(watch) MM:SS`, and reaching zero
  auto-submits via the same `handleSubmit` path a manual click uses (guarded
  by the re-entrancy peek below).
- **Unlimited** (`practice.timeLimit` `0`/empty): `deadline = null`. The
  clock counts **up** from `startedAt` (`{ unlimited: true, ms: elapsed }`),
  the status bar reads `$(watch) MM:SS · no limit`, and it **never**
  auto-submits — `expire()` is only ever called when `!unlimited && ms <= 0`.

Both modes render through the same `formatRemaining()` `MM:SS` formatter —
the only difference is what `ms` measures and the unlimited "no limit" label.
The tick fans out from `leetcode-challenge.service.ts`'s `startTimer()`
(renamed from `startCountdown` — it now runs unconditionally in
`startChallenge`, never gated on a positive time limit) through
`ChallengeCallbacks.onTick(tick: TimerTick)` to the sidebar view provider's
`timerSeed()` (initial-render seed, reusing the same `timerTick()`) and
`postTick()` (`{ command: 'tick', unlimited, ms }` posted to the live
webview — never a `webview.html` reassignment, which would restart the
webview and kill the timer mid-run). The webview writes `formatRemainingLabel(msg.ms)`
into `#challengeTimer` and shows/hides the `#challengeNoLimit` "no limit"
span from `msg.unlimited`. Expiry warns but never closes the editor or lifts
the restrictions — abandoning a bounded run is still the user's call.

### Preview panel

[ui/panels/leetcodePreview.panel.ts](src/ui/panels/leetcodePreview.panel.ts)
renders the LeetCode view: description, difficulty badge (green/orange/red),
status badge, algorithm tag, examples as cards, language selector (union of
setup + solution languages), `# Setup` starter blocks, reference solutions
collapsed behind a `<details>` (they are spoilers), the practice-option
checkboxes + time-limit input, Solve It / Submit buttons, and a results table
with pass/fail, actual vs expected, per-test duration, and summary.

Row rendering for the selector, counts line, setups, practice controls, and
action buttons lives in the sibling
[leetcodePreview.controls.ts](src/ui/panels/leetcodePreview.controls.ts). The
webview script hides every setup/solution block whose `data-language` does not
match the selected language — `data-language` carries the *canonical* id, so an
aliased heading (`## JS`) still matches the selector's `javascript`.

Three buttons: **Run Tests** (starts `disabled`, re-gated by `challengeState`),
**Solve It**, **Submit**. Result rows for `kind: 'final'` cases render
`Final #N` with their input replaced by `<span class="masked">hidden</span>` —
pass/fail and duration always show, so a solver learns *that* they failed a
hidden case without learning what it was.

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

### ⚠️ Development methodology (READ FIRST)

Implementation follows **TDD, CUPID, and DDD**. In order:

- **TDD — test first, where it makes sense.** For any pure, `vscode`-free unit
  (parsers, codegen, the env `emit`/`validate`, suite selection, helpers), write
  the failing test **before** the code, then make it pass, then refactor. The
  existing `test/*.test.ts` suite is the pattern: `node:assert`, Mocha **TDD**
  (`suite`/`test`), fixtures inline. Code that must import `vscode` (webviews,
  views, commands, timers) is verified by the **F5 manual pass** instead — do
  not contort it to be unit-testable; push the logic down into a pure helper
  that *is* tested, and keep the `vscode` layer a thin wire.
- **CUPID — properties, not rules.** Prefer code that is **C**omposable (small
  surface, few deps), **U**nix-philosophy (does one thing), **P**redictable (no
  hidden state or surprises), **I**diomatic (reads like the surrounding code),
  and **D**omain-based (names come from the LeetCode domain, not the framework).
  When a choice is ambiguous, pick the option that improves one of these without
  hurting another.
- **DDD — model the domain.** The domain vocabulary — exercise, challenge,
  attempt, suite (public/final), test environment, practice mode — lives in
  `src/types/` and drives the names in `services/`. Keep the domain model free
  of VS Code types; the `vscode` API is an adapter at the edges (commands,
  panels, views), never in the core services. New concepts get a named type
  before they get behaviour.

These three reinforce each other: DDD names the units, CUPID shapes them,
TDD proves them. The file-organisation rules below are how they land on disk.

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
