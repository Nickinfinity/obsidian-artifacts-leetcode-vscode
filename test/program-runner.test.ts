import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { runProgramSuite } from '../src/services/test-envs/program/program.runner.js';
import { makeProgramEnv } from '../src/services/test-envs/program/make-program-env.js';
import { PROGRAM_SPECS } from '../src/services/test-envs/program/specs.js';
import type { ProgramConfig } from '../src/services/program-config.helpers.js';
import type { ParsedLeetCode, TestCase } from '../src/types/leetcode.types.js';

/**
 * End-to-end tests for the `program` suite runner — the per-case spawn loop
 * (P5). These run **real** `node` subprocesses rather than stubbing the
 * spawn: the whole point of this module is that argv, stdin and `$LEET_OUT`
 * reach a separate process per case, and a stubbed child would assert the
 * plumbing against itself.
 *
 * `javascript` is the language throughout because `node` is the one runtime
 * guaranteed present — this repo runs on it.
 */
suite('program suite runner', () => {

	const jsEnv = makeProgramEnv(PROGRAM_SPECS.javascript);

	/** Sum two argv numbers into `$LEET_OUT`. The shape every starter emits (D6). */
	const SUM_ARGV = [
		'const [a, b] = process.argv.slice(2).map(Number);',
		'require("node:fs").writeFileSync(process.env.LEET_OUT, JSON.stringify(a + b));',
	].join('\n');

	function parsedFixture(timeoutMs = 5000): ParsedLeetCode {
		return {
			params: [{ name: 'a', type: 'int' }, { name: 'b', type: 'int' }],
			test:   { type: 'program', timeoutMs },
		} as unknown as ParsedLeetCode;
	}

	const argvConfig: ProgramConfig = { channel: 'argv' };

	function cases(...pairs: [number, number, unknown][]): TestCase[] {
		return pairs.map(([a, b, expected]) => ({ input: { a, b }, expected } as unknown as TestCase));
	}

	async function inTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'leet-progrun-'));
		try {
			return await fn(dir);
		} finally {
			await fs.rm(dir, { recursive: true, force: true }).catch(() => { /* ignore */ });
		}
	}

	test('each case is its own process, graded on what it wrote to $LEET_OUT', async () => {
		const results = await inTempDir(dir => runProgramSuite({
			code: SUM_ARGV, tests: cases([1, 2, 3], [10, 5, 15], [0, 0, 0]),
			parsed: parsedFixture(), env: jsEnv, program: argvConfig, runDir: dir,
		}));

		assert.strictEqual(results.length, 3);
		assert.deepStrictEqual(results.map(r => r.actual), ['3', '15', '0']);
		assert.ok(results.every(r => r.passed), JSON.stringify(results));
	});

	test('a wrong answer fails and reports what the program actually wrote', async () => {
		const results = await inTempDir(dir => runProgramSuite({
			code: SUM_ARGV, tests: cases([2, 2, 5]),
			parsed: parsedFixture(), env: jsEnv, program: argvConfig, runDir: dir,
		}));

		assert.strictEqual(results[0].passed, false);
		assert.strictEqual(results[0].actual, '4');
	});

	/**
	 * D6: the solver's stdout is theirs. The graded value is the out-of-band
	 * file, so debug output cannot corrupt a case the way it would corrupt a
	 * `__LEET__` sentinel stream.
	 */
	test('the program\'s own stdout is free — debug output does not corrupt grading', async () => {
		const noisy = [
			'console.log("__LEET__ not really a sentinel");',
			'console.log(JSON.stringify({ index: 0, actual: "999" }));',
			SUM_ARGV,
		].join('\n');

		const results = await inTempDir(dir => runProgramSuite({
			code: noisy, tests: cases([1, 1, 2]),
			parsed: parsedFixture(), env: jsEnv, program: argvConfig, runDir: dir,
		}));

		assert.strictEqual(results[0].actual, '2');
		assert.ok(results[0].passed);
	});

	test('a program that writes no $LEET_OUT file fails — never an empty, and therefore green, case', async () => {
		const results = await inTempDir(dir => runProgramSuite({
			code: 'console.log("I did nothing useful");', tests: cases([1, 2, 3]),
			parsed: parsedFixture(), env: jsEnv, program: argvConfig, runDir: dir,
		}));

		assert.strictEqual(results[0].passed, false);
		assert.match(results[0].error ?? '', /LEET_OUT/);
	});

	test('a crashing case fails alone; the cases after it still run', async () => {
		const crashOnFirst = [
			'const [a, b] = process.argv.slice(2).map(Number);',
			'if (a === 1) { throw new Error("boom"); }',
			'require("node:fs").writeFileSync(process.env.LEET_OUT, JSON.stringify(a + b));',
		].join('\n');

		const results = await inTempDir(dir => runProgramSuite({
			code: crashOnFirst, tests: cases([1, 1, 2], [3, 4, 7]),
			parsed: parsedFixture(), env: jsEnv, program: argvConfig, runDir: dir,
		}));

		assert.strictEqual(results[0].passed, false);
		assert.strictEqual(results[1].passed, true, 'the suite must not stop at the first crash');
		assert.strictEqual(results[1].actual, '7');
	});

	/**
	 * C23(b), and the reason `PROGRAM_SPAWN_OVERHEAD_MS` exists at all. The
	 * budget is **per case**, not one wall-clock alarm armed across the loop:
	 * with a single deadline, one slow case eats the whole suite's allowance
	 * and every case after it is reported `timeout` on code that was never
	 * slow — exactly the misattribution P5 set out to prevent.
	 *
	 * The per-case budget here is deliberately tiny so the sleep blows it
	 * without making the test slow.
	 */
	// eslint-disable-next-line prefer-arrow-callback -- `this.timeout` needs a function
	test('one slow case times out alone — its budget is per case, not one alarm for the suite', async function () {
		// The per-case kill is `timeoutMs + PROGRAM_SPAWN_OVERHEAD_MS`, so the
		// slow case burns ~2.3 s of real time before it is killed. Mocha's own
		// 2 s default would fire first and report this as a test-harness
		// timeout rather than the runner's, which is not what is under test.
		this.timeout(30_000);
		const sleepOnFirst = [
			'const [a, b] = process.argv.slice(2).map(Number);',
			'if (a === 1) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000); }',
			'require("node:fs").writeFileSync(process.env.LEET_OUT, JSON.stringify(a + b));',
		].join('\n');

		const results = await inTempDir(dir => runProgramSuite({
			code: sleepOnFirst, tests: cases([1, 1, 2], [3, 4, 7], [5, 5, 10]),
			parsed: parsedFixture(300), env: jsEnv, program: argvConfig, runDir: dir,
		}));

		assert.strictEqual(results[0].passed, false, 'the slow case must fail');
		assert.strictEqual(results[1].passed, true, 'a later case must still get its own budget');
		assert.strictEqual(results[2].passed, true, 'and so must the one after that');
	});

	test('the stdin channel feeds the case through stdin, not argv', async () => {
		const readStdin = [
			'const lines = require("node:fs").readFileSync(0, "utf8").trim().split("\\n");',
			'const [a, b] = lines.map(Number);',
			'require("node:fs").writeFileSync(process.env.LEET_OUT, JSON.stringify(a * b));',
		].join('\n');

		const results = await inTempDir(dir => runProgramSuite({
			code: readStdin, tests: cases([6, 7, 42]),
			parsed: parsedFixture(), env: jsEnv, program: { channel: 'stdin' }, runDir: dir,
		}));

		assert.strictEqual(results[0].actual, '42');
		assert.ok(results[0].passed, JSON.stringify(results[0]));
	});

	/**
	 * The stale-`$LEET_OUT` false green, caught in review after it shipped.
	 *
	 * `mintOutChannelPath` is deterministic per `(runDir, index)`, and the live
	 * solve flow reuses **one** attempt directory across Run Tests and Submit.
	 * So a case that wrote its answer on an earlier run leaves that file on
	 * disk, and a later program that writes nothing is graded against it —
	 * reported green having computed nothing. Measured before the fix: pass 1
	 * with working code and pass 2 with a program that only prints both
	 * returned `passed: true, actual: "3"`.
	 *
	 * The same guard closes the other half: the attempt tree is open in the
	 * solver's editor, so a `leet-out-0.json` they create by hand would
	 * otherwise be indistinguishable from one their program wrote.
	 */
	test('a previous run\'s $LEET_OUT never grades the next one — the file is removed before each case', async () => {
		await inTempDir(async dir => {
			const good = await runProgramSuite({
				code: SUM_ARGV, tests: cases([1, 2, 3]),
				parsed: parsedFixture(), env: jsEnv, program: argvConfig, runDir: dir,
			});
			assert.ok(good[0].passed, 'the working program must pass first');

			// Same directory, same case index — only the program is broken now.
			const broken = await runProgramSuite({
				code: 'console.log("I compute nothing now");', tests: cases([1, 2, 3]),
				parsed: parsedFixture(), env: jsEnv, program: argvConfig, runDir: dir,
			});
			assert.strictEqual(broken[0].passed, false, 'a program that writes nothing must fail');
			assert.match(broken[0].error ?? '', /LEET_OUT/);
		});
	});

	test('a hand-planted $LEET_OUT file does not answer for a program that writes none', async () => {
		await inTempDir(async dir => {
			await fs.writeFile(path.join(dir, 'leet-out-0.json'), '3', 'utf-8');

			const results = await runProgramSuite({
				code: 'console.log("nothing");', tests: cases([1, 2, 3]),
				parsed: parsedFixture(), env: jsEnv, program: argvConfig, runDir: dir,
			});
			assert.strictEqual(results[0].passed, false);
		});
	});

	/**
	 * Hostile case data must fail **that case**, never escape the suite. The
	 * panel routes messages as `void routeMessage(...)` with no catch, so a
	 * throw from here reached nothing that could report it — and on Submit it
	 * escaped *after* the session was claimed, leaving every later Submit
	 * silently refusing until the window was reloaded.
	 */
	test('a NUL byte in a case value fails that case alone, rather than throwing out of the suite', async () => {
		const results = await inTempDir(dir => runProgramSuite({
			code: SUM_ARGV,
			tests: [
				{ input: { a: 'x\u0000y', b: 1 }, expected: 0 },
				{ input: { a: 3, b: 4 }, expected: 7 },
			] as unknown as TestCase[],
			parsed: parsedFixture(), env: jsEnv, program: argvConfig, runDir: dir,
		}));

		assert.strictEqual(results.length, 2);
		assert.strictEqual(results[0].passed, false);
		assert.match(results[0].error ?? '', /NUL|null byte/i);
		assert.strictEqual(results[1].passed, true, 'the suite must continue past a refused case');
	});

	test('an empty suite runs nothing and returns nothing', async () => {
		const results = await inTempDir(dir => runProgramSuite({
			code: SUM_ARGV, tests: [], parsed: parsedFixture(), env: jsEnv, program: argvConfig, runDir: dir,
		}));
		assert.deepStrictEqual(results, []);
	});
});
