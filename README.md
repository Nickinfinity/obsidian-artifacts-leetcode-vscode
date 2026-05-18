# Obsidian Artifacts: AI LeetCode Trainer

A VS Code extension that turns `type: leetcode` notes in your Obsidian vault
into runnable coding challenges — auto-generated boilerplate, a per-language
test harness, and a child-process test runner, all driven from a dedicated
preview panel.

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
automatically. Open a problem via the `Obsidian LeetCode: Open LeetCode
Problem` command or the editor context menu.

## Vault file format

```md
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

# Solutions

## Java
```java
public static int[] twoSum(int[] nums, int target) { /* … */ }
```
```

## Roadmap

Future work (Jira VSX-35, Phase 3): an MCP server exposing LeetCode artifacts
to the local IDE AI agent (Claude / OpenAI / Copilot) for solution evaluation,
hints, and practice modes.
