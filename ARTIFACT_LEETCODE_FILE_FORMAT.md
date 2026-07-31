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

**Frontmatter is summary only. Execution configuration lives in the body**, in
` ```yaml leetcode ` fences placed next to what they configure (§2.5).

~~~md
---
type: leetcode
title: Two Sum
difficulty: easy
algorithm: hash-map
status: unsolved
tags: [leetcode, arrays, hash-map]
---

Problem description as Markdown prose.

```yaml leetcode
function: twoSum
params:
  - name: nums
    type: int[]
  - name: target
    type: int
returns: int[]
```

## Examples
```example
input: nums = [2,7,11,15], target = 9
output: [0,1]
```

```yaml leetcode
test:
  type: function
  timeoutMs: 5000
practice:
  timeLimit: 30
  locked: false
  options: [noCompletion, noAiAgents]
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

**Config-fence placement is convention only — the parser is
order-independent** and reads every ` ```yaml leetcode ` fence wherever it
sits. The placement above is what the migrator writes and what a reader
expects; a hand-edited file that puts a fence elsewhere still parses
identically. See §2.5.

> The `practice:` block above is **illustrative, not a template**. A fence is
> written only for a key the file actually declares — most artifacts carry no
> `practice:` block at all, and an absent one stays absent rather than being
> materialised at its defaults.

---

## 2. Frontmatter

YAML between the leading `---` fences. It **must** open the file:
`FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/`. Keys are matched by
`KV_RE = /^(\w+):\s*(.*)$/` — a key is `\w+` (letters/digits/underscore, **no
hyphens**). Unknown keys are silently ignored. Invalid `difficulty` / `status`
values are dropped, leaving the default.

**Frontmatter is summary only and carries no execution configuration.** It holds
exactly what Obsidian's Properties UI and the exercise picker read — the six
fields in §2.1 — and nothing else. Everything that governs how the exercise
*runs* (`function`, `functions`, `params`, `returns`, `test`, `practice`, `libs`,
`checks`, `services`) lives in body config fences (§2.5).

The retained set is deliberately **exactly `LeetCodeSummary`**
([`src/types/leetcode.types.ts`](src/types/leetcode.types.ts)) plus the `type`
discriminator, which is what keeps `parseFrontmatterOnly` — the picker's
one-read-per-directory-level fast path — reading frontmatter alone, and keeps
`patchFrontmatterField(raw, 'status', …)` writing where it always did.

### 2.1 Field table

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `type` | `'leetcode'` | yes | — | Discriminator. **Read by no code path in the parser** — `applyScalar` ignores it and `verifyExercise` never reads it. It exists for Obsidian, and for the migrator's refusal check (§2.5), which therefore does its own frontmatter test rather than asking the parser. |
| `title` | string | yes | `''` | Single line. |
| `difficulty` | `easy`\|`medium`\|`hard` | no | `easy` | Any other value → `easy`. |
| `status` | `unsolved`\|`attempted`\|`solved` | no | `unsolved` | **Extension-owned** — auto-written by Submit. Any other value → `unsolved`. |
| `algorithm` | string | no | — | Category tag (e.g. `hash-map`). |
| `tags` | string[] | no | `[]` | Inline `[a, b]` or a YAML `- a` list. |

Every other key is an execution-config key and belongs in a body fence — see
§2.5 for the list and for what happens when one is left here.

### 2.5 Config fences

Execution configuration is written in the body, in fences whose info-string is
`yaml` followed by the bare token `leetcode`:

~~~md
```yaml leetcode
test:
  type: function
  timeoutMs: 5000
```
~~~

**The marker.** `yaml` first, then a bare `leetcode` token. `yaml` first means
Obsidian still syntax-highlights the block (the first info-string token wins).
The `leetcode` token must be **bare**: a `## Files` entry always carries
`path=` (`parseFiles` skips every fence without it), so
` ```yaml leetcode path=src/x.yml ` is a *file*, not config, and never matches.
A plain ` ```yaml ` fence in prose stays prose.

