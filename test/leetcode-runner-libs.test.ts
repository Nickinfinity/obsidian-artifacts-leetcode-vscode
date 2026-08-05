import * as assert from 'node:assert';
import * as path from 'node:path';
import { runSuite } from '../src/services/leetcode-runner.service.js';
import { defaultPracticeConfig, defaultTestConfig } from '../src/services/leetcode-parser.service.js';
import type { EnvContext, EmittedProgram, TestEnv } from '../src/services/test-envs/env.types.js';
import type { ParsedLeetCode, TestCase } from '../src/types/leetcode.types.js';

/**
 * The seam that lets a `function` suite resolve third-party libraries.
 *
 * Two invariants carry the whole design and both are asserted here: with no
 * `libs:` the emitted program and the child environment are **byte-identical**
 * to today's, and with libs nothing reaches a command line — the cache
 * directory travels as environment-variable values only.
 */
suite('runner library seam', () => {

	const cases: TestCase[] = [{ input: { n: 1 }, expected: 1 }];

	/** A minimal artifact; only `libs` varies between tests. */
	function artifact(libs?: Record<string, string[]>): ParsedLeetCode {
		return {
			title: 'seam', difficulty: 'easy', functionName: 'identity', status: 'unsolved',
			params: [{ name: 'n', type: 'int' }], returns: 'int', description: '',
			examples: [], tests: cases, finalTests: [], test: defaultTestConfig(),
			setups: [], practice: defaultPracticeConfig(), solutions: [], attempts: [], tags: [],
			...(libs ? { libs } : {}),
		};
	}

	/**
	 * An env that records the context it was handed and emits a program that
	 * prints its own view of the child environment.
	 */
	function recordingEnv(program: Partial<EmittedProgram> = {}): {
		seen: EnvContext[]; env: TestEnv;
	} {
		const seen: EnvContext[] = [];
		const env: TestEnv = {
			type: 'function',
			language: 'javascript',
			leetcodeTypes: ['function'],
			emit: (ctx: EnvContext): EmittedProgram => {
				seen.push(ctx);
				return {
					files: [{
						name: 'runner.js',
						content: 'console.log(`__LEET__${JSON.stringify({index:0,actual:JSON.stringify(process.env.LEET_PROBE ?? null),ms:0})}`);',
					}],
					run: 'node runner.js',
					...program,
				};
			},
			parse: stdout => stdout.split('\n')
				.filter(line => line.startsWith('__LEET__'))
				.map(line => JSON.parse(line.slice('__LEET__'.length)) as { index: number; actual?: string; ms: number }),
		};
		return { seen, env };
	}

	suite('no libs — the existing path is untouched', () => {

		test('emit receives no libDir', async () => {
			const { seen, env } = recordingEnv();
			await runSuite('function identity(n) { return n; }', cases, artifact(), env);

			assert.strictEqual(seen.length, 1);
			assert.strictEqual(seen[0].libDir, undefined);
		});

		/**
		 * The whole no-libs guarantee in one assertion: the context an env sees
		 * is exactly the four fields it saw before this feature existed.
		 */
		test('the context carries nothing new', async () => {
			const { seen, env } = recordingEnv();
			await runSuite('function identity(n) { return n; }', cases, artifact(), env);

			assert.deepStrictEqual(
				Object.keys(seen[0]).sort(),
				['cases', 'code', 'langId', 'parsed'],
			);
		});

		test('the child environment is the parent’s, unmodified', async () => {
			const { env } = recordingEnv();
			process.env.LEET_PROBE = 'inherited';
			try {
				const results = await runSuite('function identity(n) { return n; }', cases, artifact(), env);
				assert.strictEqual(results[0].actual, '"inherited"');
			} finally {
				delete process.env.LEET_PROBE;
			}
		});
	});

	suite('with libs — env vars, never a command line', () => {

		/** Resolve to a fixed directory without installing anything. */
		const resolver = async () => ({ ok: true as const, dir: '/tmp/leet-cache-x' });

		test('emit receives the resolved cache directory', async () => {
			const { seen, env } = recordingEnv();
			await runSuite(
				'function identity(n) { return n; }', cases,
				artifact({ javascript: ['left-pad@1.0.0'] }), env, { resolveLibEnv: resolver },
			);

			assert.strictEqual(seen[0].libDir, '/tmp/leet-cache-x');
		});

		test('emitted env values reach the child', async () => {
			const { env } = recordingEnv({ env: { LEET_PROBE: 'from-emit' } });
			const results = await runSuite(
				'function identity(n) { return n; }', cases,
				artifact({ javascript: ['left-pad@1.0.0'] }), env, { resolveLibEnv: resolver },
			);

			assert.strictEqual(results[0].actual, '"from-emit"');
		});

		/**
		 * `pathPrepend` exists so `emit()` never reads `process.env`: an env that
		 * reaches for the ambient environment makes its own golden assertions
		 * machine-dependent. The runner owns the join.
		 */
		test('pathPrepend is joined onto the inherited PATH, not substituted for it', async () => {
			const { env } = recordingEnv({
				pathPrepend: '/cache/bin',
				files: [{
					name: 'runner.js',
					content: 'console.log(`__LEET__${JSON.stringify({index:0,actual:JSON.stringify(process.env.PATH),ms:0})}`);',
				}],
			});

			const results = await runSuite(
				'function identity(n) { return n; }', cases,
				artifact({ python: ['numpy'] }), env, { resolveLibEnv: resolver },
			);

			const childPath = JSON.parse(results[0].actual ?? '""') as string;
			assert.ok(childPath.startsWith(`/cache/bin${path.delimiter}`), childPath.slice(0, 80));
			assert.ok(childPath.length > `/cache/bin${path.delimiter}`.length, 'the inherited PATH must survive');
		});

		test('a failed resolve fails every case, and nothing runs', async () => {
			const { seen, env } = recordingEnv();
			const failing = async () => ({ ok: false as const, reason: 'pnpm not found — install pnpm' });

			const results = await runSuite(
				'function identity(n) { return n; }', [...cases, { input: { n: 2 }, expected: 2 }],
				artifact({ javascript: ['left-pad@1.0.0'] }), env, { resolveLibEnv: failing },
			);

			assert.strictEqual(results.length, 2);
			for (const result of results) {
				assert.strictEqual(result.passed, false);
				assert.match(result.error ?? '', /pnpm not found/);
			}
			assert.deepStrictEqual(seen, [], 'nothing may be emitted, compiled or run');
		});

		test('a language with no declared libs resolves nothing', async () => {
			const { seen, env } = recordingEnv();
			let called = false;
			const counting = async () => { called = true; return { ok: true as const, dir: '/tmp/x' }; };

			await runSuite(
				'function identity(n) { return n; }', cases,
				artifact({ python: ['numpy'] }), env, { resolveLibEnv: counting },
			);

			assert.strictEqual(called, false, 'a javascript run must not resolve python libs');
			assert.strictEqual(seen[0].libDir, undefined);
		});
	});
});
