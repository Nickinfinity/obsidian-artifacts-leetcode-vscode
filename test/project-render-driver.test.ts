import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { HARNESS_LIBS, RENDER_RUNNER, renderRunnerCommand, renderRunnerSource } from '../src/services/test-envs/project/render.driver.js';
import { ensureLibEnv, libEnvDir } from '../src/services/libs/lib-cache.service.js';

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
	});

	test('the run command is a fixed literal with no interpolated data', () => {
		assert.strictEqual(renderRunnerCommand(), `node ${RENDER_RUNNER}`);
	});

	test('the harness declares its own toolchain, separate from an artifact\'s libs', () => {
		assert.deepStrictEqual([...HARNESS_LIBS].map(l => l.split('@')[0]), ['esbuild', 'jsdom']);
	});

	// ── End-to-end: real bundle, real mount (opt-in) ──────────────────────────

	test('a component bundles, mounts, and observes a click [LEET_PROJECT_E2E=1]', async function () {
		if (process.env.LEET_PROJECT_E2E !== '1') { this.skip(); }
		this.timeout(600_000);

		const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-e2e-'));
		const libs = [...HARNESS_LIBS, 'react@^19.0.0', 'react-dom@^19.0.0'];
		const installed = await ensureLibEnv('npm', libs);
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
			cacheDir: libEnvDir('npm', libs),
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
		const installed = await ensureLibEnv('npm', libs);
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
			cacheDir: libEnvDir('npm', libs),
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
});