**Do not put a fence-shaped line inside a config fence.** A config fence closes
on a line of exactly three backticks and nothing but whitespace; the
description's heading search, which it shares with section slicing, toggles on
*any* line opening with three backticks. A ` ```yaml ` line inside a config
fence body therefore desynchronises the two, and the description runs on past
the first heading — swallowing `## Examples` and everything after it as prose.
It degrades (over-included prose, still escaped) rather than losing data, but
the artifact will look wrong on the challenge screen.

**Content starts at column 0.** A config fence's body is concatenated with the
frontmatter text and parsed by the same `KV_RE = /^(\w+):\s*(.*)$/`, which is
column-0 anchored — so a top-level key must begin at column 0 exactly as it
would in frontmatter. Sub-keys indent normally beneath it. A top-level line
indented off column 0 is kept verbatim and **warned**, because it will not
parse as a key.

**The parser reads every config fence and calls `parseFrontmatter` once**, over
`frontmatter text + '\n' + every fence body joined in document order`. One call
means defaults are applied exactly once and there is no merge layer to
disagree with itself.

**Order-independence.** Placement is convention (§1, and the table below); the
parser does not enforce it. A fence anywhere in the body is read.

| Block | Canonical placement | Reason |
|---|---|---|
| `function` · `functions` · `params` · `returns` | after the description, before `## Examples` | the signature is what the description just described |
| `test` · `practice` | immediately before `## Tests` | they govern the suites that follow |
| `libs` · `services` | before `# Setup` (function) or before `## Files` (project/service) | declared next to the code they install for |
| `checks` (nested under `test:`) | with the `test:` block, before `## Tests` | `## Tests` fences bind to checks by `check=` |

**A config fence is written only for a key the file declares.** No `practice:`
in the source means no `practice:` fence in the output — an absent block keeps
its defaults, and materialising one at its defaults is a semantic no-op that
only adds lines to read.

#### Duplicate keys across fences — the precedence is asymmetric

A top-level key repeated in two fences resolves **differently depending on the
key**, and the asymmetry is stated here rather than papered over with a uniform
rule the parser does not implement:

| Keys | Winner | Why |
|---|---|---|
| `function`, `functions`, `params`, `returns`, `test`, `practice`, `tags` | **last** occurrence | `parseFrontmatter` walks every line and overwrites the accumulator on each match. |
| `libs`, `checks`, `services` | **first** occurrence | `parseLibs` and `parseChecks` locate their block with `lines.findIndex(…)` and stop at the first hit. |

Either way the extractor **warns**, naming the key and which occurrence won.
Do not rely on the precedence: declare each key once.

#### The hard cut — an execution-config key left in frontmatter

There is **no dual read**. A key from the body set
(`function`, `functions`, `params`, `returns`, `test`, `practice`, `libs`,
`checks`, `services`) found in frontmatter is:

1. **ignored** — the parser does not read it;
2. **warned** — the warning names the key and the fence it belongs in;
3. a **`verifyExercise` failure** — such an artifact reports `ok: false`.

So a v1 artifact does not silently degrade into a half-configured exercise: it
fails loudly, with a message that says what to move where.

#### 2.5.1 `test:` block

Indented sub-keys, both optional:

| Sub-key | Type | Default | Rule |
|---|---|---|---|
| `type` | `TestTypeId` | `function` | Unknown value → `function` (a typo must not make the exercise unrunnable). |
| `timeoutMs` | number | `5000` | Per case. Clamped to `[100, 60000]`. Suite budget = `cases × timeoutMs`, capped at 60 s. |

`TestTypeId` ∈ `function` (**implemented**) · `project` (**implemented**, parsed and
registered for `javascript` + `typescript` — see §9) · `class` ·
`stdin-stdout` · `in-place` · `service` (reserved — they parse and validate, but no
environment is registered, so the language selector renders empty and the panel says why).
`project` and `service` are the multi-file / running-server types.

#### 2.5.2 `practice:` block

