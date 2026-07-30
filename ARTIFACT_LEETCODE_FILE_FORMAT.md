# LeetCode Exercise `.md` File Format — Authoritative Spec

This file is the **single source of truth** for the on-disk structure of a
`type: leetcode` vault `.md` file — what an author writes and what the extension
reads back. The parser (`src/services/leetcode-parser.service.ts` +
`src/services/leetcode-sections.helpers.ts`) implements this format; any writer
(the author by hand, or the extension's status / attempt writers) must produce
exactly this shape so `parse(write(x))` round-trips.

> When authoring an exercise, writing a test fixture, or changing a writer, this
> file — not memory — defines the contract. If the parser and this doc disagree,
> that is a bug in one of them; reconcile, do not guess.

> ⚠️ **Keep this file in sync with the format.** Any change to the on-disk `.md`
> format — a new or renamed frontmatter field, a changed section heading, a new
> fence info-string, or a new `<!-- … -->` comment shape — **must** be reflected
> here in the *same* change, alongside the parser edit. This document is the
> contract; letting it drift from the parser defeats its entire purpose.

> Examples below use `~~~` as the **outer** fence purely so the inner ` ``` `
> code fences render literally. In a real `.md` file every fence is a standard
> triple-backtick.

---

## 1. Canonical file structure

~~~md
---
type: leetcode
title: Two Sum
difficulty: easy
function: twoSum
algorithm: hash-map
status: unsolved
params:
  - name: nums
    type: int[]
  - name: target
    type: int
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
  { "input": { "nums": [2,7,11,15], "target": 9 }, "expected": [0,1] }
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
function twoSum(nums, target) {
  // solution here
}
```

# Solutions

## Java
### Hash Map
```java
public static int[] twoSum(int[] nums, int target) { /* … */ }
```
~~~

**Order of the top-level blocks is fixed by convention** (frontmatter →
description → `## Examples` → `## Tests` → `## Final Tests` → `# Setup` →
`# Solutions` → `# Attempts`), but the parser locates each by its heading
regex, not its position — a section may be absent, and the extension appends
`# Attempts` after `# Solutions`.

---

## 2. Frontmatter

YAML between the leading `---` fences. It **must** open the file:
`FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/`. Keys are matched by
`KV_RE = /^(\w+):\s*(.*)$/` — a key is `\w+` (letters/digits/underscore, **no
hyphens**). Unknown keys are silently ignored. Invalid `difficulty` / `status`
values are dropped, leaving the default.

### 2.1 Field table

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `type` | `'leetcode'` | yes | — | Discriminator. |
| `title` | string | yes | `''` | Single line. |
| `difficulty` | `easy`\|`medium`\|`hard` | no | `easy` | Any other value → `easy`. |
| `function` | string | yes¹ | `''` | Default/fallback function name to implement. Parsed onto `functionName`. ¹Required for `test.type: function`; a `project`/`service` artifact names its targets in `checks:` instead (§9). |
| `functions` | map `<lang>: <name>` | no | — | Per-language override of `function`. Keys resolve through the language-alias table (`py:` → `python`). Read via `functionNameFor(parsed, langId)`, never `functionName` directly, for language-specific code. |
| `algorithm` | string | no | — | Category tag (e.g. `hash-map`). |
| `status` | `unsolved`\|`attempted`\|`solved` | no | `unsolved` | **Extension-owned** — auto-written by Submit. Any other value → `unsolved`. |
| `params` | `{ name, type }[]` | yes | `[]` | Generic types (see §5). Input keys in `## Tests` must match these `name`s. |
| `returns` | string | yes | `''` | Generic return type. |
| `practice` | block | no | see §2.3 | Pre-selected practice restrictions + time limit. |
| `test` | block | no | see §2.2 | Execution strategy + per-case timeout. |
| `tags` | string[] | no | `[]` | Inline `[a, b]` or a YAML `- a` list. |

### 2.2 `test:` block

Indented sub-keys, both optional:

| Sub-key | Type | Default | Rule |
|---|---|---|---|
| `type` | `TestTypeId` | `function` | Unknown value → `function` (a typo must not make the exercise unrunnable). |
| `timeoutMs` | number | `5000` | Per case. Clamped to `[100, 60000]`. Suite budget = `cases × timeoutMs`, capped at 60 s. |

`TestTypeId` ∈ `function` (**implemented**) · `project` (**implemented**, parsed and
registered for `javascript` + `typescript`, not yet runnable — see §9) · `class` ·
`stdin-stdout` · `in-place` · `service` (reserved — they parse and validate, but no
environment is registered, so the language selector renders empty and the panel says why).
`project` and `service` are the multi-file / running-server types.

### 2.3 `practice:` block

Indented sub-keys, all optional:

| Sub-key | Type | Default | Rule |
|---|---|---|---|
| `timeLimit` | number (minutes) | `0` | `0`/empty ⇒ **unlimited**: the in-view clock counts **up** (elapsed) with a "no limit" label and never auto-submits. `> 0` ⇒ **bounded**: the clock counts **down** and auto-submits at zero. Negative / unparsable → `0`. |
| `locked` | boolean | `false` | Exactly the string `true` locks it. Locked ⇒ the panel disables the controls and the extension ignores the option list / time limit the webview posts, using the frontmatter instead. |
| `options` | `PracticeOptionId[]` | `[noCompletion, noAiAgents]` | Inline `[a, b]` **or** a YAML `- a` list. Unknown ids are dropped. `options: []` ⇒ **no** restrictions. Absent `options:` ⇒ the defaults. |

`PracticeOptionId` ∈ `noCompletion` · `noAiAgents` · `noSnippets` ·
`noParameterHints`.

### 2.4 `params:` block

Two accepted forms:

~~~md
params: []
~~~

~~~md
params:
  - name: nums
    type: int[]
  - name: target
    type: int
~~~

Only the multi-line `- name:` / `type:` form parses — each field on its own
indented line. The parser reads `key: value` lines only
([`assignParamField`](src/services/leetcode-parser.helpers.ts) → `KV_RE`), so a
YAML **inline flow-map** (`- { name: nums, type: int[] }`) does **not** parse:
the line starts with `{`, matches no `key:` pair, and the entry is silently
dropped. A `ParamDef` is kept only when **both** `name` and `type` are set. Any
non-empty value directly after `params:` (other than `[]`) yields an empty list
— the entries must be on the following indented lines.

---

## 3. Body sections

Everything after the closing `---`. Section headings are anchored, so they must
match exactly (trailing whitespace allowed):

| Section | Heading regex | Level | Slice ends at |
|---|---|---|---|
| Description | *(none — prose before the first `#`/`##`)* | — | first `^#+ ` heading |
| Examples | `^## Examples\s*$` | `##` | next `#`/`##` |
| Tests | `^## Tests\s*$` | `##` | next `#`/`##` |
| Final Tests | `^## Final Tests\s*$` | `##` | next `#`/`##` |
| Setup | `^# Setup\s*$` | `#` | next `#` only |
| Solutions | `^# Solutions\s*$` | `#` | next `#` only |
| Attempts | `^# Attempts\s*$` | `#` | next `#` only |

`#`-level sections (Setup / Solutions / Attempts) are **not** terminated by
`##` sub-headings — those are the language headings inside them.

### 3.1 Description

The trimmed prose between the closing frontmatter `---` and the first Markdown
heading (`#` or `##`). The whole body (trimmed) when there is no heading.

### 3.2 `## Examples`

Zero or more ` ```example ` fenced blocks, each with an `input:` line and an
`output:` line. **Both are required** for the example to be kept; the values are
free-form display strings (not parsed as data).

~~~md
## Examples
```example
input: nums = [2,7,11,15], target = 9
output: [0,1]
```
~~~

### 3.3 `## Tests` and `## Final Tests`

Each holds **one** ` ```json ` fence: an array of
`{ "input": Record<string, unknown>, "expected": unknown }`. The `input` keys
must match the `params` names. Malformed JSON, a missing fence, or a missing
section all yield `[]` — the parser never throws.

- `## Tests` — the **public** suite: shown in the panel, run by **Run Tests**.
- `## Final Tests` — the **hidden** grading suite, appended by **Submit**. Counts
  are shown (`2 public · 1 final`) but inputs/expected are never rendered. An
  exercise with no `## Final Tests` falls back to grading the public list at
  Submit time (resolved in `submitSuite`, never doubled in the parser).

### 3.4 `# Setup`

`## <Language>` headings, each with a fenced code block. Only the **first** fence
per language is taken — a setup is a single starter stub (the function
definition the solver begins from), never a labelled list. A language with no
setup falls back to generated boilerplate at Solve It.

### 3.5 `# Solutions`

`## <Language>` → optional `### <Label>` → fenced block. Multiple solutions per
language are allowed. Direct (unlabeled) fences under a `##` heading are kept
separately; when there are 2+, they auto-number `Solution #1`, `#2`, … — a lone
unlabeled fence keeps no label. Reference solutions are spoilers (collapsed
behind a `<details>` in the panel).

### 3.6 `# Attempts` *(extension-written)*

The attempt trail. `## <Language>` → each fenced block is preceded by a
**mandatory** `<!-- attempt: { … } -->` comment (see §4). `appendAttempt`
prepends, so entries are newest-first per language. A fence whose comment is
absent, malformed, or missing a required field is skipped (no partial entry).

> Authors normally do not write `# Attempts` by hand — the extension creates and
> maintains it on Submit. It is documented here because it is part of the
> on-disk format the parser reads back.

### 3.7 Fence info-strings

- ` ```example ` — examples.
- ` ```json ` — test suites.
- Setup / Solution / Attempt fences require a **language** info-string
  (`FENCE_LANG_RE = /```\w+\r?\n/`) — e.g. ` ```java `, ` ```python `,
  ` ```javascript `. A **bare** ` ``` ` fence is not matched and the block is
  skipped. Trailing whitespace inside a fence is trimmed on parse.

---

## 4. HTML-comment payloads

Both are a single-line JSON object inside an HTML comment, placed **immediately
before** the code fence they annotate. Parsed by `parseHtmlCommentJson`; never
throws (malformed ⇒ ignored).

**Solution meta** — optional, on a `# Solutions` fence:

~~~md
<!-- meta: { "solved_at": "2026-07-15T14:32:00Z", "duration": "8m22s" } -->
```java
public static int[] twoSum(int[] nums, int target) { /* … */ }
```
~~~

- `solved_at` — ISO-8601 string (optional).
- `duration` — `XmYs` string (optional).

**Attempt** — mandatory, on every `# Attempts` fence:

~~~md
<!-- attempt: { "at": "2026-07-15T14:32:00Z", "duration": "8m22s", "passed": true, "bigO": "O(n)", "confidence": "medium" } -->
```java
public static int[] twoSum(int[] nums, int target) { /* … */ }
```
~~~

| Key | Type | Required | Notes |
|---|---|---|---|
| `at` | string (ISO-8601) | **yes** | Missing/wrong-type ⇒ the whole entry is dropped. |
| `duration` | string (`XmYs`) | **yes** | Same. |
| `passed` | boolean | **yes** | Same. |
| `bigO` | string | no | Static Big-O estimate (e.g. `O(n^2)`). |
| `confidence` | string | no | `high` / `medium` / `low`. |

---

## 5. Generic → language type mapping

`params[].type` and `returns` use language-neutral generics; `mapType(generic,
language)` translates them. Unknown generics pass through unchanged; unknown
languages return the generic as-is. Java boxes primitives inside generics
(`int` → `Integer`).

| Generic | Java | Python | JavaScript | Rust | TypeScript |
|---|---|---|---|---|---|
| `int` | `int` | `int` | `number` | `i32` | `number` |
| `float` | `double` | `float` | `number` | `f64` | `number` |
| `string` | `String` | `str` | `string` | `String` | `string` |
| `bool` | `boolean` | `bool` | `boolean` | `bool` | `boolean` |
| `int[]` | `int[]` | `List[int]` | `number[]` | `Vec<i32>` | `number[]` |
| `int[][]` | `int[][]` | `List[List[int]]` | `number[][]` | `Vec<Vec<i32>>` | `number[][]` |
| `map<string,int>` | `Map<String, Integer>` | `Dict[str, int]` | `Record<string, number>` | `HashMap<String, i32>` | `Record<string, number>` |

TypeScript's container syntax (`array`/`map`) is identical to JavaScript's — both are the
same structural type system at the declaration level the codegen writes to.

---

## 6. Test environments — capability matrix

How a test executes is data, not a branch. A **test environment** is a
`(test.type × language)` pair. `testEnvFor(type, langId)` returns the pair or
`undefined`; the absence of a pair **is** the capability matrix, and
`languagesForType(type)` drives the panel's language selector.

| `test.type` | Languages with an environment |
|---|---|
| `function` | `java`, `javascript`, `python`, `rust`, `typescript` |
| `class`, `stdin-stdout`, `in-place`, `project`, `service` | *(none — reserved; selector renders empty)* |

The five `function` environments are self-contained (the extension ships zero
runtime dependencies). The solver's code is written verbatim as its own file and
a generated driver links to it — the candidate is **never** spliced into a
wrapper, and must be a bare declaration of the function, never a program that
reads stdin.

**Candidate contract — pure per call.** A suite runs as **one process (one
module/`vm` context) per suite**, not one per case: the driver loads the
candidate once and calls it for every case in order, emitting one `__LEET__`
sentinel line each. So module-level and global state **persists across the cases
of a suite** — a memo table, a counter, a mutated module array survives into the
next case, and the same candidate graded case-by-case would behave differently.
A candidate must therefore be **pure per call**: its answer for a case may depend
only on that case's arguments, never on state left behind by an earlier one.
Authors must not write an exercise whose expected values require cross-case
state, and must not rely on per-case isolation to reset a global. (This is
by design — one process per suite is what makes a compiled language pay `javac`
once instead of once per case.)

**Per-language ceilings.** Rust serialises results through a local `LeetJson`
trait (compact, key-sorted JSON) rather than serde or `{:?}` Debug — neither
reliably matches `canonicalJson`'s formatting — so structs and enums are not
yet supported as param/return types. TypeScript never invokes `tsc`: the default path
strips types in-process with Node's own `stripTypeScriptTypes` and runs the
result in a `vm` sandbox, gated on `detect()` finding Node ≥ 22.18 (22.x line)
or ≥ 23.10 (23.x line) — older Node drops TypeScript out of the language
selector rather than failing mid-run.

---

## 7. Language headings and aliases

`## <Language>` heading text is stored lower-cased as authored, then resolved to
a canonical `languageId` downstream via `resolveLangId` (the same table the
`functions:` keys use). So an aliased heading (`## JS`, `## py`) groups under its
canonical id (`javascript`, `python`) and matches the language selector. Use the
canonical name when in doubt: `JavaScript`, `Python`, `Java`.

---

## 8. What the author writes vs. what the extension writes

| Part | Written by |
|---|---|
| Frontmatter (except `status`), description, `## Examples`, `## Tests`, `## Final Tests`, `# Setup`, `# Solutions` | **Author** |
| `status:` frontmatter field | **Extension** — `solved` on an all-green Submit, `attempted` on a failing live Submit. A dry run against a stored solution never writes it. |
| `<!-- meta: … -->` on a solved solution | **Extension** — on a successful Submit. |
| `# Attempts` section + `<!-- attempt: … -->` entries | **Extension** — every live Submit (pass or fail), newest-first, in a single read-patch-write alongside the `status` update. |

`status` + the solved `meta` + the attempt entry are applied in **one**
read-patch-write per Submit, so a manual edit made between a run's start and its
Submit is preserved everywhere except those three writer-owned spots.

---

## 9. `project` and `service` — multi-file exercises

> **Status, precisely.** `project` is **parsed** — `## Files`, `libs:`, `checks:` and the
> `check=<name>` case binding all land on the parsed artifact, and `project` is
> `implemented` in `TEST_TYPES`, registered for `javascript` + `typescript`, and **runnable**:
> the render driver and all three check kinds (`dom-assert`, `css-assert`, `build`) ship, and a
> `project` artifact grades end to end. `service` remains reserved — its fields below parse (it
> shares the `project` grammar) and nothing executes them, because no `service` environment is
> registered.
> Reference artifacts live in the **Obsidian vault**, not in this repo — see CLAUDE.md,
> *Artifacts live in the vault*.

- **`project`** — the exercise is a file *tree*, opened as several editor tabs and graded
  by declared **checks** rather than one return value.
- **`service`** — a `project` whose checks run against servers the extension boots on
  ports it assigns.

### 9.1 `## Files`

One fenced block per file, the info-string carrying the language then attributes:

````markdown
```typescript path=src/lib/catalogue.ts role=editable
export function filterInStock() { /* … */ }
```
````

| Attribute | Values | Meaning |
|---|---|---|
| `path` | POSIX-relative | Location inside the run directory. Never absolute, never `..`, and never rooted at `node_modules/` — that name is **reserved**: the run directory's `node_modules` is a symlink into a package cache shared by every exercise, and a declared write through it would leak into all of them. |
| `role` | `editable` | Written and opened — the solver's work. **The default** when `role=` is absent. |
| | `readonly` | Written and opened with a **read-only file mode**, not to be edited. VS Code has no per-editor config scope, so file mode is the mechanism. |
| | `hidden` | Written, never opened — scaffolding the solver should not see. |

A fence with **no** `path=` is prose, not a file, and is skipped. An unrecognised `role=`
degrades to `editable` **with a warning** — a silent drop reads exactly like an artifact
that never declared the role. The language is the info-string's first token, resolved
through the usual alias table (`tsx` → `typescriptreact`, `css` → `css`).

Paths are reported by the parser exactly as written and are normalised and
containment-asserted by the **writer**, immediately before it writes — one authority, at
the point of use, rather than a check the parser could be bypassed around. That same
authority (`resolveContained`) refuses **any** path whose first normalised segment is
`node_modules`, not a raw-string check — `src/../../node_modules/x` is caught too — and it
is the one rule shared by the `## Files` writer, a `build` check's `dir:`, and a `function`
check's `file:`, so the reservation holds no matter which door a path arrives through.

A file **no check references is ungraded scaffolding, explicitly** (the CSS tab exists
for the solver, not the grader).

### 9.1b `# Solutions` overlays — how a project ships unsolved *and* verifies

`## Files` holds the **starter** a solver begins from, so grading the tree as authored would
fail every well-formed exercise by design. A `project` therefore puts its reference
implementations in `# Solutions`, as fences carrying the **same `path=`** as the starter they
replace:

````markdown
# Solutions

```javascript path=src/App.jsx
export default function App() { /* the working component */ }
```
````

- The verification harness (`verify-exercise.mjs`) grades the tree **with** the overlays
  applied — so a green result means the reference works.
- A solver's run uses `## Files` as authored; overlays are reference material, exactly as
  `# Solutions` already sits behind a spoiler in the panel for a `function` exercise.
- An overlay naming a path `## Files` does not declare is appended rather than dropped.
- A `# Solutions` fence **without** `path=` is an ordinary function-type reference solution
  and never touches a project's tree, so both grammars coexist in one section.

**A starter that passes is a bug in the exercise**, not a convenience: check it by grading the
tree without overlays and confirming it goes red.

### 9.2 `checks:` — how a project is graded

```yaml
test:
  type: project
  checks:
    - name: catalogue filter     # unique; results group by it
      kind: function             # runs on the existing function environments
      file: src/lib/catalogue.ts
      function: filterInStock
    - name: app builds
      kind: build                # declared argv must exit 0
      dir: client                # optional, relative to the run directory
      argv: ["npx", "tsc", "--noEmit"]
```

| `kind` | Compares | Status |
|---|---|---|
| `function` | one file's export, through the five `function` environments | parsed |
| `build` | a declared argv **array** exits 0; optional `dir:` runs it in a contained subtree | parsed |
| `http` | in-host `fetch` against a booted service (`service: <name>`) | planned (`service` only) |
| `css-assert` | **declared** style: inline/`style` properties and class presence | parsed |
| `dom-assert` | DOM after mounting the component and firing events | parsed |

`css-assert` never asserts layout geometry — the render environment is jsdom, which
computes no layout, so a width-from-box-model assertion is refused rather than silently
passed.

**Zero or one `function` check per project.** `params:` / `returns:` are artifact-level
singletons, so a second function check would have nowhere to declare its own types; a
project may equally have **none** (graded entirely by `dom-assert` / `css-assert` /
`build`), in which case `params:` and `returns:` are optional and the function structural
floor — the 6-public / 3-final case counts — does not apply to it.

**Solved = every check green.**

#### Binding cases to a check

A ` ```json ` fence in `## Tests` / `## Final Tests` carries a `check=<name>` attribute, and
**every** fence in the section is read (not just the first):

````markdown
## Tests

```json check="catalogue filter"
[ { "input": { "minStock": 3 }, "expected": ["keyboard"] } ]
```

```json check=alternates
[ { "input": {}, "expected": "X" } ]
```
````

The public/final split is therefore **per check**: a check's cases are its `## Tests` fences
followed by its `## Final Tests` ones, and *Run Tests* grades only the public leading slice.

Quote a name containing spaces. A bare fence with no attribute binds to the **sole** check
when the artifact has exactly one — the common single-check project — and warns otherwise
rather than guessing. A fence naming a check that does not exist warns too. Public fences
bind before final ones, so a check's cases keep public-then-final order.

This widened fence applies to **every** artifact, `function` included: a second json fence
under `## Tests`, previously ignored in silence, is now appended to the suite, and one
malformed fence costs only its own cases.

### 9.3 `services:` (`test.type: service`)

```yaml
test:
  type: service
  runtime: local          # 'docker' reserved
services:
  - name: api
    dir: server
    install: ["pip", "install", "-r", "requirements.txt"]
    start:   ["uvicorn", "main:app", "--host", "127.0.0.1", "--port", "${PORT}"]
    ready:   "Uvicorn running"
    exposeAs:
      VITE_API_URL: "http://127.0.0.1:${PORT}"
  - name: web
    dir: client
    install: ["npm", "ci"]
    start:   ["npm", "run", "dev", "--", "--port", "${PORT}"]
    ready:   "ready in"
    envFile: .env.local     # written role:hidden — the solver never sees it
    dependsOn: [api]
```

- `install` / `start` are **argv arrays**, never command strings.
- `${PORT}` is the **only** substitution, templated into argv and injected as a `PORT`
  env var. The port is one the OS assigned (bind `:0`, read it back), never a guess.
- `exposeAs` maps *variable name → value template*; the author names what their framework
  wants (`VITE_*`, `NEXT_PUBLIC_*`) — **the extension encodes no framework knowledge**.
- `dependsOn` orders the boot; a cycle is a parse error.

**Trust class, stated plainly:** a `service` artifact executes declared commands and
package scripts from the `.md` — arbitrary code by design, the same trust class as running
the solver's own candidate locally. The argv rules and the library-name allowlist bound the
*shape* of what runs; they do not make artifact-authored code safe.

### 9.4 `libs:` — installed before checks run

```yaml
libs:
  python: [fastapi@^0.115.0, uvicorn@^0.32.0]
  typescript: [react@^19.0.0, vite@^7.0.0]
```

Both the block form above and an inline `python: [fastapi@^0.115.0, uvicorn@^0.32.0]` parse.
An entry the allowlist refuses is **dropped with a warning** before it can reach an install
subprocess; the rest of that language's list still installs.

Per-language dependency lists. Every entry must pass the npm-style allowlist already
shipped in `validateLibNames` ([lib-spec.helpers.ts](src/services/lib-spec.helpers.ts)) —
a bare scoped/unscoped package name with an optional `@version`, no `..` anywhere — before
it can reach an install subprocess. Java is out of scope (no transitive resolver in a stock
JDK).

**The installer is npm-only, so the language key decides whether a list installs at all.**
`installLibs` shells out to `npm install --prefix`, and there is no second installer, so only
the languages in `NPM_LANGUAGES` (`javascript`, `typescript`, `javascriptreact`,
`typescriptreact`) are served. A list under any other key is **kept on the parsed artifact,
warned about, and skipped** — `libs: { python: [requests@^2.0.0] }` warns
`libs: 'python' is not installable — the library installer is npm-only, so these are skipped`
rather than `npm install`ing the unrelated npm package that happens to share the name. The
name-shape allowlist cannot tell two registries' packages apart, so the language key is the
only thing that can.

**Trust class, stated plainly:** installing `libs:` runs the declared packages' own
`preinstall`/`install`/`postinstall` scripts — **arbitrary code**, the same trust class as
running a solver's candidate locally. The allowlist bounds the *shape of a name*; it says
nothing about what the package does once npm fetches it. `--ignore-scripts` is deliberately
**not** passed: the harness's own toolchain needs it (esbuild's postinstall fetches its
platform binary). Treat an artifact's `libs:` the way you would treat its `build` argv — as
code you are choosing to run.
