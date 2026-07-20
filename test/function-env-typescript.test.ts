import * as assert from 'node:assert';
import {
    nodeSupportsStripTypes,
    typescriptFunctionEnv,
} from '../src/services/test-envs/function/typescript.env.js';
import { runSuite } from '../src/services/leetcode-runner.service.js';
import { defaultPracticeConfig, defaultTestConfig } from '../src/services/leetcode-parser.service.js';
import type { EmittedProgram } from '../src/services/test-envs/env.types.js';
import type { ParsedLeetCode, TestCase } from '../src/types/leetcode.types.js';

/** Shared fixture builder for the `function × typescript` environment. */
function fixture(overrides: Partial<ParsedLeetCode> = {}): ParsedLeetCode {
    return {
        title: 'Add', difficulty: 'easy', functionName: 'add', status: 'unsolved',
        params: [{ name: 'a', type: 'int' }, { name: 'b', type: 'int' }],
        returns: 'int', description: '', examples: [],
        tests: [], finalTests: [], test: defaultTestConfig(),
        setups: [], practice: defaultPracticeConfig(), solutions: [], attempts: [], tags: [],
        ...overrides,
    };
}

const CASES: TestCase[] = [
    { input: { a: 1, b: 2 }, expected: 3 },
    { input: { a: 10, b: 5 }, expected: 15 },
];

const CODE = 'function add(a: number, b: number): number { return a + b; }';

