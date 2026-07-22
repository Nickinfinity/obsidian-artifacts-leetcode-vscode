---
type: leetcode
title: Express Orders API + React Dashboard
difficulty: hard
algorithm: grouping
libs:
  typescript:
    - express@^4.21.0
    - "@types/express@^4.17.0"
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
    - name: api groups orders by status
      kind: http
      service: api
    - name: dashboard builds
      kind: build
      dir: client
      argv: ["npx", "tsc", "--noEmit"]
services:
  - name: api
    dir: server
    install: ["npm", "ci"]
    start: ["node", "--experimental-strip-types", "src/server.ts"]
    ready: "listening"
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
tags: [node, express, react, typescript, service, spike]
---

> ⚠️ **Contract-only spike artifact.** `test.type: service` is a **reserved** type — no
> environment is registered and no server is ever booted, so this exercise parses, lists,
> and explains itself in the panel, but cannot be run yet. It exists to prove the running-server
> contract ([plan §7](../../../../docs/plans/rust-multilang/plan.md)) against a real artifact;
> the gaps it exposes are recorded in
> [spike-findings.md](../../../../docs/plans/rust-multilang/spike-findings.md).

The **single-language** service demonstration — the same `services:` contract as
[`fastapi-react.md`](../multi/fastapi-react.md) minus the cross-language seam. Node + Express
backend, React frontend, both TypeScript, one file. The pair proves the format is
language-agnostic: nothing in `services:` knows what Python or Node is, only argv and a
readiness string.

Two things are graded:

1. **`GET /orders/summary`** in `server/src/server.ts` — return the order **count per status**,
   as `{"summary": {"<status>": <count>}}`, including only statuses that actually occur.
   Graded by `http` checks fired from the extension host against the booted server.
2. **The dashboard still type-checks** — `npx tsc --noEmit` in `client/` must exit 0.

The server port is assigned by the extension and arrives as `process.env.PORT`; the frontend
reads `VITE_API_URL` from a `hidden` `.env.local` written before it boots. Hardcoding either
is how this exercise fails on someone else's machine.

## Examples

```example
input: GET /orders/summary
output: {"summary": {"shipped": 2, "pending": 1, "cancelled": 1}}
```

```example
input: GET /orders/summary?since=2026-01-02
output: {"summary": {"shipped": 1, "cancelled": 1}}
```

## Tests

```json
[
  {
    "input": { "path": "/orders/summary" },
    "expected": { "summary": { "shipped": 2, "pending": 1, "cancelled": 1 } }
  },
  {
    "input": { "path": "/orders/summary?since=2026-01-02" },
    "expected": { "summary": { "shipped": 1, "cancelled": 1 } }
  }
]
```

## Final Tests

```json
[
  {
    "input": { "path": "/orders/summary?since=2030-01-01" },
    "expected": { "summary": {} }
  },
  {
    "input": { "path": "/orders/summary?since=2026-01-01" },
    "expected": { "summary": { "shipped": 2, "pending": 1, "cancelled": 1 } }
  }
]
```

## Files

```typescript path=server/src/server.ts role=editable
import express from 'express';
import { ORDERS } from './orders.js';

const app = express();

app.get('/orders/summary', (req, res) => {
  const since = typeof req.query.since === 'string' ? req.query.since : undefined;
  // your code here — count orders per status, skipping any placed before `since`
  res.json({ summary: {} });
});

// The port is assigned by the extension — never hardcode one.
const port = Number(process.env.PORT ?? 0);
app.listen(port, '127.0.0.1', () => console.log(`listening on ${port}`));
```

```typescript path=server/src/orders.ts role=readonly
export interface Order {
  id: number;
  status: 'pending' | 'shipped' | 'cancelled';
  placedAt: string;
}

/** The order book this exercise ships with — data, not your work. */
export const ORDERS: Order[] = [
  { id: 1, status: 'shipped', placedAt: '2026-01-01' },
  { id: 2, status: 'pending', placedAt: '2026-01-01' },
  { id: 3, status: 'shipped', placedAt: '2026-01-02' },
  { id: 4, status: 'cancelled', placedAt: '2026-01-03' },
];
```

```json path=server/package.json role=hidden
{
  "name": "orders-api",
  "private": true,
  "type": "module",
  "dependencies": { "express": "^4.21.0" },
  "devDependencies": { "@types/express": "^4.17.0", "typescript": "^5.9.0" }
}
```

```typescript path=client/src/StatusSummary.tsx role=editable
export type Summary = Record<string, number>;

/** Renders one `<li>` per status: status name, then its count. Highest count first. */
export function StatusSummary({ summary }: { summary: Summary }) {
  // your code here
  return <ul />;
}
```

```typescript path=client/src/App.tsx role=editable
import { useEffect, useState } from 'react';
import { StatusSummary, type Summary } from './StatusSummary';

/** Injected by the extension before this app boots — never hardcode a port. */
const API_URL = import.meta.env.VITE_API_URL as string;

export default function App() {
  const [summary, setSummary] = useState<Summary>({});

  useEffect(() => {
    // your code here — fetch `${API_URL}/orders/summary` and store `summary`
  }, []);

  return <StatusSummary summary={summary} />;
}
```

```json path=client/package.json role=hidden
{
  "name": "orders-dashboard",
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

## TypeScript

### Backend — reduce into a status map

```typescript
app.get('/orders/summary', (req, res) => {
  const since = typeof req.query.since === 'string' ? req.query.since : undefined;
  const summary = ORDERS
    .filter(order => since === undefined || order.placedAt >= since)
    .reduce<Record<string, number>>((acc, order) => {
      acc[order.status] = (acc[order.status] ?? 0) + 1;
      return acc;
    }, {});
  res.json({ summary });
});
```

### Frontend — fetch on mount, render sorted

```typescript
export function StatusSummary({ summary }: { summary: Summary }) {
  const rows = Object.entries(summary).sort((a, b) => b[1] - a[1]);
  return (
    <ul>
      {rows.map(([status, count]) => (
        <li key={status}>
          {status} — {count}
        </li>
      ))}
    </ul>
  );
}

export default function App() {
  const [summary, setSummary] = useState<Summary>({});

  useEffect(() => {
    fetch(`${API_URL}/orders/summary`)
      .then(res => res.json())
      .then((body: { summary: Summary }) => setSummary(body.summary))
      .catch(() => setSummary({}));
  }, []);

  return <StatusSummary summary={summary} />;
}
```