Indented sub-keys, all optional:

| Sub-key | Type | Default | Rule |
|---|---|---|---|
| `timeLimit` | number (minutes) | `0` | `0`/empty ⇒ **unlimited**: the in-view clock counts **up** (elapsed) with a "no limit" label and never auto-submits. `> 0` ⇒ **bounded**: the clock counts **down** and auto-submits at zero. Negative / unparsable → `0`. |
| `locked` | boolean | `false` | Exactly the string `true` locks it. Locked ⇒ the panel disables the controls and the extension ignores the option list / time limit the webview posts, using the artifact's own block instead. |
| `options` | `PracticeOptionId[]` | `[noCompletion, noAiAgents]` | Inline `[a, b]` **or** a YAML `- a` list. Unknown ids are dropped. `options: []` ⇒ **no** restrictions. Absent `options:` ⇒ the defaults. |

`PracticeOptionId` ∈ `noCompletion` · `noAiAgents` · `noSnippets` ·
`noParameterHints`.

#### 2.5.3 `params:` block

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

#### 2.5.4 Signature fields

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `function` | string | yes¹ | `''` | Default/fallback function name to implement. Parsed onto `functionName`. ¹Required for `test.type: function`; a `project`/`service` artifact names its targets in `checks:` instead (§9). |
| `functions` | map `<lang>: <name>` | no | — | Per-language override of `function`. Keys resolve through the language-alias table (`py:` → `python`). Read via `functionNameFor(parsed, langId)`, never `functionName` directly, for language-specific code. |
| `params` | `{ name, type }[]` | yes | `[]` | Generic types (see §5). Input keys in `## Tests` must match these `name`s. See §2.5.3. |
| `returns` | string | yes | `''` | Generic return type. |

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
| *(config fence)* | ` ```yaml leetcode ` — **not a section** | — | its own closing fence |

`#`-level sections (Setup / Solutions / Attempts) are **not** terminated by
`##` sub-headings — those are the language headings inside them.

**A config fence is not a section.** It has no heading, it does not open or
close one, and it may appear inside any of them — the extractor collects fences
by their info-string, independent of section structure. The only interaction
with section slicing is the description (§3.1).

Section slicing is **fence-aware** (`sectionBounds`), which matters more in v2
than it did in v1: a column-0 `#` inside a config fence is a YAML **comment**,
not a heading, and must not truncate the section that contains it.

### 3.1 Description

The trimmed prose between the closing frontmatter `---` and the first Markdown
heading (`#` or `##`), **minus every config-fence span**. The whole body
(trimmed, minus config fences) when there is no heading.

**A config fence sitting between the description and `## Examples` is not part
of the description** — that is the canonical position for the signature block
(§2.5), and it falls inside the description slice by position. The parser
subtracts config-fence spans from the slice, so the fence contributes nothing
to `parsed.description`.

This is load-bearing, not cosmetic: the panel renders the description through
`renderMarkdownLite`, which has **no fenced-code rule**, so an un-subtracted
fence would show its raw YAML body as prose on the challenge screen.

A column-0 `#` line *inside* a config fence — a YAML comment — likewise does
not truncate the description.

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

Each holds case fences: an array of
`{ input: Record<string, unknown>, expected: unknown }`. The `input` keys must
match the `params` names. A malformed fence, a missing fence, or a missing
section all yield `[]` — the parser never throws.

**Two spellings are accepted, ` ```yaml ` and ` ```json `.** The info-string
says which grammar the body is written in, so this is not a dual read of one
thing — it is two notations for the same case list, each parsed by exactly one
parser. `yaml` is the preferred form and what the migrator writes; `json`
remains valid indefinitely.

~~~md
## Tests

```yaml
- input:
    arr: [1, -2, 0, 3]
  expected: 3
- input:
    arr: [5]
  expected: 5
```
~~~

#### The YAML here is **not** YAML 1.1 — it is JSON's type system with YAML's syntax