suite('function × typescript env', () => {

    const emit = (code = CODE): EmittedProgram =>
        typescriptFunctionEnv.emit({ parsed: fixture(), langId: 'typescript', code, cases: CASES });

    const fileNamed = (p: EmittedProgram, name: string): string => {
        const f = p.files.find(x => x.name === name);
        assert.ok(f, `expected an emitted file ${name}`);
        return f.content;
    };

    // ── emit ──────────────────────────────────────────────────────────────────

    suite('emit', () => {

        test('declares the env identity', () => {
            assert.strictEqual(typescriptFunctionEnv.type, 'function');
            assert.strictEqual(typescriptFunctionEnv.language, 'typescript');
        });

        test('writes the candidate verbatim as sol.ts and a generated runner.js', () => {
            const p = emit();
            assert.deepStrictEqual(p.files.map(f => f.name).sort(), ['runner.js', 'sol.ts']);
            assert.strictEqual(fileNamed(p, 'sol.ts').trim(), CODE);
            assert.strictEqual(p.run, 'node runner.js');
            assert.strictEqual(p.compile, undefined);
        });

        test('runner strips types before evaluating sol.ts in a vm sandbox, does not splice it', () => {
            const runner = fileNamed(emit(), 'runner.js');
            assert.ok(runner.includes("require('node:module')"));
            assert.ok(runner.includes('stripTypeScriptTypes(__tsSrc)'));
            assert.ok(runner.includes('vm.createContext(__sandbox)'));
            assert.ok(runner.includes("vm.runInContext(__src, __sandbox, { filename: 'sol.ts' })"));
            assert.ok(!runner.includes('return a + b'));
        });

        test('pulls the function out of the sandbox by name', () => {
            assert.ok(fileNamed(emit(), 'runner.js').includes('__fn = __sandbox["add"]'));
        });

        test('a functions: override is what the runner pulls from the sandbox, not functionName', () => {
            const parsed = fixture({ functions: { typescript: 'solve' } });
            const overrideCode = 'function solve(a: number, b: number): number { return a + b; }';
            const runner = fileNamed(
                typescriptFunctionEnv.emit({ parsed, langId: 'typescript', code: overrideCode, cases: CASES }),
                'runner.js',
            );
            assert.ok(runner.includes('__fn = __sandbox["solve"]'));
        });

        test('emits argument literals and per-case try/catch', () => {
            const runner = fileNamed(emit(), 'runner.js');
            assert.ok(runner.includes('[1, 2]'));
            assert.ok(runner.includes('} catch (__e) {'));
        });

        test('carries its own canonical stringifier and sentinel emit', () => {
            const runner = fileNamed(emit(), 'runner.js');
            assert.ok(runner.includes('function __canon(v)'));
            assert.ok(runner.includes('"__LEET__"'));
        });

        test('a strip/eval failure is caught once and reported per case, not left to crash the process', () => {
            const runner = fileNamed(emit(), 'runner.js');
            assert.ok(runner.includes('__loadErr'));
            assert.ok(runner.includes("if (__loadErr !== null) {"));
        });
    });

    // ── validate ──────────────────────────────────────────────────────────────

    suite('validate', () => {

        const check = (code: string): string | null =>
            typescriptFunctionEnv.validate!({ parsed: fixture(), langId: 'typescript', code, cases: CASES });

        test('a candidate mentioning the function name passes', () => {
            assert.strictEqual(check(CODE), null);
            assert.strictEqual(check('const add = (a: number, b: number): number => a + b;'), null);
        });

        test('rejects a candidate that never mentions the name', () => {
            const msg = check('function solve(a: number, b: number): number { return a; }');
            assert.ok(msg);
            assert.ok(/add/.test(msg));
        });

        test('a functions: override requires the overridden name, not functionName', () => {
            const parsed = fixture({ functions: { typescript: 'solve' } });
            const msg = typescriptFunctionEnv.validate!({ parsed, langId: 'typescript', code: CODE, cases: CASES });
            assert.ok(msg);
            assert.ok(/solve/.test(msg));
        });
    });

    // ── parse ─────────────────────────────────────────────────────────────────

    suite('parse', () => {

        test('round-trips an emitted result line', () => {
            assert.deepStrictEqual(
                typescriptFunctionEnv.parse('__LEET__{"index":0,"actual":"3","ms":3}\n'),
                [{ index: 0, actual: '3', ms: 3 }],
            );
        });

        test("ignores the solver's own stdout noise", () => {
            const stdout = 'hello\n__LEET__{"index":0,"actual":"1","ms":0}\ntrailing';
            assert.strictEqual(typescriptFunctionEnv.parse(stdout).length, 1);
        });
    });

    // ── detect ────────────────────────────────────────────────────────────────

    suite('nodeSupportsStripTypes', () => {

        test('true on and above the 22.x floor', () => {
            assert.strictEqual(nodeSupportsStripTypes('v22.18.0'), true);
            assert.strictEqual(nodeSupportsStripTypes('v22.20.1'), true);
        });

        test('false below the 22.x floor', () => {
            assert.strictEqual(nodeSupportsStripTypes('v22.17.9'), false);
            assert.strictEqual(nodeSupportsStripTypes('v22.0.0'), false);
        });

        test('true on and above the 23.x floor, false below it', () => {
            assert.strictEqual(nodeSupportsStripTypes('v23.10.0'), true);
            assert.strictEqual(nodeSupportsStripTypes('v23.9.0'), false);
        });

        test('any 24+ line is always supported', () => {
            assert.strictEqual(nodeSupportsStripTypes('v24.0.0'), true);
            assert.strictEqual(nodeSupportsStripTypes('v26.5.0'), true);
        });

        test('every Node line below 22 is unsupported', () => {
            assert.strictEqual(nodeSupportsStripTypes('v21.7.3'), false);
            assert.strictEqual(nodeSupportsStripTypes('v18.20.0'), false);
        });

        test('an unparsable version string is treated as unsupported', () => {
            assert.strictEqual(nodeSupportsStripTypes('not-a-version'), false);
        });

        test('detect() reflects the actual running process (Node ≥ 22.18 in this repo)', async () => {
            assert.strictEqual(await typescriptFunctionEnv.detect!(), nodeSupportsStripTypes(process.version));
        });
    });

    test('requires carries the honest floor message the missing-dependency toast displays', () => {
        assert.ok(typescriptFunctionEnv.requires?.some(r => /Node 22\.18/.test(r)));
    });

    // ── real subprocess: a typed candidate actually runs ────────────────────────

    suite('runSuite (real node subprocess)', () => {

        test('a correct typed candidate runs green', async () => {
            const results = await runSuite(CODE, CASES, fixture(), typescriptFunctionEnv);
            assert.strictEqual(results.length, 2);
            assert.ok(results.every(r => r.passed), JSON.stringify(results));
        });

        test('type annotations are erased, not enforced — a lying return type still runs', async () => {
            const lying = 'function add(a: number, b: number): string { return a + b; }';
            const results = await runSuite(lying, CASES, fixture(), typescriptFunctionEnv);
            assert.strictEqual(results[0].actual, '3');
        });

        test('generics and interfaces strip cleanly too', async () => {
            const generic = [
                'interface Pair { a: number; b: number; }',
                'function add<T extends Pair>(a: number, b: number): number { return a + b; }',
            ].join('\n');
            const results = await runSuite(generic, CASES, fixture(), typescriptFunctionEnv);
            assert.ok(results.every(r => r.passed), JSON.stringify(results));
        });

        test('non-erasable syntax (enum) fails every case with the honest native message', async () => {
            const hostile = [
                'enum Op { Add, Sub }',
                'function add(a: number, b: number): number { return a + b; }',
            ].join('\n');
            const results = await runSuite(hostile, CASES, fixture(), typescriptFunctionEnv);
            assert.strictEqual(results.length, 2);
            for (const r of results) {
                assert.strictEqual(r.passed, false);
                assert.ok(r.error?.includes('enum is not supported in strip-only mode'), r.error);
            }
        });

        test('non-erasable syntax (parameter properties) fails every case honestly', async () => {
            const hostile = [
                'class Box { constructor(public a: number) {} }',
                'function add(a: number, b: number): number { return a + b; }',
            ].join('\n');
            const results = await runSuite(hostile, CASES, fixture(), typescriptFunctionEnv);
            for (const r of results) {
                assert.strictEqual(r.passed, false);
                assert.ok(r.error?.includes('parameter property is not supported'), r.error);
            }
        });

        test('a hostile candidate that throws still fails one case, not the suite', async () => {
            const throws = 'function add(a: number, b: number): number { if (a === 1) { throw new Error("boom"); } return a + b; }';
            const results = await runSuite(throws, CASES, fixture(), typescriptFunctionEnv);
            assert.strictEqual(results.length, 2);
            assert.strictEqual(results[0].error, 'boom');
            assert.strictEqual(results[1].passed, true);
        });

        test('a candidate reaching for require/process still runs inside the same sandbox shape as the JS env', async () => {
            // Not a widened surface — the sandbox object is identical to the JS
            // env's; this only proves TS didn't shrink or change it.
            const reaches = 'function add(a: number, b: number): number { return typeof require === "function" && typeof process === "object" ? a + b : -1; }';
            const results = await runSuite(reaches, CASES, fixture(), typescriptFunctionEnv);
            assert.ok(results.every(r => r.passed), JSON.stringify(results));
        });
    });
});
