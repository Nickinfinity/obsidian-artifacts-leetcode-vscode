---
type: leetcode
title: Line Item Total (build check smoke)
difficulty: easy
algorithm: reduce
status: unsolved
libs:
  typescript:
    - typescript@^5.9.0
test:
  type: project
  timeoutMs: 120000
  checks:
    - name: type-checks
      kind: build
      argv: ["tsc", "--noEmit"]
practice:
  timeLimit: 10
  options: [noCompletion]
tags: [typescript, project, build, smoke]
---

The smallest `project` exercise graded by a **`build`** check rather than by a
rendered DOM: one `.ts` file, one `tsconfig.json`, and a compiler that must exit
`0`. It exists so the `build` path can be verified end to end — start here when
checking that a declared toolchain is actually resolvable from the run directory.

`argv` names the **bare** binary `tsc`, not `npx tsc`. That is the point of the
exercise: the run directory gets its own `node_modules/.bin` linked from the
shared library cache, and it is prepended to the child's `PATH`, so the artifact's
own declared TypeScript version is what runs. A bare `tsc` that resolves is the
observable proof the linking worked; before it did, this check could only fail.

Unlike the React smoke artifact, this one ships **unsolved**: the starter does not
compile, so grading the declared tree is red and grading the `# Solutions` overlay
is green. That asymmetry is the property worth having in an example — an exercise
whose *starter* passes is a bug, and this file is the one that would catch it.

Implement `total` in `src/total.ts`:

- take an array of line items, each with a `price` and a `quantity`,
- return the sum of `price × quantity` across every item,
- return `0` for an empty array — which the reduce seed gives you for free.

There are no test cases to bind. A `build` check is graded by the exit status of
its `argv`, so it is the one check kind that needs no `check=` fence.

## Examples

```example
input: items = []
output: 0
```

```example
input: items = [{ price: 2.5, quantity: 4 }]
output: 10
```

## Files

```json path=tsconfig.json role=readonly
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

```typescript path=src/total.ts role=editable
/** One priced line in an order. */
export interface LineItem {
  price: number;
  quantity: number;
}

/**
 * Total value of every line item.
 *
 * @param items - The order's lines.
 * @returns Sum of `price × quantity`.
 */
export function total(items: LineItem[]): number {
  // TODO: replace this stub. It deliberately does not type-check — `null` is
  // not assignable to `number` under `strict`, so `tsc --noEmit` exits non-zero
  // and the `type-checks` check is red until the function is implemented.
  return null;
}
```

# Solutions

```typescript path=src/total.ts
/** One priced line in an order. */
export interface LineItem {
  price: number;
  quantity: number;
}

/**
 * Total value of every line item.
 *
 * @param items - The order's lines.
 * @returns Sum of `price × quantity`.
 */
export function total(items: LineItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}
```
