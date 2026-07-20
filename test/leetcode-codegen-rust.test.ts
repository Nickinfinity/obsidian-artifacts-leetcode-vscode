import * as assert from 'node:assert';
import {
    generateBoilerplate,
    generateTestHarness,
} from '../src/services/leetcode-codegen.service.js';
import { defaultPracticeConfig, defaultTestConfig } from '../src/services/leetcode-parser.service.js';
import { SOLUTION_MARKER } from '../src/types/constants.js';
import type { ParsedLeetCode } from '../src/types/leetcode.types.js';

/**
 * Rust codegen row (T4) — replaces the T1 `rustBoilerplate`/`rustHarness`
 * stubs. Byte-exact golden-style asserts for this language live here, never
 * in the shared `leetcode-codegen-golden.test.ts` file.
 */
suite('leetcode-codegen — Rust', () => {

    function fixture(overrides: Partial<ParsedLeetCode> = {}): ParsedLeetCode {
        return {
            title:        'Two Sum',
            difficulty:   'easy',
            functionName: 'twoSum',
            algorithm:    'hash-map',
            status:       'unsolved',
            params:       [
                { name: 'nums',   type: 'int[]' },
                { name: 'target', type: 'int' },
            ],
            returns:      'int[]',
            description:  '',
            examples:     [],
            tests:        [
                { input: { nums: [2, 7], target: 9 }, expected: [0, 1] },
                { input: { nums: [3, 2, 4], target: 6 }, expected: [1, 2] },
            ],
            setups:       [],
            finalTests:   [],
            test:         defaultTestConfig(),
            practice:     defaultPracticeConfig(),
            solutions:    [],
            attempts:     [],
            tags:         [],
            ...overrides,
        };
    }

    // ── Boilerplate ───────────────────────────────────────────────────────────

    test('signature is typed via mapType and carries exactly one SOLUTION_MARKER', () => {
        const src = generateBoilerplate(fixture(), 'rust');
        assert.ok(src.includes('fn twoSum(nums: Vec<i32>, target: i32) -> Vec<i32> {'),
            'expected a mapType-typed signature (Vec<i32>/i32, not int[]/int)');
        const markerCount = src.split(SOLUTION_MARKER).length - 1;
        assert.strictEqual(markerCount, 1);
    });

    test('reads stdin via std::io::stdin().read_line', () => {
        const src = generateBoilerplate(fixture(), 'rust');
        assert.ok(src.includes('std::io::stdin().read_line'));
    });

    test('a functions: override names the function instead of functionName', () => {
        const src = generateBoilerplate(fixture({ functions: { rust: 'two_sum_impl' } }), 'rust');
        assert.ok(src.includes('fn two_sum_impl(nums: Vec<i32>, target: i32) -> Vec<i32> {'));
    });

    test('boilerplate is byte-identical', () => {
        assert.strictEqual(generateBoilerplate(fixture(), 'rust'),
            'fn twoSum(nums: Vec<i32>, target: i32) -> Vec<i32> {\n\t<<SOLUTION>>\n}\n\nfn main() {\n\tlet mut input = String::new();\n\tstd::io::stdin().read_line(&mut input).unwrap();\n\t// read nums from stdin\n\t// read target from stdin\n\tprint!("");\n}\n');
    });

    // ── Harness ───────────────────────────────────────────────────────────────

    test('one assert_eq! per test case', () => {
        const out = generateTestHarness(fixture(), 'rust');
        const asserts = out.match(/assert_eq!/g) ?? [];
        assert.strictEqual(asserts.length, 2);
    });

    test('harness is byte-identical', () => {
        assert.strictEqual(generateTestHarness(fixture(), 'rust'),
            'fn main() {\n\tassert_eq!(twoSum(vec![2, 7], 9), vec![0, 1]);\n\tassert_eq!(twoSum(vec![3, 2, 4], 6), vec![1, 2]);\n}\n');
    });

    test('empty tests array still produces a valid fn main wrapper', () => {
        assert.strictEqual(generateTestHarness(fixture({ tests: [] }), 'rust'),
            'fn main() {\n\t// no test cases\n}\n');
    });

    test('string arguments render as String::from(...), not a bare literal', () => {
        const src = generateTestHarness(fixture({
            params: [{ name: 's', type: 'string' }],
            returns: 'string',
            tests: [{ input: { s: 'hi' }, expected: 'hi' }],
        }), 'rust');
        assert.ok(src.includes('assert_eq!(twoSum(String::from("hi")), String::from("hi"));'));
    });
});
