import * as assert from 'node:assert';
import { javascriptFunctionEnv } from '../src/services/test-envs/function/javascript.env.js';
import { defaultPracticeConfig, defaultTestConfig } from '../src/services/leetcode-parser.service.js';
import type { EmittedProgram } from '../src/services/test-envs/env.types.js';
import type { ParsedLeetCode, TestCase } from '../src/types/leetcode.types.js';

/** Shared fixture builder for the `function × javascript` environment. */
function fixture(overrides: Partial<ParsedLeetCode> = {}): ParsedLeetCode {
    return {
        title: 'Two Sum', difficulty: 'easy', functionName: 'twoSum', status: 'unsolved',
        leetcodeType: 'function',
        params: [{ name: 'nums', type: 'int[]' }, { name: 'target', type: 'int' }],
        returns: 'int[]', description: '', examples: [],
        tests: [], finalTests: [], test: defaultTestConfig(),
        setups: [], practice: defaultPracticeConfig(), solutions: [], attempts: [], tags: [],
        ...overrides,
    };
}

const CASES: TestCase[] = [
    { input: { nums: [2, 7], target: 9 }, expected: [0, 1] },
    { input: { nums: [3, 2, 4], target: 6 }, expected: [1, 2] },
];

const CODE = 'function twoSum(nums, target) { return [0, 1]; }';

suite('function × javascript env', () => {

    const emit = (code = CODE): EmittedProgram =>
        javascriptFunctionEnv.emit({ parsed: fixture(), langId: 'javascript', code, cases: CASES });

    const fileNamed = (p: EmittedProgram, name: string): string => {
        const f = p.files.find(x => x.name === name);
        assert.ok(f, `expected an emitted file ${name}`);
        return f.content;
    };

    // ── emit ──────────────────────────────────────────────────────────────────

    suite('emit', () => {

        test('declares the env identity', () => {
            assert.strictEqual(javascriptFunctionEnv.type, 'call');
            assert.strictEqual(javascriptFunctionEnv.language, 'javascript');
        });

        test('writes the candidate verbatim as sol.js and a generated runner.js', () => {
            const p = emit();
            assert.deepStrictEqual(p.files.map(f => f.name).sort(), ['runner.js', 'sol.js']);
            assert.strictEqual(fileNamed(p, 'sol.js').trim(), CODE);
            assert.strictEqual(p.run, 'node runner.js');
            assert.strictEqual(p.compile, undefined);
        });

        test('runner evaluates the candidate in a vm sandbox, does not splice it', () => {
            const runner = fileNamed(emit(), 'runner.js');
            assert.ok(runner.includes("require('vm')"));
            assert.ok(runner.includes('vm.createContext(__sandbox)'));
            assert.ok(runner.includes("vm.runInContext(__src, __sandbox, { filename: 'sol.js' })"));
            assert.ok(!runner.includes('return [0, 1]'));
        });

        test('pulls the function out of the sandbox by name', () => {
            assert.ok(fileNamed(emit(), 'runner.js').includes('const __fn = __sandbox["twoSum"]'));
        });

        test('a functions: override is what the runner pulls from the sandbox, not functionName', () => {
            const parsed = fixture({ functions: { javascript: 'solve' } });
            const overrideCode = 'function solve(nums, target) { return [0, 1]; }';
            const runner = fileNamed(
                javascriptFunctionEnv.emit({ parsed, langId: 'javascript', code: overrideCode, cases: CASES }),
                'runner.js',
            );
            assert.ok(runner.includes('const __fn = __sandbox["solve"]'));
        });

        test('emits argument literals and per-case try/catch', () => {
            const runner = fileNamed(emit(), 'runner.js');
            assert.ok(runner.includes('[[2, 7], 9]'));
            assert.ok(runner.includes('} catch (__e) {'));
        });

        test('carries its own canonical stringifier and sentinel emit', () => {
            const runner = fileNamed(emit(), 'runner.js');
            assert.ok(runner.includes('function __canon(v)'));
            assert.ok(runner.includes('"__LEET__"'));
        });
    });

    // ── validate ──────────────────────────────────────────────────────────────

    suite('validate', () => {

        const check = (code: string): string | null =>
            javascriptFunctionEnv.validate!({ parsed: fixture(), langId: 'javascript', code, cases: CASES });

        test('a candidate mentioning the function name passes', () => {
            assert.strictEqual(check(CODE), null);
            assert.strictEqual(check('const twoSum = (a, b) => [0, 1];'), null);
        });

        test('rejects a candidate that never mentions the name', () => {
            const msg = check('function solve(a, b) { return a; }');
            assert.ok(msg);
            assert.ok(/twoSum/.test(msg));
        });

        test('a functions: override requires the overridden name, not functionName', () => {
            const parsed = fixture({ functions: { javascript: 'solve' } });
            const msg = javascriptFunctionEnv.validate!({ parsed, langId: 'javascript', code: CODE, cases: CASES });
            assert.ok(msg);
            assert.ok(/solve/.test(msg));
        });
    });

    // ── parse ─────────────────────────────────────────────────────────────────

    suite('parse', () => {

        test('round-trips an emitted result line', () => {
            assert.deepStrictEqual(
                javascriptFunctionEnv.parse('__LEET__{"index":0,"actual":"[0,1]","ms":3}\n'),
                [{ index: 0, actual: '[0,1]', ms: 3 }],
            );
        });

        test("ignores the solver's own stdout noise", () => {
            const stdout = 'hello\n__LEET__{"index":0,"actual":"1","ms":0}\ntrailing';
            assert.strictEqual(javascriptFunctionEnv.parse(stdout).length, 1);
        });

        test('tolerates stdout truncated mid-line', () => {
            const stdout = '__LEET__{"index":0,"actual":"1","ms":0}\n__LEET__{"index":1,"act';
            assert.strictEqual(javascriptFunctionEnv.parse(stdout).length, 1);
        });
    });
});
