import * as assert from 'node:assert';
import type { BuildCheck, FileSpec, LibSpec, ProjectCheck } from '../src/types/leetcode.types.js';
import { projectEnvFor } from '../src/services/test-envs/project/project.env.js';

/**
 * Type-level tests for the `project` domain shape (eval-fixes TB.1).
 *
 * A discriminated union is only worth having if it *narrows*: these assertions
 * are as much about what fails to compile as about what runs. Each literal is
 * `satisfies`-checked against its type, so a field drifting out of the union
 * breaks the build, not a runtime assertion.
 */
suite('project types', () => {

	// ── ProjectCheck discriminates on `kind` ──────────────────────────────────

	test('a build check narrows to expose argv and dir', () => {
		const check = {
			name: 'app builds',
			kind: 'build',
			argv: ['npx', 'tsc', '--noEmit'],
			dir: 'client',
			cases: [],
			publicCount: 0,
		} satisfies BuildCheck;

		const widened: ProjectCheck = check;
		assert.strictEqual(widened.kind, 'build');
		// The narrowing is the assertion: `argv` is unreachable until `kind` is checked.
		if (widened.kind !== 'build') { throw new Error('discriminant failed to narrow'); }
		assert.deepStrictEqual(widened.argv, ['npx', 'tsc', '--noEmit']);
		assert.strictEqual(widened.dir, 'client');
	});

	test('a build check may omit the optional dir', () => {
		const check: BuildCheck = { name: 'builds', kind: 'build', argv: ['npm', 'run', 'build'], cases: [], publicCount: 0 };
		assert.strictEqual(check.dir, undefined);
	});

	test('a function check carries the file and export it grades', () => {
		const check: ProjectCheck = {
			name: 'catalogue filter',
			kind: 'function',
			file: 'src/lib/catalogue.ts',
			function: 'filterInStock',
			cases: [{ input: { stock: 1 }, expected: true }],
			publicCount: 1,
		};

		if (check.kind !== 'function') { throw new Error('discriminant failed to narrow'); }
		assert.strictEqual(check.file, 'src/lib/catalogue.ts');
		assert.strictEqual(check.cases.length, 1);
	});

	test('dom-assert and css-assert both carry a component file', () => {
		const checks: ProjectCheck[] = [
			{ name: 'alternates', kind: 'dom-assert', file: 'src/App.jsx', cases: [], publicCount: 0 },
			{ name: 'styled', kind: 'css-assert', file: 'src/App.jsx', cases: [], publicCount: 0 },
		];
		assert.deepStrictEqual(checks.map(c => c.kind), ['dom-assert', 'css-assert']);
	});

	// ── FileSpec / LibSpec ────────────────────────────────────────────────────

	test('a file spec carries a relative path, language, role and content', () => {
		const file = {
			path: 'src/App.jsx',
			language: 'javascript',
			role: 'editable',
			content: 'export default function App() { return null; }',
		} satisfies FileSpec;

		assert.strictEqual(file.role, 'editable');
	});

	test('libs are per-language dependency lists', () => {
		const libs: LibSpec = { javascript: ['react@^19.0.0'], typescript: ['vite@^7.0.0'] };
		assert.deepStrictEqual(Object.keys(libs).sort(), ['javascript', 'typescript']);
	});

	// ── Env skeleton ──────────────────────────────────────────────────────────

	suite('project env skeleton', () => {

		test('is shaped like a TestEnv for its language', () => {
			const env = projectEnvFor('javascript');
			assert.strictEqual(env.type, 'project');
			assert.strictEqual(env.language, 'javascript');
		});

		test('validate refuses every candidate until the driver lands', () => {
			const message = projectEnvFor('typescript').validate?.({
				parsed: { test: { type: 'project' } } as never,
				langId: 'typescript',
				code: '',
				cases: [],
			});
			assert.ok(typeof message === 'string' && message.length > 0, String(message));
		});

		test('parse reads the shared __LEET__ sentinel protocol', () => {
			const outcomes = projectEnvFor('javascript').parse('__LEET__{"index":0,"actual":"true","ms":1}\n');
			assert.deepStrictEqual(outcomes, [{ index: 0, actual: 'true', ms: 1 }]);
		});
	});
});
