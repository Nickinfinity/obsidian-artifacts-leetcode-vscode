import * as assert from 'node:assert';
import * as path from 'node:path';
import { javaFunctionEnv } from '../src/services/test-envs/function/java.env.js';
import { javascriptFunctionEnv } from '../src/services/test-envs/function/javascript.env.js';
import { pythonFunctionEnv } from '../src/services/test-envs/function/python.env.js';
import { rustFunctionEnv } from '../src/services/test-envs/function/rust.env.js';
import { typescriptFunctionEnv } from '../src/services/test-envs/function/typescript.env.js';
import { defaultPracticeConfig, defaultTestConfig } from '../src/services/leetcode-parser.service.js';
import type { EnvContext, TestEnv } from '../src/services/test-envs/env.types.js';
import type { ParsedLeetCode } from '../src/types/leetcode.types.js';

/**
 * How each `function` environment consumes a resolved library directory.
 *
 * The rule every language but Rust follows: **nothing changes except the
 * environment**. Same files, same `compile`, same `run` — a cache path is a
 * variable's value, never part of a command. Rust is the one exception, and it
 * is an exception about *shape*, not about command strings.
 */
suite('function envs — library consumption', () => {

	const CODE: Record<string, string> = {
		java: 'public static int identity(int n) { return n; }',
		python: 'def identity(n):\n    return n',
		javascript: 'function identity(n) { return n; }',
		typescript: 'function identity(n: number): number { return n; }',
		rust: 'fn identity(n: i32) -> i32 { n }',
	};

	function artifact(libs?: Record<string, string[]>): ParsedLeetCode {
		return {
			title: 'Identity', difficulty: 'easy', functionName: 'identity', status: 'unsolved',
			params: [{ name: 'n', type: 'int' }], returns: 'int', description: '',
			examples: [], tests: [], finalTests: [], test: defaultTestConfig(),
			setups: [], practice: defaultPracticeConfig(), solutions: [], attempts: [], tags: [],
			...(libs ? { libs } : {}),
		};
	}

	function contextFor(env: TestEnv, libDir?: string, libs?: Record<string, string[]>): EnvContext {
		return {
			parsed: artifact(libs),
			langId: env.language,
			code: CODE[env.language],
			cases: [{ input: { n: 1 }, expected: 1 }],
			...(libDir === undefined ? {} : { libDir }),
		};
	}

	const envs: TestEnv[] = [
		javaFunctionEnv, pythonFunctionEnv, javascriptFunctionEnv, typescriptFunctionEnv,
	];

	suite('no libDir — every existing path is byte-identical', () => {

		for (const env of [...envs, rustFunctionEnv]) {
			test(`${env.language} emits exactly what it always did`, () => {
				const program = env.emit(contextFor(env));

				assert.strictEqual(program.env, undefined);
				assert.strictEqual(program.pathPrepend, undefined);
			});
		}

		test('rust keeps the bare rustc shape', () => {
			const program = rustFunctionEnv.emit(contextFor(rustFunctionEnv));

			assert.strictEqual(program.compile, 'rustc -O runner.rs -o runner');
			assert.strictEqual(program.run, './runner');
			assert.deepStrictEqual(program.files.map(f => f.name), ['solution.rs', 'runner.rs']);
		});
	});

	suite('with libDir — variables only', () => {

		test('python resolves the venv interpreter through PATH', () => {
			const program = pythonFunctionEnv.emit(
				contextFor(pythonFunctionEnv, '/cache/pip-1', { python: ['numpy>=2'] }),
			);

			assert.strictEqual(program.pathPrepend, path.join('/cache/pip-1', 'bin'));
			assert.deepStrictEqual(program.env, { VIRTUAL_ENV: '/cache/pip-1' });
			assert.strictEqual(program.run, 'python3 runner.py', 'the run command must not change');
		});

		/**
		 * Setting `CLASSPATH` replaces the implicit current directory, so
		 * without the trailing `.` the JVM cannot find the `Runner.class` it
		 * just compiled into the temp dir.
		 */
		test('java gets a classpath that still contains the temp dir', () => {
			const program = javaFunctionEnv.emit(
				contextFor(javaFunctionEnv, '/cache/maven-1', { java: ['com.google.guava:guava:33.3.1-jre'] }),
			);

			assert.strictEqual(
				program.env?.CLASSPATH,
				`${path.join('/cache/maven-1', 'jars', '*')}${path.delimiter}.`,
			);
			assert.strictEqual(program.compile, 'javac Solution.java Runner.java');
			// `-cp` on the command line would override CLASSPATH outright, so the
			// libs path drops it and lets the variable govern.
			assert.strictEqual(program.run, 'java Runner');
			assert.strictEqual(javaFunctionEnv.emit(contextFor(javaFunctionEnv)).run, 'java -cp . Runner');
		});

		for (const env of [javascriptFunctionEnv, typescriptFunctionEnv]) {
			test(`${env.language} resolves node modules by NODE_PATH alone`, () => {
				const before = env.emit(contextFor(env));
				const after = env.emit(contextFor(env, '/cache/pnpm-1', { [env.language]: ['left-pad@1.0.0'] }));

				assert.deepStrictEqual(after.env, { NODE_PATH: path.join('/cache/pnpm-1', 'node_modules') });
				assert.strictEqual(after.pathPrepend, undefined);
				assert.strictEqual(after.run, before.run, 'the run command must not change');
				assert.deepStrictEqual(
					after.files.map(f => f.name), before.files.map(f => f.name),
					'the sandbox file set must not grow',
				);
				assert.deepStrictEqual(
					after.files.map(f => f.content), before.files.map(f => f.content),
					'this changes resolution, never capability',
				);
			});
		}
	});

	suite('rust — a Cargo project beside the rustc path', () => {

		const libs = { rust: ['serde@^1+derive'] };

		test('libs switch the emit to a Cargo project', () => {
			const program = rustFunctionEnv.emit(contextFor(rustFunctionEnv, '/cache/cargo-1', libs));

			assert.deepStrictEqual(
				program.files.map(f => f.name).sort(),
				['Cargo.toml', path.join('src', 'main.rs'), path.join('src', 'solution.rs')].sort(),
			);
			assert.strictEqual(program.env?.CARGO_TARGET_DIR, path.join('/cache/cargo-1', 'target'));
		});

		/**
		 * `CARGO_TARGET_DIR` lives in the shared cache, so `./target/release/…`
		 * does not exist under the run's `cwd` — and naming the real path would
		 * put a cache path inside a command string.
		 */
		/**
		 * `compile` and `run` carry different budgets — `COMPILE_TIMEOUT_MS` vs
		 * the suite's `cases × timeoutMs`. Leaving the build to `cargo run`
		 * would spend a case budget on a link and fold it into case 0's timing.
		 */
		test('the build happens in the compile step, not inside run', () => {
			const program = rustFunctionEnv.emit(contextFor(rustFunctionEnv, '/cache/cargo-1', libs));

			assert.strictEqual(program.compile, 'cargo build --offline --release --quiet');
		});

		test('the run command names no path into target/', () => {
			const program = rustFunctionEnv.emit(contextFor(rustFunctionEnv, '/cache/cargo-1', libs));

			assert.strictEqual(program.run, 'cargo run --offline --release --quiet');
			assert.strictEqual(program.run.includes('/cache'), false);
			assert.strictEqual(program.compile?.includes('/cache'), false);
		});

		test('the declared crate reaches the manifest with its features', () => {
			const program = rustFunctionEnv.emit(contextFor(rustFunctionEnv, '/cache/cargo-1', libs));
			const manifest = program.files.find(f => f.name === 'Cargo.toml')?.content ?? '';

			assert.match(manifest, /^serde = \{ version = "\^1", features = \["derive"\] \}$/m);
		});

		test('the candidate is still written verbatim, as its own unit', () => {
			const program = rustFunctionEnv.emit(contextFor(rustFunctionEnv, '/cache/cargo-1', libs));
			const solution = program.files.find(f => f.name === path.join('src', 'solution.rs'))?.content ?? '';

			assert.match(solution, /pub fn identity\(n: i32\) -> i32 \{ n \}/);
		});

		/** Concurrent suites share one target dir; equal names overwrite one binary. */
		test('two runs of different code get different package names', () => {
			const one = rustFunctionEnv.emit(contextFor(rustFunctionEnv, '/cache/cargo-1', libs));
			const other = rustFunctionEnv.emit({
				...contextFor(rustFunctionEnv, '/cache/cargo-1', libs),
				code: 'fn identity(n: i32) -> i32 { n + 0 }',
			});

			const nameOf = (files: { name: string; content: string }[]): string =>
				/^name = "(.+)"$/m.exec(files.find(f => f.name === 'Cargo.toml')?.content ?? '')?.[1] ?? '';

			assert.notStrictEqual(nameOf(one.files), nameOf(other.files));
			assert.match(nameOf(one.files), /^leet_[0-9a-f]{8}$/);
		});
	});
});
