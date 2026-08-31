import * as assert from 'node:assert';
import { execFile, execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import {
	FETCH_GUARD_BLOCK, HARNESS_LIBS, RENDER_RUNNER, renderRunnerCommand, renderRunnerSource,
} from '../src/services/test-envs/project/render.driver.js';
import { MAX_HTTP_BODY_BYTES } from '../src/services/test-envs/http/http-case.helpers.js';
import { ensureLibEnv, libEnvDir } from '../src/services/libs/lib-cache.service.js';
import { parseLeetCode } from '../src/services/leetcode-parser.service.js';
import { gradeProjectDir } from '../src/services/test-envs/project/project.runner.js';

const execFileAsync = promisify(execFile);

/** Start a bare `http` server on loopback, for a real backend to guard against. */
function startServer(handler: http.RequestListener): Promise<{ port: number; close: () => Promise<void> }> {
	return new Promise((resolve, reject) => {
		const server = http.createServer(handler);
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as AddressInfo;
			resolve({ port, close: () => new Promise<void>(r => { server.close(() => r()); }) });
		});
	});
}

/** One guard-harness run's parsed stdout. */
interface GuardHarnessResult {
	ok: boolean;
	status?: number;
	body?: string;
	location?: string | null;
	error?: string;
}

/**
 * Run `installFetch` alone — no esbuild, jsdom or React — by assembling
 * {@link FETCH_GUARD_BLOCK} with a two-line driver into its own script and
 * executing it as a real child process. Proves the loopback guard (T4.3,
 * VSX-180) is live without paying for the render toolchain the rest of this
 * driver needs, so this stays in the default, offline gate.
 *
 * **Deliberately `execFileAsync`, not `execFileSync`.** A positive-path test
 * spins up its "backend" `http.createServer` in *this* same test process —
 * `execFileSync` blocks that process's own event loop for the child's whole
 * lifetime, so the server can never service the very connection the spawned
 * child is trying to make, and every such case times out identically whether
 * the guard is correct or not (measured — it is not a network or sandbox
 * limitation, it is this harness blocking its own listener). The async form
 * lets both processes' event loops run concurrently, exactly like the
 * existing `bootServer`/`runHttpCheck` tests already do.
 */
