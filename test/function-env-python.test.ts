import * as assert from 'node:assert';
import { pythonFunctionEnv } from '../src/services/test-envs/function/python.env.js';
import { defaultPracticeConfig, defaultTestConfig } from '../src/services/leetcode-parser.service.js';
import type { EmittedProgram } from '../src/services/test-envs/env.types.js';
import type { ParsedLeetCode, TestCase } from '../src/types/leetcode.types.js';

/** Shared fixture builder for the `function × python` environment. */
function fixture(overrides: Partial<ParsedLeetCode> = {}): ParsedLeetCode {
    return {
        title: 'Two Sum', difficulty: 'easy', functionName: 'twoSum', status: 'unsolved',
        leetcodeType: 'function',
        params: [{ name: 'nums', type: 'int[]' }, { name: 'flag', type: 'bool' }],
        returns: 'int[]', description: '', examples: [],
        tests: [], finalTests: [], test: defaultTestConfig(),
        setups: [], practice: defaultPracticeConfig(), solutions: [], attempts: [], tags: [],
        ...overrides,
    };
}

const CASES: TestCase[] = [
    { input: { nums: [2, 7], flag: true }, expected: [0, 1] },
    { input: { nums: [], flag: null }, expected: [] },
];

const CODE = 'def twoSum(nums, flag):\n    return [0, 1]';

suite('function × python env', () => {

    const emit = (code = CODE): EmittedProgram =>
        pythonFunctionEnv.emit({ parsed: fixture(), langId: 'python', code, cases: CASES });

    const fileNamed = (p: EmittedProgram, name: string): string => {
        const f = p.files.find(x => x.name === name);
        assert.ok(f, `expected an emitted file ${name}`);
        return f.content;
    };

    // ── emit ──────────────────────────────────────────────────────────────────

    suite('emit', () => {

        test('declares the env identity', () => {
            assert.strictEqual(pythonFunctionEnv.type, 'call');
            assert.strictEqual(pythonFunctionEnv.language, 'python');
        });

        test('writes the candidate verbatim as sol.py and a generated runner.py', () => {
            const p = emit();
            assert.deepStrictEqual(p.files.map(f => f.name).sort(), ['runner.py', 'sol.py']);
            assert.ok(fileNamed(p, 'sol.py').startsWith('def twoSum(nums, flag):'));
            assert.strictEqual(p.run, 'python3 runner.py');
            assert.strictEqual(p.compile, undefined);
        });

        test('runner imports the candidate as a module, does not splice it', () => {
            const runner = fileNamed(emit(), 'runner.py');
            assert.ok(runner.includes('spec_from_file_location("sol", '));
            assert.ok(runner.includes('exec_module(__mod)'));
            assert.ok(runner.includes('__fn = getattr(__mod, "twoSum")'));
            assert.ok(!runner.includes('return [0, 1]'));
        });

        test('serialises with sort_keys and compact separators — already canonical', () => {
            const runner = fileNamed(emit(), 'runner.py');
            assert.ok(runner.includes('sort_keys=True'));
            assert.ok(runner.includes("separators=(',', ':')"));
        });

        test('emits Python literals for the arguments', () => {
            const runner = fileNamed(emit(), 'runner.py');
            assert.ok(runner.includes('[[2, 7], True]'));
            assert.ok(runner.includes('[[], None]'));
        });

        test('flushes after every line so a timeout-kill cannot swallow the buffer', () => {
            assert.ok(fileNamed(emit(), 'runner.py').includes('__sys.stdout.flush()'));
        });

        test('a functions: override is what the runner imports off the module, not functionName', () => {
            const parsed = fixture({ functions: { python: 'two_sum' } });
            const overrideCode = 'def two_sum(nums, flag):\n    return [0, 1]';
            const runner = fileNamed(
                pythonFunctionEnv.emit({ parsed, langId: 'python', code: overrideCode, cases: CASES }),
                'runner.py',
            );
            assert.ok(runner.includes('__fn = getattr(__mod, "two_sum")'));
        });

        test('the candidate file is never asked to read input()', () => {
            assert.ok(!fileNamed(emit(), 'sol.py').includes('input()'));
        });
    });

    // ── validate ──────────────────────────────────────────────────────────────

    suite('validate', () => {

        const check = (code: string): string | null =>
            pythonFunctionEnv.validate!({ parsed: fixture(), langId: 'python', code, cases: CASES });

        test('a top-level def passes', () => {
            assert.strictEqual(check(CODE), null);
        });

        test('rejects a function nested inside a class (import could not reach it)', () => {
            const msg = check('class Solution:\n    def twoSum(self, nums, flag):\n        return nums');
            assert.ok(msg);
            assert.ok(/top-level/i.test(msg));
        });

        test('rejects a candidate defining the wrong name', () => {
            const msg = check('def two_sum(nums, flag):\n    return nums');
            assert.ok(msg);
            assert.ok(/twoSum/.test(msg));
        });

        test('a functions: override requires the overridden name, not functionName', () => {
            const parsed = fixture({ functions: { python: 'two_sum' } });
            const msg = pythonFunctionEnv.validate!({
                parsed, langId: 'python', code: CODE, cases: CASES,
            });
            assert.ok(msg);
            assert.ok(/two_sum/.test(msg));
        });
    });

    // ── parse ─────────────────────────────────────────────────────────────────

    suite('parse', () => {

        test('round-trips an emitted result line', () => {
            assert.deepStrictEqual(
                pythonFunctionEnv.parse('__LEET__{"index":0,"actual":"[0,1]","ms":3}\n'),
                [{ index: 0, actual: '[0,1]', ms: 3 }],
            );
        });

        test('recovers a raised exception', () => {
            const stdout = '__LEET__{"index":0,"error":"list index out of range","ms":1}\n';
            assert.strictEqual(pythonFunctionEnv.parse(stdout)[0].error, 'list index out of range');
        });

        test("ignores the solver's own print() output", () => {
            const stdout = 'debugging\n__LEET__{"index":0,"actual":"1","ms":0}\n';
            assert.strictEqual(pythonFunctionEnv.parse(stdout).length, 1);
        });
    });
});
