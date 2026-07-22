---
type: leetcode
title: Priced Items API + React Consumer (FastAPI)
difficulty: hard
algorithm: filtering
libs:
  python:
    - fastapi@^0.115.0
    - uvicorn@^0.32.0
  typescript:
    - react@^19.0.0
    - react-dom@^19.0.0
    - typescript@^5.9.0
    - vite@^7.0.0
    - "@types/react@^19.0.0"
test:
  type: service
  runtime: local
  timeoutMs: 15000
  checks:
    - name: api filters by price
      kind: http
      service: api
    - name: web builds
      kind: build
      dir: client
      argv: ["npx", "tsc", "--noEmit"]
services:
  - name: api
    dir: server
    install: ["pip", "install", "-r", "requirements.txt"]
    start: ["uvicorn", "main:app", "--host", "127.0.0.1", "--port", "${PORT}"]
    ready: "Uvicorn running"
    exposeAs:
      VITE_API_URL: "http://127.0.0.1:${PORT}"
  - name: web
    dir: client
    install: ["npm", "ci"]
    start: ["npm", "run", "dev", "--", "--port", "${PORT}", "--host", "127.0.0.1"]
    ready: "ready in"
    envFile: .env.local
    dependsOn: [api]
practice:
  timeLimit: 60
  options: [noCompletion, noAiAgents]
tags: [fastapi, python, react, typescript, multi-language, service, spike]
---

> ⚠️ **Contract-only spike artifact.** `test.type: service` is a **reserved** type — no
> environment is registered and no server is ever booted, so this exercise parses, lists,
> and explains itself in the panel, but cannot be run yet. It exists to prove the running-server
> contract ([plan §7](../../../../docs/plans/rust-multilang/plan.md)) against a real artifact;
> the gaps it exposes are recorded in
> [spike-findings.md](../../../../docs/plans/rust-multilang/spike-findings.md).

The **multi-language** service demonstration: a Python (FastAPI) backend and a TypeScript
(React + Vite) frontend graded as one exercise. Two runtimes, one artifact, one Submit.

Two things are graded:

1. **`GET /items?maxPrice=<n>`** in `server/main.py` — return every item priced **at or below**
   `maxPrice`, cheapest first, as `{"items": [...]}`. Graded by `http` checks fired from the
   extension host against the booted server, with the cases below.
2. **The frontend still type-checks** — `npx tsc --noEmit` in `client/` must exit 0
   (`build` check).

You never write the wiring. The extension picks a free port for each service, boots them in
dependency order, and writes `client/.env.local` with `VITE_API_URL` **before** the frontend
starts — that file is `hidden`, so it never appears in your tabs.

## Examples

```example
input: GET /items?maxPrice=20
output: {"items": [{"name": "cable", "price": 5.0}, {"name": "mouse", "price": 18.5}]}
```

```example
input: GET /items?maxPrice=1
output: {"items": []}
```

## Tests

```json
[
  {
    "input": { "path": "/items?maxPrice=20" },
    "expected": { "items": [{ "name": "cable", "price": 5.0 }, { "name": "mouse", "price": 18.5 }] }
  },
  {
    "input": { "path": "/items?maxPrice=1" },
    "expected": { "items": [] }
  }
]
```

## Final Tests

```json
[
  {
    "input": { "path": "/items?maxPrice=1000" },
    "expected": {
      "items": [
        { "name": "cable", "price": 5.0 },
        { "name": "mouse", "price": 18.5 },
        { "name": "keyboard", "price": 45.0 },
        { "name": "monitor", "price": 220.0 }
      ]
    }
  },
  {
    "input": { "path": "/items?maxPrice=45" },
    "expected": {
      "items": [
        { "name": "cable", "price": 5.0 },
        { "name": "mouse", "price": 18.5 },
        { "name": "keyboard", "price": 45.0 }
      ]
    }
  }
]
```

## Files

```python path=server/main.py role=editable
from fastapi import FastAPI

app = FastAPI()

# The catalogue this exercise ships with — data, not your work.
ITEMS = [
    {"name": "keyboard", "price": 45.0},
    {"name": "mouse", "price": 18.5},
    {"name": "monitor", "price": 220.0},
    {"name": "cable", "price": 5.0},
]


@app.get("/items")
def list_items(maxPrice: float = 1e9):
    # your code here — items priced <= maxPrice, cheapest first
    return {"items": []}
```

```text path=server/requirements.txt role=hidden
fastapi==0.115.*
uvicorn==0.32.*
```

```typescript path=client/src/ItemList.tsx role=editable
export interface Item {
  name: string;
  price: number;
}

/** Renders one `<li>` per item: name, then price with two decimals. */
export function ItemList({ items }: { items: Item[] }) {
  // your code here
  return <ul />;
}
```

```typescript path=client/src/App.tsx role=editable
import { useEffect, useState } from 'react';
import { ItemList, type Item } from './ItemList';

/** The API base URL is injected by the extension — never hardcode a port. */
const API_URL = import.meta.env.VITE_API_URL as string;

export default function App() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    // your code here — fetch `${API_URL}/items?maxPrice=100` and store `items`
  }, []);

  return <ItemList items={items} />;
}
```

```json path=client/package.json role=hidden
{
  "name": "priced-items-client",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "tsc --noEmit && vite build" },
  "dependencies": { "react": "^19.0.0", "react-dom": "^19.0.0" },
  "devDependencies": { "typescript": "^5.9.0", "vite": "^7.0.0", "@types/react": "^19.0.0" }
}
```

```text path=client/.env.local role=hidden
VITE_API_URL=http://127.0.0.1:${PORT}
```

# Solutions

## Python

```python
@app.get("/items")
def list_items(maxPrice: float = 1e9):
    matching = [item for item in ITEMS if item["price"] <= maxPrice]
    return {"items": sorted(matching, key=lambda item: item["price"])}
```

## TypeScript

```typescript
export function ItemList({ items }: { items: Item[] }) {
  return (
    <ul>
      {items.map(item => (
        <li key={item.name}>
          {item.name} — {item.price.toFixed(2)}
        </li>
      ))}
    </ul>
  );
}

export default function App() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    fetch(`${API_URL}/items?maxPrice=100`)
      .then(res => res.json())
      .then((body: { items: Item[] }) => setItems(body.items))
      .catch(() => setItems([]));
  }, []);

  return <ItemList items={items} />;
}
```
