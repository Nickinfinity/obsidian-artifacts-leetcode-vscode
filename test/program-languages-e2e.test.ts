import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { makeProgramEnv } from '../src/services/test-envs/program/make-program-env.js';
import { runProgramSuite } from '../src/services/test-envs/program/program.runner.js';
import { PROGRAM_SPECS } from '../src/services/test-envs/program/specs.js';
import type { ProgramConfig } from '../src/services/program-config.helpers.js';
import type { LangId } from '../src/types/languages.js';
import type { ParsedLeetCode, TestCase, TestResult } from '../src/types/leetcode.types.js';

/**
 * VSX-145 acceptance evidence: all five `LangId`s grade a `program` suite
 * end to end through **real** subprocesses, never a stubbed spawn.
 *
 * `program-runner.test.ts` already proves the per-case-process plumbing (P5)
 * for `javascript` alone; the epic's "all five languages" claim otherwise
 * rested on one vault artifact (python) and that one test file (javascript).
 * This file is the missing four languages, run through the same
 * `runProgramSuite` entry point every solver's Submit goes through.
 *
 * `javascript` runs unconditionally — `node` is this repo's own runtime, the
 * same reasoning `program-runner.test.ts` already gives. `java` / `python` /
 * `rust` / `typescript` need real toolchains on the machine and are gated
 * behind `LEET_PROGRAM_E2E=1`, `pending` otherwise — the exact precedent set
 * by the `LEET_PROJECT_E2E` render tests (`project-render-driver.test.ts`,
 * `project-checks.test.ts`): the default gate stays deterministic and offline.
 */
suite('program suite runner — five languages [P5/VSX-145]', () => {

	const argvConfig: ProgramConfig = { channel: 'argv' };

	function parsedFixture(timeoutMs = 5000): ParsedLeetCode {
		return {
			params: [{ name: 'a', type: 'int' }, { name: 'b', type: 'int' }],
			test:   { type: 'program', timeoutMs },
		} as unknown as ParsedLeetCode;
	}

	/** Two cases: a genuine sum, and a wrong `expected` — rules out a green-by-vacancy run. */
	function sumCases(): TestCase[] {
		return [
			{ input: { a: 2, b: 3 }, expected: 5 },
			{ input: { a: 2, b: 3 }, expected: 999 },
		] as unknown as TestCase[];
	}

	async function inTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'leet-proglang-'));
		try {
			return await fn(dir);
		} finally {
			await fs.rm(dir, { recursive: true, force: true }).catch(() => { /* ignore */ });
		}
	}

	/**
	 * One candidate per language: sum two argv numbers into `$LEET_OUT`. Each
	 * reads the raw shape `runProgramSuite` actually hands a candidate — argv
	 * elements via `process.argv`/`sys.argv`/`args`/`env::args` — and writes
	 * through the out-of-band channel, never stdout.
	 */
	const CANDIDATES: Record<LangId, string> = {
		javascript: [
			'const [a, b] = process.argv.slice(2).map(Number);',
			'require("node:fs").writeFileSync(process.env.LEET_OUT, JSON.stringify(a + b));',
		].join('\n'),
		python: [
			'import sys, os, json',
			'a, b = (int(x) for x in sys.argv[1:3])',
			'with open(os.environ["LEET_OUT"], "w") as f:',
			'    json.dump(a + b, f)',
		].join('\n'),
		// `PROGRAM_SPECS.java.defaultEntry` is `Main.java`; `selectRunner` derives
		// the class name from the entry's basename, so it must be `Main`.
		java: [
			'import java.nio.file.Files;',
			'import java.nio.file.Paths;',
			'public class Main {',
			'    public static void main(String[] args) throws Exception {',
			'        int a = Integer.parseInt(args[0]);',
			'        int b = Integer.parseInt(args[1]);',
			'        Files.writeString(Paths.get(System.getenv("LEET_OUT")), String.valueOf(a + b));',
			'    }',
			'}',
		].join('\n'),
		// No `libs:`/manifest, so `selectRunner` takes the light `rustc -O` path.
		rust: [
			'use std::env;',
			'use std::fs;',
			'fn main() {',
			'    let args: Vec<String> = env::args().collect();',
			'    let a: i64 = args[1].parse().unwrap();',
			'    let b: i64 = args[2].parse().unwrap();',
			'    fs::write(env::var("LEET_OUT").unwrap(), (a + b).to_string()).unwrap();',
			'}',
		].join('\n'),
		// `selectRunner` runs `node main.ts` directly — never `tsc` (house rule).
		// Only erasable syntax here (plain annotations, an `as` cast), the shape
		// node's own type stripping accepts with no flag on a modern runtime.
		typescript: [
			'const args: string[] = process.argv.slice(2);',
			'const a: number = Number(args[0]);',
			'const b: number = Number(args[1]);',
			'require("node:fs").writeFileSync(process.env.LEET_OUT as string, JSON.stringify(a + b));',
		].join('\n'),
	};

	/**
	 * The shared floor every language must clear: a genuine case passes, a
	 * wrong-`expected` case fails. Two assertions, not one — a suite that
	 * always reports "passed" (or always "failed") would satisfy a
	 * single-case check for the wrong reason.
	 */
	async function assertGradesBothWays(langId: LangId): Promise<TestResult[]> {
		const env = makeProgramEnv(PROGRAM_SPECS[langId]);
		const results = await inTempDir(dir => runProgramSuite({
			code: CANDIDATES[langId],
			tests: sumCases(),
			parsed: parsedFixture(),
			env, program: argvConfig, runDir: dir,
		}));

		assert.strictEqual(results.length, 2, JSON.stringify(results));
		assert.strictEqual(results[0].actual, '5', `${langId}: ${JSON.stringify(results[0])}`);
		assert.strictEqual(results[0].passed, true, `${langId}: correct case must pass — ${JSON.stringify(results[0])}`);
		assert.strictEqual(results[1].passed, false, `${langId}: wrong-expected case must fail — ${JSON.stringify(results[1])}`);
		return results;
	}

	test('javascript grades a real suite — a passing case and a wrong-expected failure', async function () {
		this.timeout(30_000);
		await assertGradesBothWays('javascript');
	});

	test('python grades a real suite — a passing case and a wrong-expected failure [LEET_PROGRAM_E2E=1]', async function () {
		if (process.env.LEET_PROGRAM_E2E !== '1') { this.skip(); }
		this.timeout(30_000);
		await assertGradesBothWays('python');
	});

	test('java grades a real suite — a passing case and a wrong-expected failure [LEET_PROGRAM_E2E=1]', async function () {
		if (process.env.LEET_PROGRAM_E2E !== '1') { this.skip(); }
		this.timeout(60_000);
		await assertGradesBothWays('java');
	});

	test('rust grades a real suite — a passing case and a wrong-expected failure [LEET_PROGRAM_E2E=1]', async function () {
		if (process.env.LEET_PROGRAM_E2E !== '1') { this.skip(); }
		this.timeout(60_000);
		await assertGradesBothWays('rust');
	});

	test('typescript grades a real suite — a passing case and a wrong-expected failure [LEET_PROGRAM_E2E=1]', async function () {
		if (process.env.LEET_PROGRAM_E2E !== '1') { this.skip(); }
		this.timeout(30_000);
		await assertGradesBothWays('typescript');
	});
});
