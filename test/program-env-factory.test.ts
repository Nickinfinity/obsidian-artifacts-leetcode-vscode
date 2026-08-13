import * as assert from 'node:assert';
import * as path from 'node:path';
import {
	makeProgramEnv, programSuiteTimeout, PROGRAM_ENVS, type ProgramEnvContext,
} from '../src/services/test-envs/program/make-program-env.js';
import { PROGRAM_SPECS } from '../src/services/test-envs/program/specs.js';
import { MAX_PROGRAM_SUITE_TIMEOUT_MS, PROGRAM_SPAWN_OVERHEAD_MS } from '../src/types/constants.js';
import { LANG_IDS } from '../src/types/languages.js';
import type { ProgramConfig } from '../src/services/program-config.helpers.js';
import type { FileSpec, ParsedLeetCode } from '../src/types/leetcode.types.js';

/**
 * Unit tests for `makeProgramEnv` (T2.5) — the factory that turns a per-language
 * `ProgramSpec` into a `ProgramEnv`. `ProgramEnv` is not a `TestEnv` and is not
 * registered anywhere yet; nothing calls this module until T2.8 (wave 2.D)
 * wires a runner behind it. These tests pin `emit()`'s output shape so that
 * wiring cannot silently disagree with what was built here.
 */
suite('program env factory', () => {

	const RUN_DIR = '/tmp/leet-run-abc123';

	function parsedFixture(files?: FileSpec[]): ParsedLeetCode {
		return (files === undefined ? {} : { files }) as ParsedLeetCode;
	}

	function programConfig(overrides: Partial<ProgramConfig> = {}): ProgramConfig {
		return { channel: 'argv', ...overrides };
	}

	function ctx(overrides: Partial<ProgramEnvContext> = {}): ProgramEnvContext {
		return {
			parsed: parsedFixture(),
			code: 'CANDIDATE SOURCE',
			program: programConfig(),
			...overrides,
		};
	}

	// ── emit — the write-once plan ──────────────────────────────────────────

	suite('emit — python', () => {

		const pythonEnv = makeProgramEnv(PROGRAM_SPECS.python);

		test('candidate is written verbatim, no wrapping and no generated driver', () => {
			const plan = pythonEnv.emit(ctx({ code: 'import sys\nprint("hi")' }), RUN_DIR);
			assert.deepStrictEqual(plan.files, [{ name: 'main.py', content: 'import sys\nprint("hi")' }]);
		});

		test('run is an argv array with the entry as its own element — never interpolated into a joined string', () => {
			const plan = pythonEnv.emit(ctx(), RUN_DIR);
			const entryPath = path.join(RUN_DIR, 'main.py');
			assert.deepStrictEqual(plan.run, ['python3', entryPath]);
			for (const arg of plan.run) { assert.strictEqual(typeof arg, 'string'); }
			// The one interpreter argv element must never itself carry `runDir`
			// concatenated with anything else — it is exactly one path, verbatim.
			assert.strictEqual(plan.run[1], entryPath);
		});

		test('an interpreted language with no libs and no manifest emits no build step', () => {
			const plan = pythonEnv.emit(ctx(), RUN_DIR);
			assert.strictEqual('build' in plan, false);
		});

		test('channel passes straight through from program: config', () => {
			const plan = pythonEnv.emit(ctx({ program: programConfig({ channel: 'stdin' }) }), RUN_DIR);
			assert.strictEqual(plan.channel, 'stdin');
		});

		test('no declared flags — the field is omitted, not an empty array', () => {
			const plan = pythonEnv.emit(ctx(), RUN_DIR);
			assert.strictEqual('flags' in plan, false);
		});

		test('declared flags pass through unchanged, in order', () => {
			const plan = pythonEnv.emit(
				ctx({ program: programConfig({ channel: 'flags', flags: ['--nums', '--target'] }) }), RUN_DIR,
			);
			assert.deepStrictEqual(plan.flags, ['--nums', '--target']);
		});
	});

	// ── entry resolution — default, declared, and hostile ──────────────────

	suite('entry resolution', () => {

		test('every language falls back to its own default entry basename when program.entry is absent', () => {
			const expected: Record<string, string> = {
				java: 'Main.java', python: 'main.py', javascript: 'main.js', rust: 'main.rs', typescript: 'main.ts',
			};
			for (const id of LANG_IDS) {
				const env = makeProgramEnv(PROGRAM_SPECS[id]);
				const plan = env.emit(ctx(), RUN_DIR);
				assert.strictEqual(plan.files[0].name, expected[id], id);
			}
		});

		test('a declared entry overrides the default, including a nested subdirectory', () => {
			const env = makeProgramEnv(PROGRAM_SPECS.java);
			const plan = env.emit(ctx({ program: programConfig({ entry: 'src/Solution.java' }) }), RUN_DIR);
			assert.strictEqual(plan.files[0].name, 'src/Solution.java');
			assert.ok(plan.build?.includes(path.join(RUN_DIR, 'src/Solution.java')));
		});

		test('a traversal entry is refused by resolveContained, the one containment authority — belt under the parser\'s braces', () => {
			const env = makeProgramEnv(PROGRAM_SPECS.python);
			assert.throws(
				() => env.emit(ctx({ program: programConfig({ entry: '../../etc/passwd' }) }), RUN_DIR),
				/escapes the run directory/,
			);
		});

		test('a node_modules-segment entry is refused even if it reached emit unfiltered', () => {
			const env = makeProgramEnv(PROGRAM_SPECS.javascript);
			assert.throws(
				() => env.emit(ctx({ program: programConfig({ entry: 'node_modules/x.js' }) }), RUN_DIR),
				/reserved/,
			);
		});
	});

	// ── selectRunner wiring — build/run come from the T2.4 authority ───────

	suite('selectRunner wiring', () => {

		test('java with an author-shipped pom.xml among ## Files switches to the manifest build', () => {
			const env = makeProgramEnv(PROGRAM_SPECS.java);
			const files: FileSpec[] = [{ path: 'pom.xml', language: 'java', role: 'hidden', content: '<project/>' }];
			const plan = env.emit(ctx({ parsed: parsedFixture(files) }), RUN_DIR);
			assert.ok(plan.build?.includes('mvn'), plan.build?.join(' '));
		});

		// Both expectations below moved in wave 2.D, and the cause is C22 rather
		// than anything in this factory: `javac` gained `-d .` so a nested entry
		// puts its class where both classpath branches look, and `cargo run`
		// gained the trailing `--` so per-case argv reaches the program instead
		// of cargo's own option parser. The factory delegates to `selectRunner`,
		// so these are goldens of *that* authority's output, not of this one's.
		test('java with no manifest and no libs stays on bare javac/java, entry path baked into both', () => {
			const env = makeProgramEnv(PROGRAM_SPECS.java);
			const plan = env.emit(ctx(), RUN_DIR);
			const entryPath = path.join(RUN_DIR, 'Main.java');
			assert.deepStrictEqual(plan.build, ['javac', '-d', '.', entryPath]);
			assert.deepStrictEqual(plan.run, ['java', '-cp', '.', 'Main']);
		});

		test('rust with libDir switches to the cargo shape, mirroring the function env', () => {
			const env = makeProgramEnv(PROGRAM_SPECS.rust);
			const plan = env.emit(ctx({ libDir: '/cache/cargo-1' }), RUN_DIR);
			assert.deepStrictEqual(plan.build, ['cargo', 'build', '--offline', '--release', '--quiet']);
			assert.deepStrictEqual(plan.run, ['cargo', 'run', '--offline', '--release', '--quiet', '--']);
		});
	});

	// ── library env / pathPrepend seam ──────────────────────────────────────

	suite('library seam — env and pathPrepend, mirroring withLibraries', () => {

		test('no libDir — no env, no pathPrepend, on every language', () => {
			for (const id of LANG_IDS) {
				const plan = makeProgramEnv(PROGRAM_SPECS[id]).emit(ctx(), RUN_DIR);
				assert.strictEqual(plan.env, undefined, id);
				assert.strictEqual(plan.pathPrepend, undefined, id);
			}
		});

		test('python gets VIRTUAL_ENV and a bin/ pathPrepend', () => {
			const plan = makeProgramEnv(PROGRAM_SPECS.python).emit(ctx({ libDir: '/cache/pip-1' }), RUN_DIR);
			assert.deepStrictEqual(plan.env, { VIRTUAL_ENV: '/cache/pip-1' });
			assert.strictEqual(plan.pathPrepend, path.join('/cache/pip-1', 'bin'));
			// The run command itself must not change — the seam is env, never argv.
			assert.deepStrictEqual(plan.run, ['python3', path.join(RUN_DIR, 'main.py')]);
		});

		test('javascript resolves modules by NODE_PATH alone, no pathPrepend', () => {
			const plan = makeProgramEnv(PROGRAM_SPECS.javascript).emit(ctx({ libDir: '/cache/pnpm-1' }), RUN_DIR);
			assert.deepStrictEqual(plan.env, { NODE_PATH: path.join('/cache/pnpm-1', 'node_modules') });
			assert.strictEqual(plan.pathPrepend, undefined);
		});

		test('java gets a CLASSPATH ending in the trailing dot', () => {
			const plan = makeProgramEnv(PROGRAM_SPECS.java).emit(ctx({ libDir: '/cache/maven-1' }), RUN_DIR);
			assert.strictEqual(plan.env?.CLASSPATH, `${path.join('/cache/maven-1', 'jars', '*')}${path.delimiter}.`);
			// -cp is dropped so CLASSPATH governs, exactly like the function env.
			assert.ok(!plan.run.includes('-cp'));
		});

		test('rust gets CARGO_TARGET_DIR pointed at the shared cache', () => {
			const plan = makeProgramEnv(PROGRAM_SPECS.rust).emit(ctx({ libDir: '/cache/cargo-1' }), RUN_DIR);
			assert.strictEqual(plan.env?.CARGO_TARGET_DIR, path.join('/cache/cargo-1', 'target'));
			assert.ok(!plan.run.some(a => a.includes('/cache')), 'no cache path baked into argv');
		});
	});

	// ── PROGRAM_ENVS — one factory produces five envs ───────────────────────

	suite('PROGRAM_ENVS', () => {

		test('exactly one env per runnable language, all distinct', () => {
			assert.strictEqual(PROGRAM_ENVS.length, LANG_IDS.length);
			assert.deepStrictEqual(new Set(PROGRAM_ENVS.map(e => e.language)), new Set(LANG_IDS));
		});
	});

	// ── programSuiteTimeout — P5's own formula, not `call`'s ────────────────

	suite('programSuiteTimeout — the P5 budget, separate from the call formula', () => {

		test('charges spawn overhead on top of the per-case budget', () => {
			assert.strictEqual(programSuiteTimeout(3, 5000), 3 * (5000 + PROGRAM_SPAWN_OVERHEAD_MS));
		});

		test('nine JVM starts are admitted — the call cap (60s) must not truncate this', () => {
			const nineCases = programSuiteTimeout(9, 5000);
			assert.strictEqual(nineCases, 9 * (5000 + PROGRAM_SPAWN_OVERHEAD_MS));
			assert.ok(nineCases > 60_000, 'must exceed the call-suite cap to prove it is not reused here');
		});

		test('caps at MAX_PROGRAM_SUITE_TIMEOUT_MS, not the call suite cap', () => {
			assert.strictEqual(programSuiteTimeout(1000, 5000), MAX_PROGRAM_SUITE_TIMEOUT_MS);
		});

		test('a zero or negative case count still floors to one case', () => {
			assert.strictEqual(programSuiteTimeout(0, 5000), 1 * (5000 + PROGRAM_SPAWN_OVERHEAD_MS));
		});
	});
});
