# Obsidian Artifacts: AI LeetCode Trainer

A VS Code extension that turns `type: leetcode` notes in your Obsidian vault
into runnable coding challenges — starter code in the language you pick, an
editor locked down to keep the practice honest, a countdown, and a batch test
runner, all driven from a dedicated preview panel.

Companion to **Obsidian Artifacts: AI Snippets & Tools** (the core extension).
This one is standalone and LeetCode-only.

## Getting started

```bash
pnpm install
npm run compile      # or: npm run watch
```

Press **F5** to launch the Extension Development Host.

On first run the settings panel opens — point it at your Obsidian vault root
(the folder containing `.obsidian/`). A `LeetCode/` directory is created
automatically. Open a problem via `Obsidian Artifacts: Open LeetCode Exercise`
or the editor context menu.

## The loop

1. **Open** a problem — the panel shows the description, examples, the test
   counts, and the starter code. Reference solutions stay collapsed; they are
   spoilers.
2. **Solve It** — pick a language, tick the practice restrictions, set a time
   limit. A temp file opens in the editor, seeded with the `# Setup` stub.
3. **Run Tests** — grade your live buffer against the visible `## Tests`. Fast
   feedback; nothing is recorded, the clock keeps running.
4. **Submit** — grade against `## Tests` **and** the hidden `## Final Tests`.
   All green writes `status: solved` and your solve time; a failure writes
   `status: attempted`. Either way the challenge ends and your editor settings
   come back. Solve It reopens the same file to try again.

`Obsidian Artifacts: End LeetCode Challenge` (or clicking the countdown in the
status bar) abandons a run and restores your settings.

## Practice mode

Four restrictions, each mapping to a set of VS Code settings applied while a
challenge is live and restored exactly when it ends: `noCompletion`,
`noAiAgents`, `noSnippets`, `noParameterHints`. VS Code has no per-editor
configuration scope, so these apply to **every** open editor for the duration of
the run.

## Languages

Java, Python, and JavaScript. A language is offered only when an environment
exists for the exercise's `test.type` — a `# Setup` block alone is not enough.

## Vault file format

````md
---
type: leetcode
title: Two Sum
difficulty: easy
function: twoSum
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
[ { "input": { "nums": [2,7,11,15], "target": 9 }, "expected": [0,1] } ]
```

## Final Tests
```json
[ { "input": { "nums": [1,5,3], "target": 8 }, "expected": [1,2] } ]
```

# Setup

## Java
```java
public static int[] twoSum(int[] nums, int target) {
    // solution here
}
```

# Solutions

## Java
```java
public static int[] twoSum(int[] nums, int target) { /* … */ }
```
````

`## Tests` are public — shown, and run by **Run Tests**. `## Final Tests` are
hidden: their count is shown, their inputs never are, and they only run on
**Submit**. An exercise with no `## Final Tests` is graded on its public list.

Both blocks are optional per language: a language with no `# Setup` stub falls
back to generated boilerplate.

## Roadmap

- **Polyglot challenges** — a `components:` block declaring a driver and one or
  more implementations in different languages, cooperating over JSON stdio. The
  schema is fixed; the implementation is not scheduled.
- **Phase 3 (Jira VSX-35)** — an MCP server exposing LeetCode artifacts to the
  local IDE AI agent (Claude / OpenAI / Copilot) for solution evaluation and
  hints.
