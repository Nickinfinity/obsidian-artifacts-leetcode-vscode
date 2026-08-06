import * as assert from 'node:assert';
import { isContained, isLeetCodeArtifact, migrateArtifact, parseMigrateArgs, unifiedDiff } from '../src/services/artifact-migrator.helpers.js';
import { patchFrontmatterField } from '../src/services/frontmatter-patcher.service.js';
import { parseLeetCode } from '../src/services/leetcode-parser.service.js';

/**
 * T8 — the v1 → v2 vault migrator.
 *
 * The oracle is the Wave-1 golden capture: for each real artifact, the migrated
 * text must parse to **exactly** what the v1 parser produced from the v1 text.
 * That is a far stronger claim than "the output looks like v2", and it is the
 * only claim available — by now the parser *is* v2 and refuses v1 by design, so
 * there is nothing to compare against at runtime.
 *
 * v1 sources below are the real vault artifacts, copied inline (a test must
 * never walk a vault directory). Expected JSON is copied from the Wave-1
 * capture. Neither was hand-written.
 */
suite('migrate-artifact-format', () => {
	const V1_FUNCTION = "---\ntype: leetcode\ntitle: Max Subarray\ndifficulty: medium\nalgorithm: kadane\nstatus: unsolved\ntags: [leetcode, coderbyte, arrays, medium]\n---\nHave the function `MaxSubarray(arr)` take the array of numbers stored in `arr` and\ndetermine the largest sum that can be formed by any contiguous subarray. For example,\nif `arr` is `[-2, 5, -1, 7, -3]` the program returns `11` because the sum is formed by\nthe subarray `[5, -1, 7]`.\n\n```yaml leetcode\nfunction: MaxSubarray\nparams:\n  - name: arr\n    type: int[]\nreturns: int\n```\n\n## Examples\n\n```example\ninput: arr = [1, -2, 0, 3]\noutput: 3\n```\n\n```example\ninput: arr = [3, -1, -1, 4, 3, -1]\noutput: 8\n```\n\n```yaml leetcode\ntest:\n  type: function\n  timeoutMs: 5000\n```\n\n## Tests\n\n```json\n[\n  { \"input\": { \"arr\": [1, -2, 0, 3] }, \"expected\": 3 },\n  { \"input\": { \"arr\": [3, -1, -1, 4, 3, -1] }, \"expected\": 8 },\n  { \"input\": { \"arr\": [-2, 5, -1, 7, -3] }, \"expected\": 11 },\n  { \"input\": { \"arr\": [-1, -2, -3] }, \"expected\": -1 },\n  { \"input\": { \"arr\": [5] }, \"expected\": 5 },\n  { \"input\": { \"arr\": [1, 2, 3, 4] }, \"expected\": 10 }\n]\n```\n\n## Final Tests\n\n```json\n[\n  { \"input\": { \"arr\": [-5, 4, -1, 7, -8] }, \"expected\": 10 },\n  { \"input\": { \"arr\": [2, -1, 2, -1, 2] }, \"expected\": 4 },\n  { \"input\": { \"arr\": [0, 0, 0] }, \"expected\": 0 }\n]\n```\n\n# Setup\n\n## Java\n\n```java\npublic static int MaxSubarray(int[] arr) {\n    // your code here\n    return 0;\n}\n```\n\n## Python\n\n```python\ndef MaxSubarray(arr):\n    # your code here\n    return 0\n```\n\n## JavaScript\n\n```javascript\nfunction MaxSubarray(arr) {\n    // your code here\n    return 0;\n}\n```\n\n## TypeScript\n\n```typescript\nfunction MaxSubarray(arr: number[]): number {\n    // your code here\n    return 0;\n}\n```\n\n## Rust\n\n```rust\nfn MaxSubarray(arr: Vec<i32>) -> i32 {\n    // your code here\n    0\n}\n```\n\n# Solutions\n\n## Java\n\n```java\npublic static int MaxSubarray(int[] arr) {\n    int best = arr[0];\n    int cur = arr[0];\n    for (int i = 1; i < arr.length; i++) {\n        cur = Math.max(arr[i], cur + arr[i]);\n        best = Math.max(best, cur);\n    }\n    return best;\n}\n```\n\n## Python\n\n```python\ndef MaxSubarray(arr):\n    best = arr[0]\n    cur = arr[0]\n    for i in range(1, len(arr)):\n        cur = max(arr[i], cur + arr[i])\n        best = max(best, cur)\n    return best\n```\n\n## JavaScript\n\n```javascript\nfunction MaxSubarray(arr) {\n    let best = arr[0];\n    let cur = arr[0];\n    for (let i = 1; i < arr.length; i++) {\n        cur = Math.max(arr[i], cur + arr[i]);\n        best = Math.max(best, cur);\n    }\n    return best;\n}\n```\n\n## TypeScript\n\n```typescript\nfunction MaxSubarray(arr: number[]): number {\n    let best = arr[0];\n    let cur = arr[0];\n    for (let i = 1; i < arr.length; i++) {\n        cur = Math.max(arr[i], cur + arr[i]);\n        best = Math.max(best, cur);\n    }\n    return best;\n}\n```\n\n## Rust\n\n```rust\nfn MaxSubarray(arr: Vec<i32>) -> i32 {\n    let mut best = arr[0];\n    let mut cur = arr[0];\n    for i in 1..arr.len() {\n        cur = arr[i].max(cur + arr[i]);\n        best = best.max(cur);\n    }\n    best\n}\n```\n";
	const V1_PROJECT = "---\ntype: leetcode\ntitle: React Counter (project smoke)\ndifficulty: easy\nalgorithm: state\nstatus: unsolved\ntags: [react, project, smoke]\n---\n\nThe smallest runnable `project` exercise: one component, one `dom-assert` check.\nIt exists so the multi-file path can be opened, run and graded end to end — start\nhere when checking that the `project` type still works.\n\nLike every real exercise it ships **unsolved**: `## Files` is the starter and the\n`# Solutions` fence carrying `path=src/App.jsx` is the reference overlay, so\n`verify-exercise.mjs` grades the overlay green while a solver's own run starts\nred. It previously shipped complete, which meant *Solve It* → *Submit* marked the\nrun solved without a line being written.\n\nBuild a counter in `src/App.jsx`:\n\n- a `<button>` labelled `+1` that increments a count held in component state,\n- a `<span id=\"count\">` showing the current count,\n- the count starts at `0`.\n\nEach graded case **remounts** the component, so a case that clicks twice sees\n`2` — state never carries over from the previous case.\n\n## Examples\n\n```example\ninput: clicks = 0\noutput: \"0\"\n```\n\n```example\ninput: clicks = 1\noutput: \"1\"\n```\n\n```yaml leetcode\nlibs:\n  javascript:\n    - react@^19.0.0\n    - react-dom@^19.0.0\ntest:\n  type: project\n  timeoutMs: 10000\n  checks:\n    - name: counter\n      kind: dom-assert\n      file: src/App.jsx\npractice:\n  timeLimit: 15\n  options: [noCompletion]\n```\n\n## Tests\n\n```json check=counter\n[\n  { \"input\": { \"steps\": [{ \"op\": \"text\", \"selector\": \"#count\" }] }, \"expected\": \"0\" },\n  { \"input\": { \"steps\": [{ \"op\": \"click\", \"selector\": \"button\" }, { \"op\": \"text\", \"selector\": \"#count\" }] }, \"expected\": \"1\" },\n  { \"input\": { \"steps\": [{ \"op\": \"count\", \"selector\": \"button\" }] }, \"expected\": 1 }\n]\n```\n\n## Final Tests\n\n```json check=counter\n[\n  { \"input\": { \"steps\": [\n      { \"op\": \"click\", \"selector\": \"button\" },\n      { \"op\": \"click\", \"selector\": \"button\" },\n      { \"op\": \"click\", \"selector\": \"button\" },\n      { \"op\": \"text\", \"selector\": \"#count\" }] }, \"expected\": \"3\" }\n]\n```\n\n## Files\n\n```javascript path=src/App.jsx role=editable\nimport { useState } from 'react';\n\n/** Counter with a single increment button. */\nexport default function App() {\n  // TODO: hold the count in state, start it at 0, and increment it on click.\n  return (\n    <div>\n      <button>+1</button>\n      <span id=\"count\"></span>\n    </div>\n  );\n}\n```\n\n```css path=src/app.css role=hidden\n/* Ungraded scaffolding — no check reads this file. */\nbutton { font: inherit; }\n```\n\n# Solutions\n\n## JavaScript\n\nThe fence carries `path=` so it **overlays** `src/App.jsx` when the harness grades\nthe reference; a solver's run never applies it.\n\n```javascript path=src/App.jsx\nimport { useState } from 'react';\n\n/** Counter with a single increment button. */\nexport default function App() {\n  const [count, setCount] = useState(0);\n  return (\n    <div>\n      <button onClick={() => setCount(count + 1)}>+1</button>\n      <span id=\"count\">{String(count)}</span>\n    </div>\n  );\n}\n```\n";
	const V1_SERVICE = "---\ntype: leetcode\ntitle: Priced Items API + React Consumer (FastAPI)\ndifficulty: hard\nalgorithm: filtering\ntags: [fastapi, python, react, typescript, multi-language, service, spike]\n---\n\n> ⚠️ **Contract-only spike artifact.** `test.type: service` is a **reserved** type — no\n> environment is registered and no server is ever booted, so this exercise parses, lists,\n> and explains itself in the panel, but cannot be run yet. It exists to prove the running-server\n> contract ([plan §7](../../../../docs/plans/rust-multilang/plan.md)) against a real artifact;\n> the gaps it exposes are recorded in\n> [spike-findings.md](../../../../docs/plans/rust-multilang/spike-findings.md).\n\nThe **multi-language** service demonstration: a Python (FastAPI) backend and a TypeScript\n(React + Vite) frontend graded as one exercise. Two runtimes, one artifact, one Submit.\n\nTwo things are graded:\n\n1. **`GET /items?maxPrice=<n>`** in `server/main.py` — return every item priced **at or below**\n   `maxPrice`, cheapest first, as `{\"items\": [...]}`. Graded by `http` checks fired from the\n   extension host against the booted server, with the cases below.\n2. **The frontend still type-checks** — `npx tsc --noEmit` in `client/` must exit 0\n   (`build` check).\n\nYou never write the wiring. The extension picks a free port for each service, boots them in\ndependency order, and writes `client/.env.local` with `VITE_API_URL` **before** the frontend\nstarts — that file is `hidden`, so it never appears in your tabs.\n\n## Examples\n\n```example\ninput: GET /items?maxPrice=20\noutput: {\"items\": [{\"name\": \"cable\", \"price\": 5.0}, {\"name\": \"mouse\", \"price\": 18.5}]}\n```\n\n```example\ninput: GET /items?maxPrice=1\noutput: {\"items\": []}\n```\n\n```yaml leetcode\nlibs:\n  python:\n    - fastapi>=0.115,<0.116\n    - uvicorn>=0.32,<0.33\n  typescript:\n    - react@^19.0.0\n    - react-dom@^19.0.0\n    - typescript@^5.9.0\n    - vite@^7.0.0\n    - \"@types/react@^19.0.0\"\ntest:\n  type: service\n  runtime: local\n  timeoutMs: 15000\n  checks:\n    - name: api filters by price\n      kind: http\n      service: api\n    - name: web builds\n      kind: build\n      dir: client\n      argv: [\"npx\", \"tsc\", \"--noEmit\"]\nservices:\n  - name: api\n    dir: server\n    install: [\"pip\", \"install\", \"-r\", \"requirements.txt\"]\n    start: [\"uvicorn\", \"main:app\", \"--host\", \"127.0.0.1\", \"--port\", \"${PORT}\"]\n    ready: \"Uvicorn running\"\n    exposeAs:\n      VITE_API_URL: \"http://127.0.0.1:${PORT}\"\n  - name: web\n    dir: client\n    install: [\"npm\", \"ci\"]\n    start: [\"npm\", \"run\", \"dev\", \"--\", \"--port\", \"${PORT}\", \"--host\", \"127.0.0.1\"]\n    ready: \"ready in\"\n    envFile: .env.local\n    dependsOn: [api]\npractice:\n  timeLimit: 60\n  options: [noCompletion, noAiAgents]\n```\n\n## Tests\n\n```json\n[\n  {\n    \"input\": { \"path\": \"/items?maxPrice=20\" },\n    \"expected\": { \"items\": [{ \"name\": \"cable\", \"price\": 5.0 }, { \"name\": \"mouse\", \"price\": 18.5 }] }\n  },\n  {\n    \"input\": { \"path\": \"/items?maxPrice=1\" },\n    \"expected\": { \"items\": [] }\n  }\n]\n```\n\n## Final Tests\n\n```json\n[\n  {\n    \"input\": { \"path\": \"/items?maxPrice=1000\" },\n    \"expected\": {\n      \"items\": [\n        { \"name\": \"cable\", \"price\": 5.0 },\n        { \"name\": \"mouse\", \"price\": 18.5 },\n        { \"name\": \"keyboard\", \"price\": 45.0 },\n        { \"name\": \"monitor\", \"price\": 220.0 }\n      ]\n    }\n  },\n  {\n    \"input\": { \"path\": \"/items?maxPrice=45\" },\n    \"expected\": {\n      \"items\": [\n        { \"name\": \"cable\", \"price\": 5.0 },\n        { \"name\": \"mouse\", \"price\": 18.5 },\n        { \"name\": \"keyboard\", \"price\": 45.0 }\n      ]\n    }\n  }\n]\n```\n\n## Files\n\n```python path=server/main.py role=editable\nfrom fastapi import FastAPI\n\napp = FastAPI()\n\n# The catalogue this exercise ships with — data, not your work.\nITEMS = [\n    {\"name\": \"keyboard\", \"price\": 45.0},\n    {\"name\": \"mouse\", \"price\": 18.5},\n    {\"name\": \"monitor\", \"price\": 220.0},\n    {\"name\": \"cable\", \"price\": 5.0},\n]\n\n\n@app.get(\"/items\")\ndef list_items(maxPrice: float = 1e9):\n    # your code here — items priced <= maxPrice, cheapest first\n    return {\"items\": []}\n```\n\n```text path=server/requirements.txt role=hidden\nfastapi==0.115.*\nuvicorn==0.32.*\n```\n\n```typescript path=client/src/ItemList.tsx role=editable\nexport interface Item {\n  name: string;\n  price: number;\n}\n\n/** Renders one `<li>` per item: name, then price with two decimals. */\nexport function ItemList({ items }: { items: Item[] }) {\n  // your code here\n  return <ul />;\n}\n```\n\n```typescript path=client/src/App.tsx role=editable\nimport { useEffect, useState } from 'react';\nimport { ItemList, type Item } from './ItemList';\n\n/** The API base URL is injected by the extension — never hardcode a port. */\nconst API_URL = import.meta.env.VITE_API_URL as string;\n\nexport default function App() {\n  const [items, setItems] = useState<Item[]>([]);\n\n  useEffect(() => {\n    // your code here — fetch `${API_URL}/items?maxPrice=100` and store `items`\n  }, []);\n\n  return <ItemList items={items} />;\n}\n```\n\n```json path=client/package.json role=hidden\n{\n  \"name\": \"priced-items-client\",\n  \"private\": true,\n  \"type\": \"module\",\n  \"scripts\": { \"dev\": \"vite\", \"build\": \"tsc --noEmit && vite build\" },\n  \"dependencies\": { \"react\": \"^19.0.0\", \"react-dom\": \"^19.0.0\" },\n  \"devDependencies\": { \"typescript\": \"^5.9.0\", \"vite\": \"^7.0.0\", \"@types/react\": \"^19.0.0\" }\n}\n```\n\n```text path=client/.env.local role=hidden\nVITE_API_URL=http://127.0.0.1:${PORT}\n```\n\n# Solutions\n\n> ⚠️ **Illustrative fragments, not overlays.** No fence here carries `path=`, so\n> `solutionFiles` parses **empty** and there is no reference tree — deliberately. They are\n> excerpts, and an overlay replaces a file *whole*, so a `path=` would write a broken one.\n>\n> This artifact needs **three** things that do not exist yet, which is why it is a spike:\n> a `service` environment (none is registered, so nothing is executed), a **Python** project\n> environment, and a Python package installer — `installLibs` shells `npm install` only, so\n> its `libs.python` entries are skipped with a parser warning rather than served from the\n> wrong registry.\n>\n> **When those ship**, these fences must become complete files carrying `path=`, verified\n> green. Until then, treat them as documentation.\n\n## Python\n\n```python\n@app.get(\"/items\")\ndef list_items(maxPrice: float = 1e9):\n    matching = [item for item in ITEMS if item[\"price\"] <= maxPrice]\n    return {\"items\": sorted(matching, key=lambda item: item[\"price\"])}\n```\n\n## TypeScript\n\n```typescript\nexport function ItemList({ items }: { items: Item[] }) {\n  return (\n    <ul>\n      {items.map(item => (\n        <li key={item.name}>\n          {item.name} — {item.price.toFixed(2)}\n        </li>\n      ))}\n    </ul>\n  );\n}\n\nexport default function App() {\n  const [items, setItems] = useState<Item[]>([]);\n\n  useEffect(() => {\n    fetch(`${API_URL}/items?maxPrice=100`)\n      .then(res => res.json())\n      .then((body: { items: Item[] }) => setItems(body.items))\n      .catch(() => setItems([]));\n  }, []);\n\n  return <ItemList items={items} />;\n}\n```\n";
	const V1_FUNCTIONS = "---\ntype: leetcode\ntitle: Two Sum\ndifficulty: easy\nalgorithm: hash-map\ntags: [leetcode, arrays, hash-map]\n---\n\nGiven an array of integers `nums` and an integer `target`, return the indices\nof the two numbers that add up to `target`. Each input has exactly one\nsolution, and the same element may not be used twice. Return the indices in\nthe order they are found while scanning left to right.\n\n```yaml leetcode\nfunction: twoSum\nfunctions:\n  rust: two_sum\nparams:\n  - name: nums\n    type: int[]\n  - name: target\n    type: int\nreturns: int[]\n```\n\n## Examples\n\n```example\ninput: nums = [2,7,11,15], target = 9\noutput: [0,1]\n```\n\n```example\ninput: nums = [3,2,4], target = 6\noutput: [1,2]\n```\n\n```yaml leetcode\ntest:\n  type: function\n  timeoutMs: 5000\n```\n\n## Tests\n\n```json\n[\n  { \"input\": { \"nums\": [2, 7, 11, 15], \"target\": 9 }, \"expected\": [0, 1] },\n  { \"input\": { \"nums\": [3, 2, 4], \"target\": 6 }, \"expected\": [1, 2] },\n  { \"input\": { \"nums\": [0, 4, 3, 0], \"target\": 0 }, \"expected\": [0, 3] },\n  { \"input\": { \"nums\": [1, 5, 7, 9], \"target\": 16 }, \"expected\": [2, 3] },\n  { \"input\": { \"nums\": [2, 5, 5, 11], \"target\": 10 }, \"expected\": [1, 2] },\n  { \"input\": { \"nums\": [1, 2], \"target\": 3 }, \"expected\": [0, 1] }\n]\n```\n\n## Final Tests\n\n```json\n[\n  { \"input\": { \"nums\": [3, 3], \"target\": 6 }, \"expected\": [0, 1] },\n  { \"input\": { \"nums\": [-1, -2, -3, -4, -5], \"target\": -8 }, \"expected\": [2, 4] },\n  { \"input\": { \"nums\": [10, 20, 30, 40], \"target\": 70 }, \"expected\": [2, 3] }\n]\n```\n\n# Setup\n\n## Java\n\n```java\npublic static int[] twoSum(int[] nums, int target) {\n    // your code here\n    return new int[]{};\n}\n```\n\n## Python\n\n```python\ndef twoSum(nums, target):\n    # your code here\n    return []\n```\n\n## JavaScript\n\n```javascript\nfunction twoSum(nums, target) {\n  // your code here\n  return [];\n}\n```\n\n## Rust\n\n```rust\nfn two_sum(nums: Vec<i32>, target: i32) -> Vec<i32> {\n    // your code here\n    vec![]\n}\n```\n\n## TS\n\n```typescript\nfunction twoSum(nums: number[], target: number): number[] {\n  // your code here\n  return [];\n}\n```\n\n# Solutions\n\n## Java\n\n### Hash Map\n```java\nimport java.util.HashMap;\nimport java.util.Map;\n\npublic static int[] twoSum(int[] nums, int target) {\n    Map<Integer, Integer> seen = new HashMap<>();\n    for (int i = 0; i < nums.length; i++) {\n        int complement = target - nums[i];\n        if (seen.containsKey(complement)) {\n            return new int[]{seen.get(complement), i};\n        }\n        seen.put(nums[i], i);\n    }\n    return new int[]{};\n}\n```\n\n## Python\n\n### Hash Map\n```python\ndef twoSum(nums, target):\n    seen = {}\n    for i, num in enumerate(nums):\n        complement = target - num\n        if complement in seen:\n            return [seen[complement], i]\n        seen[num] = i\n    return []\n```\n\n## JavaScript\n\n### Hash Map\n```javascript\nfunction twoSum(nums, target) {\n  const seen = new Map();\n  for (let i = 0; i < nums.length; i++) {\n    const complement = target - nums[i];\n    if (seen.has(complement)) {\n      return [seen.get(complement), i];\n    }\n    seen.set(nums[i], i);\n  }\n  return [];\n}\n```\n\n## Rust\n\n### Hash Map\n```rust\nuse std::collections::HashMap;\n\nfn two_sum(nums: Vec<i32>, target: i32) -> Vec<i32> {\n    let mut seen: HashMap<i32, i32> = HashMap::new();\n    for (i, &num) in nums.iter().enumerate() {\n        let complement = target - num;\n        if let Some(&j) = seen.get(&complement) {\n            return vec![j, i as i32];\n        }\n        seen.insert(num, i as i32);\n    }\n    vec![]\n}\n```\n\n## TS\n\n### Hash Map\n```typescript\nfunction twoSum(nums: number[], target: number): number[] {\n  const seen = new Map<number, number>();\n  for (let i = 0; i < nums.length; i++) {\n    const complement = target - nums[i];\n    if (seen.has(complement)) {\n      return [seen.get(complement) as number, i];\n    }\n    seen.set(nums[i], i);\n  }\n  return [];\n}\n```\n";

	// ── the oracle: migrated v1 parses to the captured v1 result ──────────────

	test('function — Max Subarray.md — migrated output parses to the Wave-1 capture', () => {
		assert.strictEqual(JSON.stringify(parseLeetCode(migrateArtifact(V1_FUNCTION))), "{\"title\":\"Max Subarray\",\"leetcodeType\":\"function\",\"difficulty\":\"medium\",\"functionName\":\"MaxSubarray\",\"algorithm\":\"kadane\",\"status\":\"unsolved\",\"params\":[{\"name\":\"arr\",\"type\":\"int[]\"}],\"returns\":\"int\",\"description\":\"Have the function `MaxSubarray(arr)` take the array of numbers stored in `arr` and\\ndetermine the largest sum that can be formed by any contiguous subarray. For example,\\nif `arr` is `[-2, 5, -1, 7, -3]` the program returns `11` because the sum is formed by\\nthe subarray `[5, -1, 7]`.\",\"examples\":[{\"input\":\"arr = [1, -2, 0, 3]\",\"output\":\"3\"},{\"input\":\"arr = [3, -1, -1, 4, 3, -1]\",\"output\":\"8\"}],\"tests\":[{\"input\":{\"arr\":[1,-2,0,3]},\"expected\":3},{\"input\":{\"arr\":[3,-1,-1,4,3,-1]},\"expected\":8},{\"input\":{\"arr\":[-2,5,-1,7,-3]},\"expected\":11},{\"input\":{\"arr\":[-1,-2,-3]},\"expected\":-1},{\"input\":{\"arr\":[5]},\"expected\":5},{\"input\":{\"arr\":[1,2,3,4]},\"expected\":10}],\"finalTests\":[{\"input\":{\"arr\":[-5,4,-1,7,-8]},\"expected\":10},{\"input\":{\"arr\":[2,-1,2,-1,2]},\"expected\":4},{\"input\":{\"arr\":[0,0,0]},\"expected\":0}],\"test\":{\"type\":\"function\",\"timeoutMs\":5000},\"setups\":[{\"language\":\"java\",\"code\":\"public static int MaxSubarray(int[] arr) {\\n    // your code here\\n    return 0;\\n}\"},{\"language\":\"python\",\"code\":\"def MaxSubarray(arr):\\n    # your code here\\n    return 0\"},{\"language\":\"javascript\",\"code\":\"function MaxSubarray(arr) {\\n    // your code here\\n    return 0;\\n}\"},{\"language\":\"typescript\",\"code\":\"function MaxSubarray(arr: number[]): number {\\n    // your code here\\n    return 0;\\n}\"},{\"language\":\"rust\",\"code\":\"fn MaxSubarray(arr: Vec<i32>) -> i32 {\\n    // your code here\\n    0\\n}\"}],\"practice\":{\"options\":[\"noCompletion\",\"noAiAgents\"],\"timeLimitMinutes\":0,\"locked\":false},\"solutions\":[{\"language\":\"java\",\"code\":\"public static int MaxSubarray(int[] arr) {\\n    int best = arr[0];\\n    int cur = arr[0];\\n    for (int i = 1; i < arr.length; i++) {\\n        cur = Math.max(arr[i], cur + arr[i]);\\n        best = Math.max(best, cur);\\n    }\\n    return best;\\n}\"},{\"language\":\"python\",\"code\":\"def MaxSubarray(arr):\\n    best = arr[0]\\n    cur = arr[0]\\n    for i in range(1, len(arr)):\\n        cur = max(arr[i], cur + arr[i])\\n        best = max(best, cur)\\n    return best\"},{\"language\":\"javascript\",\"code\":\"function MaxSubarray(arr) {\\n    let best = arr[0];\\n    let cur = arr[0];\\n    for (let i = 1; i < arr.length; i++) {\\n        cur = Math.max(arr[i], cur + arr[i]);\\n        best = Math.max(best, cur);\\n    }\\n    return best;\\n}\"},{\"language\":\"typescript\",\"code\":\"function MaxSubarray(arr: number[]): number {\\n    let best = arr[0];\\n    let cur = arr[0];\\n    for (let i = 1; i < arr.length; i++) {\\n        cur = Math.max(arr[i], cur + arr[i]);\\n        best = Math.max(best, cur);\\n    }\\n    return best;\\n}\"},{\"language\":\"rust\",\"code\":\"fn MaxSubarray(arr: Vec<i32>) -> i32 {\\n    let mut best = arr[0];\\n    let mut cur = arr[0];\\n    for i in 1..arr.len() {\\n        cur = arr[i].max(cur + arr[i]);\\n        best = best.max(cur);\\n    }\\n    best\\n}\"}],\"attempts\":[],\"tags\":[\"leetcode\",\"coderbyte\",\"arrays\",\"medium\"]}");
	});

	test('project — react-counter.md — migrated output parses to the Wave-1 capture', () => {
		assert.strictEqual(JSON.stringify(parseLeetCode(migrateArtifact(V1_PROJECT))), "{\"title\":\"React Counter (project smoke)\",\"leetcodeType\":\"package\",\"difficulty\":\"easy\",\"functionName\":\"\",\"algorithm\":\"state\",\"status\":\"unsolved\",\"params\":[],\"returns\":\"\",\"description\":\"The smallest runnable `project` exercise: one component, one `dom-assert` check.\\nIt exists so the multi-file path can be opened, run and graded end to end — start\\nhere when checking that the `project` type still works.\\n\\nLike every real exercise it ships **unsolved**: `## Files` is the starter and the\\n`# Solutions` fence carrying `path=src/App.jsx` is the reference overlay, so\\n`verify-exercise.mjs` grades the overlay green while a solver's own run starts\\nred. It previously shipped complete, which meant *Solve It* → *Submit* marked the\\nrun solved without a line being written.\\n\\nBuild a counter in `src/App.jsx`:\\n\\n- a `<button>` labelled `+1` that increments a count held in component state,\\n- a `<span id=\\\"count\\\">` showing the current count,\\n- the count starts at `0`.\\n\\nEach graded case **remounts** the component, so a case that clicks twice sees\\n`2` — state never carries over from the previous case.\",\"examples\":[{\"input\":\"clicks = 0\",\"output\":\"\\\"0\\\"\"},{\"input\":\"clicks = 1\",\"output\":\"\\\"1\\\"\"}],\"tests\":[{\"input\":{\"steps\":[{\"op\":\"text\",\"selector\":\"#count\"}]},\"expected\":\"0\"},{\"input\":{\"steps\":[{\"op\":\"click\",\"selector\":\"button\"},{\"op\":\"text\",\"selector\":\"#count\"}]},\"expected\":\"1\"},{\"input\":{\"steps\":[{\"op\":\"count\",\"selector\":\"button\"}]},\"expected\":1}],\"finalTests\":[{\"input\":{\"steps\":[{\"op\":\"click\",\"selector\":\"button\"},{\"op\":\"click\",\"selector\":\"button\"},{\"op\":\"click\",\"selector\":\"button\"},{\"op\":\"text\",\"selector\":\"#count\"}]},\"expected\":\"3\"}],\"test\":{\"type\":\"project\",\"timeoutMs\":10000},\"setups\":[],\"practice\":{\"options\":[\"noCompletion\"],\"timeLimitMinutes\":15,\"locked\":false},\"solutions\":[],\"attempts\":[],\"tags\":[\"react\",\"project\",\"smoke\"],\"files\":[{\"path\":\"src/App.jsx\",\"language\":\"javascript\",\"role\":\"editable\",\"content\":\"import { useState } from 'react';\\n\\n/** Counter with a single increment button. */\\nexport default function App() {\\n  // TODO: hold the count in state, start it at 0, and increment it on click.\\n  return (\\n    <div>\\n      <button>+1</button>\\n      <span id=\\\"count\\\"></span>\\n    </div>\\n  );\\n}\\n\"},{\"path\":\"src/app.css\",\"language\":\"css\",\"role\":\"hidden\",\"content\":\"/* Ungraded scaffolding — no check reads this file. */\\nbutton { font: inherit; }\\n\"}],\"libs\":{\"javascript\":[\"react@^19.0.0\",\"react-dom@^19.0.0\"]},\"checks\":[{\"name\":\"counter\",\"kind\":\"dom-assert\",\"file\":\"src/App.jsx\",\"cases\":[{\"input\":{\"steps\":[{\"op\":\"text\",\"selector\":\"#count\"}]},\"expected\":\"0\"},{\"input\":{\"steps\":[{\"op\":\"click\",\"selector\":\"button\"},{\"op\":\"text\",\"selector\":\"#count\"}]},\"expected\":\"1\"},{\"input\":{\"steps\":[{\"op\":\"count\",\"selector\":\"button\"}]},\"expected\":1},{\"input\":{\"steps\":[{\"op\":\"click\",\"selector\":\"button\"},{\"op\":\"click\",\"selector\":\"button\"},{\"op\":\"click\",\"selector\":\"button\"},{\"op\":\"text\",\"selector\":\"#count\"}]},\"expected\":\"3\"}],\"publicCount\":3}],\"solutionFiles\":[{\"path\":\"src/App.jsx\",\"language\":\"javascript\",\"role\":\"editable\",\"content\":\"import { useState } from 'react';\\n\\n/** Counter with a single increment button. */\\nexport default function App() {\\n  const [count, setCount] = useState(0);\\n  return (\\n    <div>\\n      <button onClick={() => setCount(count + 1)}>+1</button>\\n      <span id=\\\"count\\\">{String(count)}</span>\\n    </div>\\n  );\\n}\\n\"}],\"warnings\":[]}");
	});

	test('service — fastapi-react.md — migrated output parses to the Wave-1 capture', () => {
		assert.strictEqual(JSON.stringify(parseLeetCode(migrateArtifact(V1_SERVICE))), "{\"title\":\"Priced Items API + React Consumer (FastAPI)\",\"leetcodeType\":\"stack\",\"difficulty\":\"hard\",\"functionName\":\"\",\"algorithm\":\"filtering\",\"status\":\"unsolved\",\"params\":[],\"returns\":\"\",\"description\":\"> ⚠️ **Contract-only spike artifact.** `test.type: service` is a **reserved** type — no\\n> environment is registered and no server is ever booted, so this exercise parses, lists,\\n> and explains itself in the panel, but cannot be run yet. It exists to prove the running-server\\n> contract ([plan §7](../../../../docs/plans/rust-multilang/plan.md)) against a real artifact;\\n> the gaps it exposes are recorded in\\n> [spike-findings.md](../../../../docs/plans/rust-multilang/spike-findings.md).\\n\\nThe **multi-language** service demonstration: a Python (FastAPI) backend and a TypeScript\\n(React + Vite) frontend graded as one exercise. Two runtimes, one artifact, one Submit.\\n\\nTwo things are graded:\\n\\n1. **`GET /items?maxPrice=<n>`** in `server/main.py` — return every item priced **at or below**\\n   `maxPrice`, cheapest first, as `{\\\"items\\\": [...]}`. Graded by `http` checks fired from the\\n   extension host against the booted server, with the cases below.\\n2. **The frontend still type-checks** — `npx tsc --noEmit` in `client/` must exit 0\\n   (`build` check).\\n\\nYou never write the wiring. The extension picks a free port for each service, boots them in\\ndependency order, and writes `client/.env.local` with `VITE_API_URL` **before** the frontend\\nstarts — that file is `hidden`, so it never appears in your tabs.\",\"examples\":[{\"input\":\"GET /items?maxPrice=20\",\"output\":\"{\\\"items\\\": [{\\\"name\\\": \\\"cable\\\", \\\"price\\\": 5.0}, {\\\"name\\\": \\\"mouse\\\", \\\"price\\\": 18.5}]}\"},{\"input\":\"GET /items?maxPrice=1\",\"output\":\"{\\\"items\\\": []}\"}],\"tests\":[{\"input\":{\"path\":\"/items?maxPrice=20\"},\"expected\":{\"items\":[{\"name\":\"cable\",\"price\":5},{\"name\":\"mouse\",\"price\":18.5}]}},{\"input\":{\"path\":\"/items?maxPrice=1\"},\"expected\":{\"items\":[]}}],\"finalTests\":[{\"input\":{\"path\":\"/items?maxPrice=1000\"},\"expected\":{\"items\":[{\"name\":\"cable\",\"price\":5},{\"name\":\"mouse\",\"price\":18.5},{\"name\":\"keyboard\",\"price\":45},{\"name\":\"monitor\",\"price\":220}]}},{\"input\":{\"path\":\"/items?maxPrice=45\"},\"expected\":{\"items\":[{\"name\":\"cable\",\"price\":5},{\"name\":\"mouse\",\"price\":18.5},{\"name\":\"keyboard\",\"price\":45}]}}],\"test\":{\"type\":\"service\",\"timeoutMs\":15000},\"setups\":[],\"practice\":{\"options\":[\"noCompletion\",\"noAiAgents\"],\"timeLimitMinutes\":60,\"locked\":false},\"solutions\":[{\"language\":\"python\",\"code\":\"@app.get(\\\"/items\\\")\\ndef list_items(maxPrice: float = 1e9):\\n    matching = [item for item in ITEMS if item[\\\"price\\\"] <= maxPrice]\\n    return {\\\"items\\\": sorted(matching, key=lambda item: item[\\\"price\\\"])}\"},{\"language\":\"typescript\",\"code\":\"export function ItemList({ items }: { items: Item[] }) {\\n  return (\\n    <ul>\\n      {items.map(item => (\\n        <li key={item.name}>\\n          {item.name} — {item.price.toFixed(2)}\\n        </li>\\n      ))}\\n    </ul>\\n  );\\n}\\n\\nexport default function App() {\\n  const [items, setItems] = useState<Item[]>([]);\\n\\n  useEffect(() => {\\n    fetch(`${API_URL}/items?maxPrice=100`)\\n      .then(res => res.json())\\n      .then((body: { items: Item[] }) => setItems(body.items))\\n      .catch(() => setItems([]));\\n  }, []);\\n\\n  return <ItemList items={items} />;\\n}\"}],\"attempts\":[],\"tags\":[\"fastapi\",\"python\",\"react\",\"typescript\",\"multi-language\",\"service\",\"spike\"],\"files\":[{\"path\":\"server/main.py\",\"language\":\"python\",\"role\":\"editable\",\"content\":\"from fastapi import FastAPI\\n\\napp = FastAPI()\\n\\n# The catalogue this exercise ships with — data, not your work.\\nITEMS = [\\n    {\\\"name\\\": \\\"keyboard\\\", \\\"price\\\": 45.0},\\n    {\\\"name\\\": \\\"mouse\\\", \\\"price\\\": 18.5},\\n    {\\\"name\\\": \\\"monitor\\\", \\\"price\\\": 220.0},\\n    {\\\"name\\\": \\\"cable\\\", \\\"price\\\": 5.0},\\n]\\n\\n\\n@app.get(\\\"/items\\\")\\ndef list_items(maxPrice: float = 1e9):\\n    # your code here — items priced <= maxPrice, cheapest first\\n    return {\\\"items\\\": []}\\n\"},{\"path\":\"server/requirements.txt\",\"language\":\"text\",\"role\":\"hidden\",\"content\":\"fastapi==0.115.*\\nuvicorn==0.32.*\\n\"},{\"path\":\"client/src/ItemList.tsx\",\"language\":\"typescript\",\"role\":\"editable\",\"content\":\"export interface Item {\\n  name: string;\\n  price: number;\\n}\\n\\n/** Renders one `<li>` per item: name, then price with two decimals. */\\nexport function ItemList({ items }: { items: Item[] }) {\\n  // your code here\\n  return <ul />;\\n}\\n\"},{\"path\":\"client/src/App.tsx\",\"language\":\"typescript\",\"role\":\"editable\",\"content\":\"import { useEffect, useState } from 'react';\\nimport { ItemList, type Item } from './ItemList';\\n\\n/** The API base URL is injected by the extension — never hardcode a port. */\\nconst API_URL = import.meta.env.VITE_API_URL as string;\\n\\nexport default function App() {\\n  const [items, setItems] = useState<Item[]>([]);\\n\\n  useEffect(() => {\\n    // your code here — fetch `${API_URL}/items?maxPrice=100` and store `items`\\n  }, []);\\n\\n  return <ItemList items={items} />;\\n}\\n\"},{\"path\":\"client/package.json\",\"language\":\"json\",\"role\":\"hidden\",\"content\":\"{\\n  \\\"name\\\": \\\"priced-items-client\\\",\\n  \\\"private\\\": true,\\n  \\\"type\\\": \\\"module\\\",\\n  \\\"scripts\\\": { \\\"dev\\\": \\\"vite\\\", \\\"build\\\": \\\"tsc --noEmit && vite build\\\" },\\n  \\\"dependencies\\\": { \\\"react\\\": \\\"^19.0.0\\\", \\\"react-dom\\\": \\\"^19.0.0\\\" },\\n  \\\"devDependencies\\\": { \\\"typescript\\\": \\\"^5.9.0\\\", \\\"vite\\\": \\\"^7.0.0\\\", \\\"@types/react\\\": \\\"^19.0.0\\\" }\\n}\\n\"},{\"path\":\"client/.env.local\",\"language\":\"text\",\"role\":\"hidden\",\"content\":\"VITE_API_URL=http://127.0.0.1:${PORT}\\n\"}],\"libs\":{\"python\":[\"fastapi>=0.115,<0.116\",\"uvicorn>=0.32,<0.33\"],\"typescript\":[\"react@^19.0.0\",\"react-dom@^19.0.0\",\"typescript@^5.9.0\",\"vite@^7.0.0\",\"@types/react@^19.0.0\"]},\"checks\":[{\"name\":\"web builds\",\"kind\":\"build\",\"argv\":[\"npx\",\"tsc\",\"--noEmit\"],\"cases\":[{\"input\":{\"path\":\"/items?maxPrice=20\"},\"expected\":{\"items\":[{\"name\":\"cable\",\"price\":5},{\"name\":\"mouse\",\"price\":18.5}]}},{\"input\":{\"path\":\"/items?maxPrice=1\"},\"expected\":{\"items\":[]}},{\"input\":{\"path\":\"/items?maxPrice=1000\"},\"expected\":{\"items\":[{\"name\":\"cable\",\"price\":5},{\"name\":\"mouse\",\"price\":18.5},{\"name\":\"keyboard\",\"price\":45},{\"name\":\"monitor\",\"price\":220}]}},{\"input\":{\"path\":\"/items?maxPrice=45\"},\"expected\":{\"items\":[{\"name\":\"cable\",\"price\":5},{\"name\":\"mouse\",\"price\":18.5},{\"name\":\"keyboard\",\"price\":45}]}}],\"publicCount\":2,\"dir\":\"client\"}],\"solutionFiles\":[],\"warnings\":[\"checks: 'api filters by price' declares kind 'http', which no environment implements yet — dropped\"]}");
	});

	test('function — two-sum.md (functions: override) — migrated output parses to the Wave-1 capture', () => {
		assert.strictEqual(JSON.stringify(parseLeetCode(migrateArtifact(V1_FUNCTIONS))), "{\"title\":\"Two Sum\",\"leetcodeType\":\"function\",\"difficulty\":\"easy\",\"functionName\":\"twoSum\",\"functions\":{\"rust\":\"two_sum\"},\"algorithm\":\"hash-map\",\"status\":\"unsolved\",\"params\":[{\"name\":\"nums\",\"type\":\"int[]\"},{\"name\":\"target\",\"type\":\"int\"}],\"returns\":\"int[]\",\"description\":\"Given an array of integers `nums` and an integer `target`, return the indices\\nof the two numbers that add up to `target`. Each input has exactly one\\nsolution, and the same element may not be used twice. Return the indices in\\nthe order they are found while scanning left to right.\",\"examples\":[{\"input\":\"nums = [2,7,11,15], target = 9\",\"output\":\"[0,1]\"},{\"input\":\"nums = [3,2,4], target = 6\",\"output\":\"[1,2]\"}],\"tests\":[{\"input\":{\"nums\":[2,7,11,15],\"target\":9},\"expected\":[0,1]},{\"input\":{\"nums\":[3,2,4],\"target\":6},\"expected\":[1,2]},{\"input\":{\"nums\":[0,4,3,0],\"target\":0},\"expected\":[0,3]},{\"input\":{\"nums\":[1,5,7,9],\"target\":16},\"expected\":[2,3]},{\"input\":{\"nums\":[2,5,5,11],\"target\":10},\"expected\":[1,2]},{\"input\":{\"nums\":[1,2],\"target\":3},\"expected\":[0,1]}],\"finalTests\":[{\"input\":{\"nums\":[3,3],\"target\":6},\"expected\":[0,1]},{\"input\":{\"nums\":[-1,-2,-3,-4,-5],\"target\":-8},\"expected\":[2,4]},{\"input\":{\"nums\":[10,20,30,40],\"target\":70},\"expected\":[2,3]}],\"test\":{\"type\":\"function\",\"timeoutMs\":5000},\"setups\":[{\"language\":\"java\",\"code\":\"public static int[] twoSum(int[] nums, int target) {\\n    // your code here\\n    return new int[]{};\\n}\"},{\"language\":\"python\",\"code\":\"def twoSum(nums, target):\\n    # your code here\\n    return []\"},{\"language\":\"javascript\",\"code\":\"function twoSum(nums, target) {\\n  // your code here\\n  return [];\\n}\"},{\"language\":\"rust\",\"code\":\"fn two_sum(nums: Vec<i32>, target: i32) -> Vec<i32> {\\n    // your code here\\n    vec![]\\n}\"},{\"language\":\"ts\",\"code\":\"function twoSum(nums: number[], target: number): number[] {\\n  // your code here\\n  return [];\\n}\"}],\"practice\":{\"options\":[\"noCompletion\",\"noAiAgents\"],\"timeLimitMinutes\":0,\"locked\":false},\"solutions\":[{\"language\":\"java\",\"label\":\"Hash Map\",\"code\":\"import java.util.HashMap;\\nimport java.util.Map;\\n\\npublic static int[] twoSum(int[] nums, int target) {\\n    Map<Integer, Integer> seen = new HashMap<>();\\n    for (int i = 0; i < nums.length; i++) {\\n        int complement = target - nums[i];\\n        if (seen.containsKey(complement)) {\\n            return new int[]{seen.get(complement), i};\\n        }\\n        seen.put(nums[i], i);\\n    }\\n    return new int[]{};\\n}\"},{\"language\":\"python\",\"label\":\"Hash Map\",\"code\":\"def twoSum(nums, target):\\n    seen = {}\\n    for i, num in enumerate(nums):\\n        complement = target - num\\n        if complement in seen:\\n            return [seen[complement], i]\\n        seen[num] = i\\n    return []\"},{\"language\":\"javascript\",\"label\":\"Hash Map\",\"code\":\"function twoSum(nums, target) {\\n  const seen = new Map();\\n  for (let i = 0; i < nums.length; i++) {\\n    const complement = target - nums[i];\\n    if (seen.has(complement)) {\\n      return [seen.get(complement), i];\\n    }\\n    seen.set(nums[i], i);\\n  }\\n  return [];\\n}\"},{\"language\":\"rust\",\"label\":\"Hash Map\",\"code\":\"use std::collections::HashMap;\\n\\nfn two_sum(nums: Vec<i32>, target: i32) -> Vec<i32> {\\n    let mut seen: HashMap<i32, i32> = HashMap::new();\\n    for (i, &num) in nums.iter().enumerate() {\\n        let complement = target - num;\\n        if let Some(&j) = seen.get(&complement) {\\n            return vec![j, i as i32];\\n        }\\n        seen.insert(num, i as i32);\\n    }\\n    vec![]\\n}\"},{\"language\":\"ts\",\"label\":\"Hash Map\",\"code\":\"function twoSum(nums: number[], target: number): number[] {\\n  const seen = new Map<number, number>();\\n  for (let i = 0; i < nums.length; i++) {\\n    const complement = target - nums[i];\\n    if (seen.has(complement)) {\\n      return [seen.get(complement) as number, i];\\n    }\\n    seen.set(nums[i], i);\\n  }\\n  return [];\\n}\"}],\"attempts\":[],\"tags\":[\"leetcode\",\"arrays\",\"hash-map\"]}");
	});

	// ── idempotency, on all four real artifacts ───────────────────────────────

	test('function — Max Subarray.md — migrating twice is identical to migrating once', () => {
		const once = migrateArtifact(V1_FUNCTION);
		assert.strictEqual(migrateArtifact(once), once);
	});

	test('project — react-counter.md — migrating twice is identical to migrating once', () => {
		const once = migrateArtifact(V1_PROJECT);
		assert.strictEqual(migrateArtifact(once), once);
	});

	test('service — fastapi-react.md — migrating twice is identical to migrating once', () => {
		const once = migrateArtifact(V1_SERVICE);
		assert.strictEqual(migrateArtifact(once), once);
	});

	test('function — two-sum.md (functions: override) — migrating twice is identical to migrating once', () => {
		const once = migrateArtifact(V1_FUNCTIONS);
		assert.strictEqual(migrateArtifact(once), once);
	});

	// ── only declared keys get a fence ────────────────────────────────────────

	test('an artifact with no practice: gets no practice: fence', () => {
		// Max Subarray declares no practice block. Materialising one at its
		// defaults would be a semantic no-op that a human reviewing the vault
		// diff then has to read line by line across ~58 files.
		const out = migrateArtifact(V1_FUNCTION);
		assert.ok(!out.includes('practice:'), 'no practice: should appear anywhere in the output');
	});

	test('frontmatter keeps only retained keys; every body-set key leaves it', () => {
		const out = migrateArtifact(V1_FUNCTION);
		const fm = /^---\n([\s\S]*?)\n---/.exec(out);
		assert.ok(fm, 'output must still open with frontmatter');
		for (const key of ['function', 'params', 'returns', 'test']) {
			assert.ok(!new RegExp('^' + key + ':', 'm').test(fm[1]), key + ': must have left frontmatter');
		}
		assert.ok(/^title:/m.test(fm[1]), 'title: must stay');
		assert.ok(/^type: leetcode$/m.test(fm[1]), 'type: must stay');
	});

	test('the description survives byte-for-byte', () => {
		// The signature fence lands at the tail of the description slice, which
		// extractDescription trims — the reason placement is not free.
		assert.strictEqual(
			parseLeetCode(migrateArtifact(V1_FUNCTION)).description,
			JSON.parse("{\"title\":\"Max Subarray\",\"leetcodeType\":\"function\",\"difficulty\":\"medium\",\"functionName\":\"MaxSubarray\",\"algorithm\":\"kadane\",\"status\":\"unsolved\",\"params\":[{\"name\":\"arr\",\"type\":\"int[]\"}],\"returns\":\"int\",\"description\":\"Have the function `MaxSubarray(arr)` take the array of numbers stored in `arr` and\\ndetermine the largest sum that can be formed by any contiguous subarray. For example,\\nif `arr` is `[-2, 5, -1, 7, -3]` the program returns `11` because the sum is formed by\\nthe subarray `[5, -1, 7]`.\",\"examples\":[{\"input\":\"arr = [1, -2, 0, 3]\",\"output\":\"3\"},{\"input\":\"arr = [3, -1, -1, 4, 3, -1]\",\"output\":\"8\"}],\"tests\":[{\"input\":{\"arr\":[1,-2,0,3]},\"expected\":3},{\"input\":{\"arr\":[3,-1,-1,4,3,-1]},\"expected\":8},{\"input\":{\"arr\":[-2,5,-1,7,-3]},\"expected\":11},{\"input\":{\"arr\":[-1,-2,-3]},\"expected\":-1},{\"input\":{\"arr\":[5]},\"expected\":5},{\"input\":{\"arr\":[1,2,3,4]},\"expected\":10}],\"finalTests\":[{\"input\":{\"arr\":[-5,4,-1,7,-8]},\"expected\":10},{\"input\":{\"arr\":[2,-1,2,-1,2]},\"expected\":4},{\"input\":{\"arr\":[0,0,0]},\"expected\":0}],\"test\":{\"type\":\"function\",\"timeoutMs\":5000},\"setups\":[{\"language\":\"java\",\"code\":\"public static int MaxSubarray(int[] arr) {\\n    // your code here\\n    return 0;\\n}\"},{\"language\":\"python\",\"code\":\"def MaxSubarray(arr):\\n    # your code here\\n    return 0\"},{\"language\":\"javascript\",\"code\":\"function MaxSubarray(arr) {\\n    // your code here\\n    return 0;\\n}\"},{\"language\":\"typescript\",\"code\":\"function MaxSubarray(arr: number[]): number {\\n    // your code here\\n    return 0;\\n}\"},{\"language\":\"rust\",\"code\":\"fn MaxSubarray(arr: Vec<i32>) -> i32 {\\n    // your code here\\n    0\\n}\"}],\"practice\":{\"options\":[\"noCompletion\",\"noAiAgents\"],\"timeLimitMinutes\":0,\"locked\":false},\"solutions\":[{\"language\":\"java\",\"code\":\"public static int MaxSubarray(int[] arr) {\\n    int best = arr[0];\\n    int cur = arr[0];\\n    for (int i = 1; i < arr.length; i++) {\\n        cur = Math.max(arr[i], cur + arr[i]);\\n        best = Math.max(best, cur);\\n    }\\n    return best;\\n}\"},{\"language\":\"python\",\"code\":\"def MaxSubarray(arr):\\n    best = arr[0]\\n    cur = arr[0]\\n    for i in range(1, len(arr)):\\n        cur = max(arr[i], cur + arr[i])\\n        best = max(best, cur)\\n    return best\"},{\"language\":\"javascript\",\"code\":\"function MaxSubarray(arr) {\\n    let best = arr[0];\\n    let cur = arr[0];\\n    for (let i = 1; i < arr.length; i++) {\\n        cur = Math.max(arr[i], cur + arr[i]);\\n        best = Math.max(best, cur);\\n    }\\n    return best;\\n}\"},{\"language\":\"typescript\",\"code\":\"function MaxSubarray(arr: number[]): number {\\n    let best = arr[0];\\n    let cur = arr[0];\\n    for (let i = 1; i < arr.length; i++) {\\n        cur = Math.max(arr[i], cur + arr[i]);\\n        best = Math.max(best, cur);\\n    }\\n    return best;\\n}\"},{\"language\":\"rust\",\"code\":\"fn MaxSubarray(arr: Vec<i32>) -> i32 {\\n    let mut best = arr[0];\\n    let mut cur = arr[0];\\n    for i in 1..arr.len() {\\n        cur = arr[i].max(cur + arr[i]);\\n        best = best.max(cur);\\n    }\\n    best\\n}\"}],\"attempts\":[],\"tags\":[\"leetcode\",\"coderbyte\",\"arrays\",\"medium\"]}").description,
		);
	});

	// ── idempotency on already-v2 input, and inert inputs ─────────────────────

	test('an artifact with no body-set key in frontmatter is returned unchanged', () => {
		const clean = '---\ntype: leetcode\ntitle: X\n---\n\nProse.\n\n## Tests\n';
		assert.strictEqual(migrateArtifact(clean), clean);
	});

	test('text with no frontmatter at all is returned unchanged', () => {
		const bare = 'Just prose, no frontmatter.';
		assert.strictEqual(migrateArtifact(bare), bare);
	});

	test('a build-only project with no ## Tests anchors on ## Files instead', () => {
		// CoderByte/Tests/project/build-check-smoke.md is exactly this shape: a
		// build check needs no cases, so the artifact has ## Examples, ## Files
		// and # Solutions and no ## Tests at all. Anchoring only on ## Tests
		// refused a legitimate artifact class; the spec's placement table already
		// anchors a project's libs/services on ## Files.
		const buildOnly = [
			'---', 'type: leetcode', 'title: Build only',
			'test:', '  type: project', '---', '',
			'Prose.', '', '## Files', '', 'tree here', '',
		].join('\n');
		const out = migrateArtifact(buildOnly);
		const fenceAt = out.indexOf('```yaml leetcode');
		const filesAt = out.indexOf('## Files');
		assert.ok(fenceAt !== -1, 'the execution fence must be emitted');
		assert.ok(fenceAt < filesAt, 'and it must sit before ## Files');
		assert.strictEqual(parseLeetCode(out).test.type, 'project');
	});

	test('execution config with no anchor heading at all is appended, not lost', () => {
		const noHeadings = '---\ntype: leetcode\ntitle: X\ntest:\n  type: function\n---\n\nProse.\n';
		const out = migrateArtifact(noHeadings);
		assert.ok(out.includes('```yaml leetcode'), 'the fence must still be emitted');
		assert.strictEqual(parseLeetCode(out).description, 'Prose.', 'and must not join the description');
	});

	// ── fence-awareness: both anchors must agree with the parser ──────────────

	test('SEC: a column-0 # inside a description code fence is not the first heading', () => {
		// extractDescription finds its boundary through boundaryOutsideFence. A
		// bare /^#+ /m here disagreed with it the moment the description carried
		// a fenced block opening with a column-0 comment (Python, shell, YAML,
		// Dockerfile) — the migrator spliced the signature fence INSIDE that code
		// block, where the parser never looks, and functionName silently became ''.
		const md = [
			'---', 'type: leetcode', 'title: T', 'function: f', 'returns: int', '---', '',
			'Prose before.', '', '```python', '# a comment at column 0', 'x = 1', '```', '',
			'More prose.', '', '## Tests', '```json', '[]', '```',
		].join('\n');
		const parsed = parseLeetCode(migrateArtifact(md));
		assert.strictEqual(parsed.functionName, 'f', 'the signature fence must be reachable by the parser');
		assert.ok(!parsed.description.includes('yaml leetcode'), 'and must not land in the description');
		assert.ok(parsed.description.includes('# a comment'), 'the code fence stays in the description');
	});

	test('SEC: a ## Tests line inside a fenced block is not the anchor', () => {
		const md = [
			'---', 'type: leetcode', 'title: T', 'test:', '  type: function', '---', '',
			'Prose.', '', '## Examples', '', '```markdown', '## Tests', 'docs, not a section', '```', '',
			'## Tests', '```json', '[]', '```',
		].join('\n');
		const out = migrateArtifact(md);
		const fenceAt = out.indexOf('```yaml leetcode');
		const mdOpen = out.indexOf('```markdown');
		const mdClose = out.indexOf('```', out.indexOf('docs, not a section'));
		assert.ok(!(fenceAt > mdOpen && fenceAt < mdClose), 'the exec fence must not be buried in the markdown fence');
		assert.strictEqual(parseLeetCode(out).test.type, 'function');
	});

	// ── the type: leetcode refusal (its own frontmatter test) ─────────────────

	test('a note without type: leetcode is not an artifact', () => {
		// Shaped like <vault>/CoderByte/Tests/README.md — the live file this
		// refusal exists for. applyScalar ignores type: entirely, so the parser
		// cannot answer this question.
		const readme = '---\ntitle: Tests\ntags: [docs]\n---\n\n# Tests\n\nNotes about the suites.\n';
		assert.strictEqual(isLeetCodeArtifact(readme), false);
	});

	test('a real artifact is recognised', () => {
		assert.strictEqual(isLeetCodeArtifact(V1_FUNCTION), true);
	});

	test('text with no frontmatter is not an artifact', () => {
		assert.strictEqual(isLeetCodeArtifact('no frontmatter here'), false);
	});

	// ── argv: dry run is the default, and a typo never writes ─────────────────

	test('a bare target is a dry run', () => {
		assert.deepStrictEqual(parseMigrateArgs(['/vault']), { target: '/vault', write: false });
	});

	test('--write is opt-in and exact', () => {
		assert.deepStrictEqual(parseMigrateArgs(['/vault', '--write']), { target: '/vault', write: true });
	});

	test('an unknown flag is refused rather than ignored', () => {
		// Silently dropping a typo is how a user believes they ran a dry run.
		assert.throws(() => parseMigrateArgs(['/vault', '--wrte']), /unknown flag/);
		assert.throws(() => parseMigrateArgs(['/vault', '--write-now']), /unknown flag/);
	});

	test('a missing target is refused', () => {
		assert.throws(() => parseMigrateArgs([]), /usage/);
	});

	test('a second target is refused rather than silently ignored', () => {
		assert.throws(() => parseMigrateArgs(['/a', '/b']), /second target/);
	});

	// ── the dry-run diff ──────────────────────────────────────────────────────

	test('identical input produces no diff', () => {
		assert.strictEqual(unifiedDiff('a\nb', 'a\nb', 'f.md'), '');
	});

	test('containment: a path inside the root is allowed', () => {
		assert.strictEqual(isContained('topic/a.md', '/'), true);
		assert.strictEqual(isContained('', '/'), true);
	});

	test('containment: a traversal escape is refused', () => {
		assert.strictEqual(isContained('..', '/'), false);
		assert.strictEqual(isContained('../evil.md', '/'), false);
	});

	test('containment: a sibling root sharing a name prefix is refused', () => {
		// A sibling '/vault-evil' relative to '/vault' is '../vault-evil' — a string
		// prefix check would have let this through, which is the whole reason the
		// comparison is on a separator boundary.
		assert.strictEqual(isContained('../vault-evil/a.md', '/'), false);
	});

	test('a diff shows only the changed region, both sides labelled', () => {
		const out = unifiedDiff('a\nb\nc', 'a\nX\nc', 'f.md');
		assert.ok(out.includes('--- f.md'));
		assert.ok(out.includes('+++ f.md'));
		assert.ok(out.includes('-b'));
		assert.ok(out.includes('+X'));
		assert.ok(!out.includes('-a'), 'the common prefix must not appear as a change');
		assert.ok(!out.includes('-c'), 'the common suffix must not appear as a change');
	});

	// ── T1.12: isLeetCodeArtifact finds both spellings ────────────────────────

	test('T1.12: isLeetCodeArtifact accepts the v2 artifactType: leetcode spelling too', () => {
		// D11 renamed type -> artifactType; the migrator must still find a
		// v2 file to no-op over it, not just a pre-migration v1 one.
		assert.strictEqual(isLeetCodeArtifact('---\nartifactType: leetcode\ntitle: X\n---\n'), true);
	});

	test('T1.12: isLeetCodeArtifact still accepts the v1 type: leetcode spelling', () => {
		assert.strictEqual(isLeetCodeArtifact('---\ntype: leetcode\ntitle: X\n---\n'), true);
	});

	test('T1.12: isLeetCodeArtifact rejects a note carrying neither spelling', () => {
		assert.strictEqual(isLeetCodeArtifact('---\nartifactType: snippet\ntitle: X\n---\n'), false);
	});

	// ── T1.12: patchFrontmatterField inserts at the canonical index ───────────

	test('T1.12: an absent status lands between difficulty and algorithm, not after tags', () => {
		// This is the behaviour change: 12 of 75 vault artifacts carry no
		// status:, and appending after tags is what makes the first Submit on
		// any of them write an order violation T1.11 then fails.
		const before = [
			'---',
			'artifactType: leetcode',
			'leetcodeType: function',
			'title: X',
			'difficulty: medium',
			'algorithm: kadane',
			'tags: [a, b]',
			'---',
			'Body',
			'',
		].join('\n');
		const after = patchFrontmatterField(before, 'status', 'solved');
		assert.strictEqual(after, [
			'---',
			'artifactType: leetcode',
			'leetcodeType: function',
			'title: X',
			'difficulty: medium',
			'status: solved',
			'algorithm: kadane',
			'tags: [a, b]',
			'---',
			'Body',
			'',
		].join('\n'));
	});

	test('T1.12: a present status is replaced in place, not moved', () => {
		const before = '---\nartifactType: leetcode\ntitle: X\ndifficulty: medium\nstatus: unsolved\nalgorithm: kadane\n---\nBody\n';
		const after = patchFrontmatterField(before, 'status', 'solved');
		assert.strictEqual(after, '---\nartifactType: leetcode\ntitle: X\ndifficulty: medium\nstatus: solved\nalgorithm: kadane\n---\nBody\n');
	});

	test('T1.12: missing neighbours are handled — only artifactType and tags declared', () => {
		// difficulty/status/algorithm all absent: status (index 4) outranks
		// nothing present before tags (index 6), so it lands right before tags.
		const before = '---\nartifactType: leetcode\ntags: [a]\n---\nBody\n';
		const after = patchFrontmatterField(before, 'status', 'solved');
		assert.strictEqual(after, '---\nartifactType: leetcode\nstatus: solved\ntags: [a]\n---\nBody\n');
	});

	test('T1.12: nothing outranks status when it is the last canonical key present — appended at the end', () => {
		const before = '---\nartifactType: leetcode\ntitle: X\n---\nBody\n';
		const after = patchFrontmatterField(before, 'status', 'solved');
		assert.strictEqual(after, '---\nartifactType: leetcode\ntitle: X\nstatus: solved\n---\nBody\n');
	});

	// ── T1.12: hostile frontmatter ─────────────────────────────────────────────

	test('T1.12: HOSTILE — a duplicate status key is fully replaced, not left half-stale', () => {
		// applyScalar is last-wins, so leaving the first occurrence patched and
		// the second (the one the parser actually reads) untouched would make
		// the write a silent no-op from the parser's point of view.
		const before = '---\nartifactType: leetcode\nstatus: unsolved\ntitle: X\nstatus: unsolved\n---\nBody\n';
		const after = patchFrontmatterField(before, 'status', 'solved');
		assert.strictEqual((after.match(/^status:.*$/gm) ?? []).length, 2, 'both lines still exist');
		assert.ok(!after.includes('unsolved'), 'no stale duplicate keeps the old value');
		assert.strictEqual(after, '---\nartifactType: leetcode\nstatus: solved\ntitle: X\nstatus: solved\n---\nBody\n');
	});

	test('T1.12: HOSTILE — a __proto__ frontmatter key survives untouched and unmoved', () => {
		const before = '---\nartifactType: leetcode\ntitle: X\n__proto__: evil\ndifficulty: medium\nalgorithm: kadane\n---\nBody\n';
		const after = patchFrontmatterField(before, 'status', 'solved');
		assert.strictEqual(after, '---\nartifactType: leetcode\ntitle: X\n__proto__: evil\ndifficulty: medium\nstatus: solved\nalgorithm: kadane\n---\nBody\n');
	});

	test('T1.12: HOSTILE — an unknown custom key survives untouched and unmoved', () => {
		const before = '---\nartifactType: leetcode\ntitle: X\nreviewer: nick\ndifficulty: medium\nalgorithm: kadane\n---\nBody\n';
		const after = patchFrontmatterField(before, 'status', 'solved');
		assert.strictEqual(after, '---\nartifactType: leetcode\ntitle: X\nreviewer: nick\ndifficulty: medium\nstatus: solved\nalgorithm: kadane\n---\nBody\n');
	});

	// Both CRLF cases assert the **whole** string. Three loose `assert.ok`s
	// stood here first and could not tell a correct patch from one that wrote
	// a bare `\n` into a CRLF file — mutation-tested: applying the fix left
	// them all passing, so they pinned nothing about line endings at all.
	// `migrateArtifact` promises a CRLF file round-trips unchanged; the patcher
	// is the other half of that promise, so it asserts the same way.

	test('T1.12: HOSTILE — CRLF insert keeps every line ending CRLF, including the new one', () => {
		const before = '---\r\nartifactType: leetcode\r\ntitle: X\r\ndifficulty: medium\r\nalgorithm: kadane\r\n---\r\nBody\r\n';
		assert.strictEqual(
			patchFrontmatterField(before, 'status', 'solved'),
			'---\r\nartifactType: leetcode\r\ntitle: X\r\ndifficulty: medium\r\nstatus: solved\r\nalgorithm: kadane\r\n---\r\nBody\r\n',
		);
	});

	test('T1.12: HOSTILE — CRLF replace-in-place keeps the carriage return', () => {
		// `.` matches `\r`, so an `m`-flagged `.*$` swallows it and the
		// replacement puts back a bare `\n`. This is the assertion that catches
		// that, and it is why the pattern uses `[^\r\n]*`.
		const before = '---\r\nartifactType: leetcode\r\nstatus: unsolved\r\n---\r\nBody\r\n';
		assert.strictEqual(
			patchFrontmatterField(before, 'status', 'solved'),
			'---\r\nartifactType: leetcode\r\nstatus: solved\r\n---\r\nBody\r\n',
		);
	});

	test('T1.12: SEC — a field name carrying regex metacharacters cannot match a key it does not name', () => {
		// `patchFrontmatterField` is exported and takes any `string`. Unescaped,
		// `'status.'` compiled to `^status.:` and matched — then destroyed — the
		// unrelated `statusX:` line.
		// Escaped, `status.` matches nothing, so it takes the *insert* path and
		// lands as its own key — `statusX` is left exactly as it was. Unescaped,
		// `^status.:` matched `statusX:` and overwrote it, losing the value.
		const before = '---\nstatusX: a\ntitle: T\n---\nBody\n';
		assert.strictEqual(
			patchFrontmatterField(before, 'status.', 'solved'),
			'---\nstatusX: a\ntitle: T\nstatus.: solved\n---\nBody\n',
		);
	});

	test('T1.12: HOSTILE — no frontmatter at all is returned unchanged', () => {
		const before = 'Just prose, no frontmatter.';
		assert.strictEqual(patchFrontmatterField(before, 'status', 'solved'), before);
	});

	test('T1.12: HOSTILE — frontmatter that is only "---\\n---" still gets the field inserted', () => {
		const before = '---\n---';
		const after = patchFrontmatterField(before, 'status', 'solved');
		assert.strictEqual(after, '---\nstatus: solved\n---');
	});

});
