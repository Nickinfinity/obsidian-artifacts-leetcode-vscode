---
type: leetcode
title: Product Catalogue Page (Next.js)
difficulty: medium
function: filterInStock
algorithm: array-filter
params:
  - name: catalogue
    type: map<string,int>
  - name: minStock
    type: int
returns: string[]
libs:
  typescript:
    - next@^15.5.0
    - react@^19.0.0
    - react-dom@^19.0.0
    - typescript@^5.9.0
    - "@types/react@^19.0.0"
test:
  type: project
  timeoutMs: 10000
  checks:
    - name: catalogue filter
      kind: function
      file: src/lib/catalogue.ts
      function: filterInStock
    - name: app builds
      kind: build
      argv: ["npx", "tsc", "--noEmit"]
practice:
  timeLimit: 45
  options: [noCompletion, noAiAgents]
tags: [nextjs, react, typescript, multi-file, project, spike]
---

> ✅ **Runnable and green.** Written first as a contract spike, before `test.type: project`
> could execute anything; the gaps it exposed are what the implementation followed. Both
> checks now pass through `node scripts/verify-exercise.mjs`. The `build` check
> (`npx tsc --noEmit`) was the last to work: it spawns its toolchain with the run directory as
> `cwd`, and a compiler resolves `node_modules` by walking **up** from there, so nothing
> resolved until the run directory got its own `node_modules` of symlinks into the shared
> library cache. Expect a 300–500 MB cold install the first time this artifact is graded —
> `next` plus React and the type packages — and a fast run on every grading after that, since
> the cache is keyed on the lib set and shared.

A Next.js App Router page lists a product catalogue served by its own route handler
(`GET /api/products`) — one process, one language, several files.

Two things are graded:

1. **`filterInStock(catalogue, minStock)`** in `src/lib/catalogue.ts` — the pure data-shaping
   helper the page uses. Return the names of every product whose stock is **at least**
   `minStock`, sorted alphabetically. This is a plain `function` check, so it runs on the
   existing `function × typescript` environment with the cases below.
2. **The app still type-checks** — `npx tsc --noEmit` must exit 0 (`build` check). A page that
   renders the wrong prop type fails here without a browser being involved.

`src/app/api/products/route.ts` is **readonly**: it is the endpoint contract, not your work.
`src/app/globals.css` is **ungraded scaffolding** — it is opened so the page can be made to
look right, and no check reads it. Nothing about it is scored.

## Examples

```example
input: catalogue = {"keyboard": 12, "mouse": 0, "monitor": 3}, minStock = 3
output: ["keyboard", "monitor"]
```

```example
input: catalogue = {"cable": 1}, minStock = 5
output: []
```

## Tests

```json check="catalogue filter"
[
  { "input": { "catalogue": { "keyboard": 12, "mouse": 0, "monitor": 3 }, "minStock": 3 }, "expected": ["keyboard", "monitor"] },
  { "input": { "catalogue": { "cable": 1 }, "minStock": 5 }, "expected": [] }
]
```

## Final Tests

```json check="catalogue filter"
[
  { "input": { "catalogue": {}, "minStock": 0 }, "expected": [] },
  { "input": { "catalogue": { "b": 4, "a": 4, "c": 4 }, "minStock": 4 }, "expected": ["a", "b", "c"] },
  { "input": { "catalogue": { "hub": 2, "dock": 2 }, "minStock": 3 }, "expected": [] }
]
```

## Files

```typescript path=src/lib/catalogue.ts role=editable
/** One product as the route handler serves it. */
export interface Product {
  name: string;
  stock: number;
}

/**
 * Names of every product with at least `minStock` units, alphabetical.
 *
 * @param catalogue - Product name → units in stock.
 * @param minStock  - Inclusive lower bound.
 * @returns Sorted product names.
 */
export function filterInStock(catalogue: Record<string, number>, minStock: number): string[] {
  // your code here
  return [];
}
```

```typescript path=src/app/api/products/route.ts role=readonly
import { NextResponse } from 'next/server';

/** The catalogue this exercise ships with — the endpoint contract, not your work. */
const CATALOGUE: Record<string, number> = {
  keyboard: 12,
  mouse: 0,
  monitor: 3,
  cable: 1,
};

export async function GET(): Promise<NextResponse> {
  const products = Object.entries(CATALOGUE).map(([name, stock]) => ({ name, stock }));
  return NextResponse.json({ products });
}
```

```typescript path=src/app/page.tsx role=editable
import { ProductList } from '../components/ProductList';
import type { Product } from '../lib/catalogue';

/** Server component: fetch the catalogue and hand it to the list component. */
export default async function Page() {
  const res = await fetch('http://127.0.0.1:3000/api/products', { cache: 'no-store' });
  const { products } = (await res.json()) as { products: Product[] };

  // your code here — render <ProductList /> with the in-stock products only
  return <ProductList products={products} />;
}
```

```typescript path=src/components/ProductList.tsx role=editable
import type { Product } from '../lib/catalogue';

/** Renders one `<li>` per product, name first, unit count second. */
export function ProductList({ products }: { products: Product[] }) {
  // your code here
  return <ul />;
}
```

```css path=src/app/globals.css role=editable
/* Ungraded scaffolding — no check reads this file. Make the list look right. */
ul {
  list-style: none;
  padding: 0;
}
```

```json path=package.json role=hidden
{
  "name": "product-catalogue",
  "private": true,
  "scripts": { "dev": "next dev", "build": "next build" },
  "dependencies": { "next": "^15.5.0", "react": "^19.0.0", "react-dom": "^19.0.0" },
  "devDependencies": { "typescript": "^5.9.0", "@types/react": "^19.0.0" }
}
```

```json path=tsconfig.json role=hidden
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

# Solutions

## TypeScript

### Object.entries + sort

The fence carries `path=` so it **overlays** `## Files` — `runProjectChecks(…, { withSolutions:
true })` grades this file instead of the starter. An overlay replaces the whole file, so
`Product` is repeated here: `src/app/api/products/route.ts` and `src/components/ProductList.tsx`
both `import type { Product } from '../lib/catalogue'`, and dropping it would fail the `build`
check.

```typescript path=src/lib/catalogue.ts
/** One product as the route handler serves it. */
export interface Product {
  name: string;
  stock: number;
}

/**
 * Names of every product with at least `minStock` units, alphabetical.
 *
 * @param catalogue - Product name → units in stock.
 * @param minStock  - Inclusive lower bound.
 * @returns Sorted product names.
 */
export function filterInStock(catalogue: Record<string, number>, minStock: number): string[] {
  return Object.entries(catalogue)
    .filter(([, stock]) => stock >= minStock)
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b));
}
```

### Page and list component

```typescript
export default async function Page() {
  const res = await fetch('http://127.0.0.1:3000/api/products', { cache: 'no-store' });
  const { products } = (await res.json()) as { products: Product[] };
  const inStock = products.filter(p => p.stock > 0);
  return <ProductList products={inStock} />;
}

export function ProductList({ products }: { products: Product[] }) {
  return (
    <ul>
      {products.map(p => (
        <li key={p.name}>
          {p.name} — {p.stock} in stock
        </li>
      ))}
    </ul>
  );
}
```