This is the single most important rule in this section, and it exists because a
silently re-typed *value* is worse than a loud parse failure: an exercise's
reference solution is graded against its own expecteds, so a coerced expected
makes the harness verify **green while teaching the wrong answer**.

| Unquoted scalar | Becomes | Note |
|---|---|---|
| `true` · `false` | boolean | exact lower-case only |
| `null` · `~` | null | |
| strict JSON number (`3`, `-0.5`, `1e3`) | number | |
| **everything else** | **string** | |

So every YAML 1.1 implicit type is **left as a string**: `yes`/`no`/`on`/`off`,
`y`/`n`, leading-zero octals (`0051` stays `"0051"`, not `41`), sexagesimals
(`1:1` stays `"1:1"`, not `61`), `.inf`, `.nan`. A **quoted** scalar is always a
string and is never re-typed.

A key must be followed by whitespace or end-of-line, so `1:1` and
`http://example.com` are scalars, not mappings.

**Not supported, by design** — each is a parser-complexity or ambiguity risk
with no use in case data: anchors and aliases (`&`/`*`), explicit tags (`!!str`),
multiple documents (`---`), block scalars (`|`, `>`), complex keys, merge keys.
Use flow style (`[a, b]`, `{k: v}`) for nested collections; the migrator does.

**Writing it by hand:** if a string could be read as a number, a boolean, `null`,
or contains `,` `:` `#` `[` `]` `{` `}`, quote it. The migrator quotes
automatically, and `emit → parse` is verified to be the identity on every value
JSON can express.

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
- ` ```yaml ` / ` ```json ` — test suites (§3.3). A **bare** ` ```yaml ` fence
  inside `## Tests` / `## Final Tests` is case data; ` ```yaml leetcode ` is
  config even there, and is never read as an empty suite.
- ` ```yaml leetcode ` — a **config fence** (§2.5). `yaml` first so Obsidian
  highlights it; the `leetcode` token must be **bare** — a second token of the
  form `key=value` (e.g. `path=`) makes it a `## Files` entry instead.
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
| `project` | `javascript`, `typescript` |
| `class`, `stdin-stdout`, `in-place`, `service` | *(none — reserved; selector renders empty)* |

`project`'s two entries are the **runnable** ids
(`projectEnvs = ['javascript', 'typescript'].map(projectEnvFor)`);
`javascriptreact` / `typescriptreact` are display ids with no runtime of their
own, and a `.jsx` / `.tsx` file maps onto the runnable pair at bundle time.
A `project` is graded by its declared `checks:` rather than one return value, so
its environment drives the check runner, not the single-function driver
described below (§9.2).

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
| Frontmatter (except `status`), **every ` ```yaml leetcode ` config fence**, description, `## Examples`, `## Tests`, `## Final Tests`, `# Setup`, `# Solutions` | **Author** |
| `status:` frontmatter field | **Extension** — `solved` on an all-green Submit, `attempted` on a failing live Submit. A dry run against a stored solution never writes it. |
| `<!-- meta: … -->` on a solved solution | **Extension** — on a successful Submit. |
| `# Attempts` section + `<!-- attempt: … -->` entries | **Extension** — every live Submit (pass or fail), newest-first, in a single read-patch-write alongside the `status` update. |

`status` + the solved `meta` + the attempt entry are applied in **one**
read-patch-write per Submit, so a manual edit made between a run's start and its
Submit is preserved everywhere except those three writer-owned spots.

**The extension never writes a config fence.** Config fences are author-owned
in full: nothing in the extension creates, rewrites, reorders or deletes one.
The only body writes it makes are `# Attempts` and the solved `<!-- meta: … -->`
comment, and its only frontmatter write is `status:` — so a config fence, and
the placement the author chose for it, survives every Submit untouched.

The **migrator** (`scripts/migrate-artifact-format.mjs`) is the one tool that
writes config fences, and it is a one-time author-side v1 → v2 transform run
explicitly from the CLI, not part of the extension.

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

A body config fence (§2.5), canonically placed before `## Tests` so it sits with
the cases that bind to it:

