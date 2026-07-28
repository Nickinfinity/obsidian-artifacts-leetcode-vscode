---
type: leetcode
title: React Counter (project smoke)
difficulty: easy
algorithm: state
status: unsolved
libs:
  javascript:
    - react@^19.0.0
    - react-dom@^19.0.0
test:
  type: project
  timeoutMs: 10000
  checks:
    - name: counter
      kind: dom-assert
      file: src/App.jsx
practice:
  timeLimit: 15
  options: [noCompletion]
tags: [react, project, smoke]
---

The smallest runnable `project` exercise: one component, one `dom-assert` check.
It exists so the multi-file path can be opened, run and graded end to end without
a migrated React exercise being available — start here when checking that the
`project` type still works. Unlike a real exercise it ships **already complete**,
so `verify-exercise.mjs` grades it green out of the box.

Build a counter in `src/App.jsx`:

- a `<button>` labelled `+1` that increments a count held in component state,
- a `<span id="count">` showing the current count,
- the count starts at `0`.

Each graded case **remounts** the component, so a case that clicks twice sees
`2` — state never carries over from the previous case.

## Examples

```example
input: clicks = 0
output: "0"
```

```example
input: clicks = 1
output: "1"
```

## Tests

```json check=counter
[
  { "input": { "steps": [{ "op": "text", "selector": "#count" }] }, "expected": "0" },
  { "input": { "steps": [{ "op": "click", "selector": "button" }, { "op": "text", "selector": "#count" }] }, "expected": "1" },
  { "input": { "steps": [{ "op": "count", "selector": "button" }] }, "expected": 1 }
]
```

## Final Tests

```json check=counter
[
  { "input": { "steps": [
      { "op": "click", "selector": "button" },
      { "op": "click", "selector": "button" },
      { "op": "click", "selector": "button" },
      { "op": "text", "selector": "#count" }] }, "expected": "3" }
]
```

## Files

```javascript path=src/App.jsx role=editable
import { useState } from 'react';

/** Counter with a single increment button. */
export default function App() {
  const [count, setCount] = useState(0);
  return (
    <div>
      <button onClick={() => setCount(count + 1)}>+1</button>
      <span id="count">{String(count)}</span>
    </div>
  );
}
```

```css path=src/app.css role=hidden
/* Ungraded scaffolding — no check reads this file. */
button { font: inherit; }
```