async function runGuardHarness(port: number | null, target: string): Promise<GuardHarnessResult> {
	const script = [
		FETCH_GUARD_BLOCK,
		'',
		`const pending = installFetch(${JSON.stringify(port)});`,
		'fetch(process.argv[2]).then(async (r) => {',
		'  const body = await r.text();',
		'  const location = r.headers.get("location");',
		'  process.stdout.write(JSON.stringify({ ok: true, status: r.status, body, location }));',
		'}).catch((e) => {',
		'  process.stdout.write(JSON.stringify({ ok: false, error: e.message }));',
		'});',
	].join('\n');

	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leet-fetch-guard-'));
	const file = path.join(dir, 'guard.js');
	fs.writeFileSync(file, script, 'utf-8');
	try {
		const { stdout } = await execFileAsync(process.execPath, [file, target], { encoding: 'utf-8', timeout: 15_000 });
		return JSON.parse(stdout) as GuardHarnessResult;
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * JSX/TSX bundle + jsdom render driver (eval-fixes TB.5).
 *
 * Split deliberately. The **generator** is pure and is tested unconditionally —
 * that every artifact-supplied value is embedded as a JSON literal rather than
 * as code is a security property, and it must hold on every gate run, offline.
 *
 * The **end-to-end mount** needs esbuild, jsdom and React, which this repo does
 * not and must not depend on (it ships zero runtime dependencies — the toolchain
 * installs into the shared cache at run time). That test therefore runs only
 * with `LEET_PROJECT_E2E=1`, where a network install is acceptable; it is
 * `pending`, never silently green, when unset.
 */
suite('project render driver', () => {

	const SPEC = {
		entry: 'src/App.jsx',
		cacheDir: '/tmp/leet-cache',
		cases: [{ index: 0, steps: [{ op: 'click' as const, selector: 'button' }, { op: 'text' as const, selector: '#out' }] }],
	};

	// ── Generated source: data stays data ─────────────────────────────────────

	suite('renderRunnerSource', () => {

		test('embeds the entry, cache dir and cases as JSON literals', () => {
			const source = renderRunnerSource(SPEC);
			assert.ok(source.includes('const ENTRY = "src/App.jsx";'), 'entry');
			assert.ok(source.includes('const CACHE = "/tmp/leet-cache";'), 'cache');
			assert.ok(source.includes('"op":"click"'), 'cases');
		});

		test('a selector carrying JS syntax cannot break out of its literal', () => {
			const hostile = { ...SPEC, cases: [{ index: 0, steps: [{ op: 'text' as const, selector: '";process.exit(1);//' }] }] };
			const source = renderRunnerSource(hostile);

			// The quote is escaped inside the JSON literal, so it is a string, not syntax.
			assert.ok(source.includes(String.raw`\";process.exit(1);//`), source.slice(0, 400));
			assert.ok(!/^\s*process\.exit\(1\);/m.test(source), 'selector escaped its literal');
		});

		test('a path carrying a quote cannot break out either', () => {
			const source = renderRunnerSource({ ...SPEC, entry: 'a";require("fs");//.jsx' });
			assert.ok(source.includes(String.raw`const ENTRY = "a\";require(\"fs\");//.jsx";`), source.slice(0, 300));
		});

		test('resolves the toolchain from the cache, never from this repo', () => {
			const source = renderRunnerSource(SPEC);
			assert.ok(source.includes("path.join(CACHE, 'node_modules')"), 'cache modules');
			assert.ok(source.includes('require.resolve(name, { paths: [MODULES] })'), 'resolution paths');
		});

		test('every case is wrapped so one throw fails one case', () => {
			const source = renderRunnerSource(SPEC);
			assert.ok(source.includes('for (const testCase of CASES)'), 'per-case loop');
			assert.ok(source.includes('catch (e)'), 'per-case catch');
			assert.ok(source.includes('error: (e && e.message)'), 'error reported per case');
		});

		test('a failure before any case still reports against every case', () => {
			// Bundling or a missing toolchain must not produce a silent empty suite,
			// which the runner would read as "no results" rather than "all failed".
			assert.ok(renderRunnerSource(SPEC).includes('for (const testCase of CASES) {\n\t\temit({ index: testCase.index, error:'));
		});

		test('remounts per case rather than reusing a mounted tree', () => {
			assert.ok(renderRunnerSource(SPEC).includes('act(() => root.render('), 'render per case');
			assert.ok(renderRunnerSource(SPEC).includes('act(() => root.unmount())'), 'unmount per case');
		});

		test('output goes through the shared __LEET__ sentinel', () => {
			assert.ok(renderRunnerSource(SPEC).includes('const SENTINEL = "__LEET__";'));
		});

		// ── T4.3: fetch against a live backend ───────────────────────────────

		test('embeds the assigned API port as a JSON literal, defaulting to null when no backend is assigned', () => {
			assert.ok(renderRunnerSource(SPEC).includes('const API_PORT = null;'), 'no backend assigned');
			assert.ok(
				renderRunnerSource({ ...SPEC, apiPort: 54321 }).includes('const API_PORT = 54321;'),
				'assigned port embedded verbatim',
			);
		});

		test('installs a guarded fetch that enforces the assigned loopback port itself', () => {
			const source = renderRunnerSource({ ...SPEC, apiPort: 54321 });
			assert.ok(source.includes('installFetch(API_PORT)'), 'installed before mounting');
			assert.ok(source.includes('LEET_FETCH_REFUSED'), 'a refused request is named');
			assert.ok(source.includes("redirect: 'manual'"), 'never follows a redirect off this run\'s backend');
			assert.ok(source.includes('AbortSignal.timeout(LEET_FETCH_TIMEOUT_MS)'), 'bounded by a timeout');
		});

		test('bakes the shared body cap into the guard rather than a second number', () => {
			assert.ok(
				renderRunnerSource(SPEC).includes(`var LEET_MAX_BODY_BYTES = ${MAX_HTTP_BODY_BYTES};`),
				'reuses http-case.helpers.ts\'s own MAX_HTTP_BODY_BYTES value',
			);
		});

		test('settles every pending fetch before a step acts or reads', () => {
			const source = renderRunnerSource(SPEC);
			const settleAt = source.indexOf('await settlePending(pending)');
			const performAt = source.indexOf('const value = perform(container, step, win, act);');
			assert.notStrictEqual(settleAt, -1, 'settle call present');
			assert.notStrictEqual(performAt, -1, 'perform call present');
			assert.ok(settleAt < performAt, 'pending fetches are settled before the step is performed');
		});
	});

	test('the run command is a fixed literal with no interpolated data', () => {
		assert.strictEqual(renderRunnerCommand(), `node ${RENDER_RUNNER}`);
	});

	test('the harness declares its own toolchain, separate from an artifact\'s libs', () => {
		assert.deepStrictEqual([...HARNESS_LIBS].map(l => l.split('@')[0]), ['esbuild', 'jsdom']);
	});

	// ── T4.3: the loopback guard, offline and toolchain-free ──────────────────
	//
	// `installFetch` runs as a two-line child process with no esbuild, jsdom or
	// React — a real backend on real loopback sockets, no network reachability
	// assumed beyond it. This is the guard's own proof of life, independent of
	// the [LEET_PROJECT_E2E=1] suite below, which proves the *integration*
	// (bundled component + jsdom + settling) instead.

	suite('installFetch — the loopback guard (S10)', () => {

		test('a relative path resolves against the assigned port and returns the backend\'s own response', async () => {
			const server = await startServer((_req, res) => { res.end('backend-value'); });
			try {
				const result = await runGuardHarness(server.port, '/anything');
				assert.deepStrictEqual(result, { ok: true, status: 200, body: 'backend-value', location: null });
			} finally {
				await server.close();
			}
		});

		// The pinned proof that the guard is *reached*, not merely present: this
		// is the one deleted-and-confirmed test (see the task report). Removing
		// the `url.host !== expectedHost` check flips it to `ok: true`, because
		// 'localhost' resolves to the very same server — nothing about the
		// request itself changes, only whether the string comparison runs.
		test('"localhost" is refused even though it is the same server — an allowlist, not a semantic loopback check', async () => {
			const server = await startServer((_req, res) => { res.end('backend-value'); });
			try {
				const result = await runGuardHarness(server.port, `http://localhost:${server.port}/`);
				assert.strictEqual(result.ok, false, JSON.stringify(result));
				assert.ok(result.error?.includes('LEET_FETCH_REFUSED'), JSON.stringify(result));
			} finally {
				await server.close();
			}
		});

		test('an absolute URL naming a port this run did not assign is refused', async () => {
			const assigned = await startServer((_req, res) => { res.end('assigned-backend'); });
			const other = await startServer((_req, res) => { res.end('other-backend'); });
			try {
				const result = await runGuardHarness(assigned.port, `http://127.0.0.1:${other.port}/`);
				assert.strictEqual(result.ok, false, JSON.stringify(result));
				assert.ok(result.error?.includes('LEET_FETCH_REFUSED'), JSON.stringify(result));
			} finally {
				await assigned.close();
				await other.close();
			}
		});

		test('no assigned port refuses every request by default — the pre-T4.3 hole, now closed', async () => {
			const result = await runGuardHarness(null, '/x');
			assert.strictEqual(result.ok, false, JSON.stringify(result));
			assert.ok(result.error?.includes('no live backend is configured'), JSON.stringify(result));
		});

		test('a redirect from the backend is observed, never followed off-host', async () => {
			const server = await startServer((_req, res) => {
				res.writeHead(302, { Location: 'http://evil.example/stolen' });
				res.end();
			});
			try {
				const result = await runGuardHarness(server.port, '/redirect-me');
				// `redirect: 'manual'` (Node's fetch, unlike a browser's Service Worker
				// filtering) hands back the raw 3xx as an ordinary, fully-readable
				// response — status and `location` both observable — rather than
				// reissuing the request. The proof it was never followed is that the
				// `location` header survived at all: a followed request would have
				// tried to resolve `evil.example` instead of returning this response.
				assert.strictEqual(result.ok, true, JSON.stringify(result));
				assert.strictEqual(result.status, 302, JSON.stringify(result));
				assert.strictEqual(result.location, 'http://evil.example/stolen', JSON.stringify(result));
			} finally {
				await server.close();
			}
		});
	});

	// ── End-to-end: real bundle, real mount (opt-in) ──────────────────────────

	test('a component bundles, mounts, and observes a click [LEET_PROJECT_E2E=1]', async function () {
		if (process.env.LEET_PROJECT_E2E !== '1') { this.skip(); }
		this.timeout(600_000);

		const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-e2e-'));
		const libs = [...HARNESS_LIBS, 'react@^19.0.0', 'react-dom@^19.0.0'];
		const installed = await ensureLibEnv('pnpm', libs);
		assert.ok(installed.ok, !installed.ok ? installed.reason : '');

		fs.mkdirSync(path.join(runDir, 'src'));
		fs.writeFileSync(path.join(runDir, 'src/App.jsx'), [
			"import { useState } from 'react';",
			'export default function App() {',
			'  const [n, setN] = useState(0);',
			'  return (<div>',
			'    <button onClick={() => setN(n + 1)}>inc</button>',
			'    <span id="out">{String(n)}</span>',
			'  </div>);',
			'}',
		].join('\n'));

		fs.writeFileSync(path.join(runDir, RENDER_RUNNER), renderRunnerSource({
			entry: 'src/App.jsx',
			cacheDir: libEnvDir('pnpm', libs),
			cases: [
				{ index: 0, steps: [{ op: 'text', selector: '#out' }] },
				{ index: 1, steps: [{ op: 'click', selector: 'button' }, { op: 'text', selector: '#out' }] },
				{ index: 2, steps: [{ op: 'count', selector: 'button' }] },
				{ index: 3, steps: [{ op: 'text', selector: '#missing' }] },
			],
		}), 'utf-8');

		const stdout = execFileSync(process.execPath, [RENDER_RUNNER], { cwd: runDir, encoding: 'utf-8' });
		const lines = stdout.split('\n').filter(l => l.startsWith('__LEET__'))
			.map(l => JSON.parse(l.slice('__LEET__'.length)));

		assert.strictEqual(lines.length, 4, stdout);
		assert.strictEqual(lines[0].actual, '"0"', 'initial render');
		assert.strictEqual(lines[1].actual, '"1"', 'state after a click');
		assert.strictEqual(lines[2].actual, '1', 'count of buttons');
		assert.ok(lines[3].error?.includes('#missing'), 'a bad selector fails one case only');

		fs.rmSync(runDir, { recursive: true, force: true });
	});

	test('a change step refuses a field a user could not type into, but a disabled click stays a no-op [LEET_PROJECT_E2E=1]', async function () {
		if (process.env.LEET_PROJECT_E2E !== '1') { this.skip(); }
		this.timeout(600_000);

		// Two halves of one rule, and they must not be conflated:
		//   • `change` writes through the prototype setter, bypassing `readOnly`
		//     and `disabled` — a frozen form graded green, so the step is refused.
		//   • `click` on a disabled target is ALREADY inert, exactly as for a real
		//     user. Refusing it broke the legitimate `disabled={taken}` solution
		//     that suites script clicks against to assert the no-op.
		const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-e2e-frozen-'));
		const libs = [...HARNESS_LIBS, 'react@^19.0.0', 'react-dom@^19.0.0'];
		const installed = await ensureLibEnv('pnpm', libs);
		assert.ok(installed.ok, !installed.ok ? installed.reason : '');

		fs.mkdirSync(path.join(runDir, 'src'));
		fs.writeFileSync(path.join(runDir, 'src/App.jsx'), [
			"import { useState } from 'react';",
			'export default function App() {',
			"  const [v, setV] = useState('');",
			'  return (<div>',
			'    <input id="open" value={v} onChange={e => setV(e.target.value)} />',
			'    <input id="frozen" readOnly value={v} onChange={e => setV(e.target.value)} />',
			'    <input id="deadfield" disabled value={v} onChange={e => setV(e.target.value)} />',
			`    <button id="dead" disabled onClick={() => setV('clicked')}>x</button>`,
			'    <span id="out">{v}</span>',
			'  </div>);',
			'}',
		].join('\n'));

		fs.writeFileSync(path.join(runDir, RENDER_RUNNER), renderRunnerSource({
			entry: 'src/App.jsx',
			cacheDir: libEnvDir('pnpm', libs),
			cases: [
				{ index: 0, steps: [
					{ op: 'change', selector: '#open', value: 'hi' }, { op: 'text', selector: '#out' },
				] },
				{ index: 1, steps: [
					{ op: 'change', selector: '#frozen', value: 'hi' }, { op: 'text', selector: '#out' },
				] },
				{ index: 2, steps: [
					{ op: 'change', selector: '#deadfield', value: 'hi' }, { op: 'text', selector: '#out' },
				] },
				{ index: 3, steps: [
					{ op: 'click', selector: '#dead' }, { op: 'text', selector: '#out' },
				] },
			],
		}), 'utf-8');

		const stdout = execFileSync(process.execPath, [RENDER_RUNNER], { cwd: runDir, encoding: 'utf-8' });
		const lines = stdout.split('\n').filter(l => l.startsWith('__LEET__'))
			.map(l => JSON.parse(l.slice('__LEET__'.length)));

		assert.strictEqual(lines.length, 4, stdout);
		assert.strictEqual(lines[0].actual, '"hi"', 'a writable input still takes a change step');
		assert.ok(lines[1].error?.includes('readOnly'), `readOnly must fail the case: ${JSON.stringify(lines[1])}`);
		assert.ok(lines[1].error?.includes('#frozen'), 'the refusal names the offending selector');
		assert.ok(
			lines[2].error?.includes('disabled'),
			`a change step into a disabled field must fail: ${JSON.stringify(lines[2])}`,
		);

		// The regression guard: a click on a disabled control is a NO-OP, not an
		// error. `disabled={alreadyTaken}` is idiomatic and must stay solvable.
		assert.strictEqual(lines[3].error, undefined, `a disabled click must not error: ${JSON.stringify(lines[3])}`);
		assert.strictEqual(lines[3].actual, '""', 'the disabled click changed nothing, exactly as for a real user');

		fs.rmSync(runDir, { recursive: true, force: true });
	});

	/**
	 * A `leetcodeType: stack` artifact declaring **one** package (a plain Node
	 * `http` server, so this stays free of Python/Flask) and one `dom-assert`
	 * check on a component that fetches from it. `## Files` carries only a
	 * hidden placeholder — `gradeProjectDir` never reads `parsed.files` (only
	 * `runProjectChecks` does, via `writeProjectFiles`), so the real
	 * `src/App.jsx` esbuild bundles is written straight to `runDir` by the
	 * test, exactly like the pre-existing `stack: gradeProjectDir boots the
	 * whole packages: set once` fixture in `project-runner.test.ts` writes its
	 * package directories by hand.
	 */
	function liveBackendArtifact(): string {
		return [
			'---',
			'artifactType: leetcode',
			'leetcodeType: stack',
			'title: Live Backend Render',
			'---',
			'',
			'Renders a value fetched from a booted backend.',
			'',
			'```yaml leetcode',
			'test:',
			'  checks:',
			'    - name: shows the backend value',
			'      kind: dom-assert',
			'      file: src/App.jsx',
			'packages:',
			'  - name: api',
			'    dir: server',
			'    install: ["node", "-e", "process.exit(0)"]',
			'    start: ["node", "-e", "require(\'http\').createServer((q,r)=>{r.setHeader(\'content-type\',\'application/json\');'
				+ 'r.end(JSON.stringify({value:\'from-the-backend\'}))}).listen(Number(process.env.PORT),\'127.0.0.1\')"]',
			'```',
			'',
			'## Tests',
			'',
			'```json check="shows the backend value"',
			'[{ "input": { "steps": [{ "op": "text", "selector": "#out" }] }, "expected": "from-the-backend" }]',
			'```',
			'',
			'## Files',
			'',
			'```javascript path=src/App.jsx role=hidden',
			'// unused by gradeProjectDir — the real file is written straight to runDir',
			'```',
			'',
		].join('\n');
	}

	test('a component whose fetch resolves from the booted backend produces the backend\'s value in a text step [LEET_PROJECT_E2E=1]', async function () {
		if (process.env.LEET_PROJECT_E2E !== '1') { this.skip(); }
		this.timeout(600_000);

		// The whole failure mode T4.3 exists to close: without settling pending
		// fetches before a read, the `text` step below would observe the
		// component's own "loading" placeholder instead of the backend's value.
		// Threaded through the **production** path — `gradeProjectDir` — not a
		// hand-built RenderSpec, so this fails if `apiPort` stops reaching
		// `runRenderCheck` (round 2's finding: it never did, before this test).
		const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-e2e-fetch-'));
		const libs = [...HARNESS_LIBS, 'react@^19.0.0', 'react-dom@^19.0.0'];
		const installed = await ensureLibEnv('pnpm', libs);
		assert.ok(installed.ok, !installed.ok ? installed.reason : '');

		fs.mkdirSync(path.join(runDir, 'server'), { recursive: true });
		fs.mkdirSync(path.join(runDir, 'src'), { recursive: true });
		fs.writeFileSync(path.join(runDir, 'src/App.jsx'), [
			"import { useEffect, useState } from 'react';",
			'export default function App() {',
			"  const [text, setText] = useState('loading');",
			'  useEffect(() => {',
			"    fetch('/value').then(r => r.json()).then(d => setText(d.value));",
			'  }, []);',
			'  return (<span id="out">{text}</span>);',
			'}',
		].join('\n'));

		try {
			const outcomes = await gradeProjectDir(parseLeetCode(liveBackendArtifact()), runDir);
			assert.strictEqual(outcomes.length, 1, JSON.stringify(outcomes));
			assert.strictEqual(
				outcomes[0].passed, true,
				`the text step must observe the settled fetch, never the loading placeholder: ${JSON.stringify(outcomes)}`,
			);
		} finally {
			fs.rmSync(runDir, { recursive: true, force: true });
		}
	});
});