````markdown
```yaml leetcode
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
````

Note the `#` comments above are **inside** a fence and are YAML comments, not
headings — §3 covers why that distinction is load-bearing for section slicing.

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

A body config fence (§2.5), canonically placed before `## Files`:

````markdown
```yaml leetcode
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
````

> **`services:` has no parser.** `grep -rn "'services'" src/` finds it only in
> `KNOWN_FM_KEYS` (plus one JSDoc example) — nothing reads the block, and no
> `service` environment is registered. The fields below are a documented,
> **not-yet-implemented** contract; the migrator relocates the block as text
> like any other config key, and the near-miss key warning knows the name. What
> is written here is what the implementation must satisfy, not what runs today.

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

A body config fence (§2.5), canonically placed before `# Setup` (function) or
before `## Files` (project/service) — next to the code it installs for:

````markdown
```yaml leetcode
libs:
  python: [fastapi@^0.115.0, uvicorn@^0.32.0]
  typescript: [react@^19.0.0, vite@^7.0.0]
```
````

Both the block form above and an inline `python: [fastapi@^0.115.0, uvicorn@^0.32.0]` parse.
An entry the allowlist refuses is **dropped with a warning** before it can reach an install
subprocess; the rest of that language's list still installs.

Per-language dependency lists. Every entry must pass the npm-style allowlist already
shipped in `validateLibNames` ([lib-spec.helpers.ts](src/services/lib-spec.helpers.ts)) —
a bare scoped/unscoped package name with an optional `@version`, no `..` anywhere — before
it can reach an install subprocess. Java is out of scope (no transitive resolver in a stock
JDK).

**The installer serves the npm registry only, so the language key decides whether a list
installs at all.** `installLibs` shells out to `pnpm add --dir`, and there is no second
installer, so only the languages in `NPM_LANGUAGES` (`javascript`, `typescript`,
`javascriptreact`, `typescriptreact`) are served. A list under any other key is **kept on the
parsed artifact, warned about, and skipped** — `libs: { python: [requests@^2.0.0] }` warns
`libs: 'python' is not installable — the library installer is npm-only, so these are skipped`
rather than installing the unrelated npm package that happens to share the name. The
name-shape allowlist cannot tell two registries' packages apart, so the language key is the
only thing that can. (The warning still says *npm-only* because the **registry** is what
bounds it; the client in front of that registry is pnpm.)

> **This npm-only restriction describes today's installer, not the format.** It is carried
> across the v1 → v2 move unchanged — this change relocated the block, it did not bless the
> limitation. A follow-on change adding per-registry installers (pip / cargo / maven) retires
> `NPM_LANGUAGES` and this warning with it. Treat it as current behaviour to honour, not as a
> permanent property of `libs:`.

**Trust class, stated plainly:** the allowlist bounds the *shape of a name*; it says nothing
about what the package contains once it is fetched. Treat an artifact's `libs:` the way you
would treat its `build` argv — as code you are choosing to run, because a `build` check, a
render bundle, or a `dom-assert` will execute it.

**Install scripts, however, do not run.** pnpm 10+ refuses a dependency's
`preinstall`/`install`/`postinstall` unless it is explicitly approved, and nothing here
approves one — so an artifact cannot obtain code execution merely by *declaring* a package.
This is stricter than the npm installer it replaced, which ran them all. Two consequences
worth knowing:

- `--config.strict-dep-builds=false` **is** passed, because pnpm 11 makes an ignored build
  script a non-zero exit; without it a perfectly usable install is reported as `install failed`.
  The flag changes the *exit status*, never whether a script runs.
- A package that genuinely needs a build step installs quietly incomplete. esbuild — the
  harness's own toolchain, and the obvious candidate — is unaffected, because its platform
  binary arrives as an optional dependency rather than a postinstall download. If some future
  lib does need one, the fix is a hardcoded `--allow-build=<pkg>` list in the installer,
  **never** one read from an artifact.
