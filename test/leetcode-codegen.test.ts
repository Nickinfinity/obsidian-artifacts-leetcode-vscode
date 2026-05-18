import * as assert from 'node:assert';
import {
    generateBoilerplate,
    generateTestHarness,
    jsonToLiteral,
} from '../src/services/leetcode-codegen.service.js';
import type { ParsedLeetCode } from '../src/types/leetcode.types.js';

/**
 * Unit tests for generateBoilerplate, generateTestHarness, and jsonToLiteral
 * from services/leetcode-codegen.service.ts.
 */
suite('leetcode-codegen', () => {

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
            solutions:    [],
            ...overrides,
        };
    }

    // ── generateBoilerplate — Java ────────────────────────────────────────────

    suite('generateBoilerplate — Java', () => {
        const out = () => generateBoilerplate(fixture(), 'java');

        test('declares class Main', () => assert.ok(/class\s+Main/.test(out())));
        test('imports java.util.*',  () => assert.ok(out().includes('import java.util.*;')));
        test('signature uses mapped param + return types', () => {
            const src = out();
            assert.ok(src.includes('int[] twoSum(int[] nums, int target)'));
        });
        test('main method has Scanner stdin reader', () => {
            const src = out();
            assert.ok(src.includes('public static void main'));
            assert.ok(src.includes('Scanner'));
        });
        test('prints output with System.out.print', () => {
            assert.ok(/System\.out\.print/.test(out()));
        });
        test('contains <<SOLUTION>> marker', () => assert.ok(out().includes('<<SOLUTION>>')));
    });

    // ── generateBoilerplate — Python ──────────────────────────────────────────

    suite('generateBoilerplate — Python', () => {
        const out = () => generateBoilerplate(fixture(), 'python');

        test('declares def with parsed param names', () => {
            const src = out();
            assert.ok(/def\s+twoSum\(nums,\s*target\)/.test(src));
        });
        test('uses if __name__ == "__main__": entry block', () => {
            assert.ok(out().includes('if __name__ == "__main__":'));
        });
        test('reads stdin via input()', () => {
            assert.ok(out().includes('input()'));
        });
        test('contains <<SOLUTION>> marker', () => assert.ok(out().includes('<<SOLUTION>>')));
    });

    // ── generateBoilerplate — JavaScript ──────────────────────────────────────

    suite('generateBoilerplate — JavaScript', () => {
        const out = () => generateBoilerplate(fixture(), 'javascript');

        test('declares function with parsed param names', () => {
            const src = out();
            assert.ok(/function\s+twoSum\(nums,\s*target\)/.test(src));
        });
        test('reads stdin via readline / process.stdin', () => {
            const src = out();
            assert.ok(src.includes('process.stdin'));
            assert.ok(src.includes('readline'));
        });
        test('contains <<SOLUTION>> marker', () => assert.ok(out().includes('<<SOLUTION>>')));
    });

    // ── generateTestHarness ───────────────────────────────────────────────────

    suite('generateTestHarness — Java', () => {
        test('one assertion per test case', () => {
            const out = generateTestHarness(fixture(), 'java');
            // crude proxy: count `Arrays.equals` / `==` based assertions per call site
            const calls = out.match(/twoSum\(/g) ?? [];
            assert.strictEqual(calls.length, 2);
        });
        test('includes class with main method', () => {
            const out = generateTestHarness(fixture(), 'java');
            assert.ok(/class\s+\w+/.test(out));
            assert.ok(out.includes('public static void main'));
        });
        test('input arrays use new int[]{…} literal syntax', () => {
            const out = generateTestHarness(fixture(), 'java');
            assert.ok(out.includes('new int[]{2, 7}') || out.includes('new int[]{2,7}'));
        });
    });

    suite('generateTestHarness — Python', () => {
        test('one assert per test case', () => {
            const out = generateTestHarness(fixture(), 'python');
            const asserts = out.match(/^assert\s+/mg) ?? [];
            assert.strictEqual(asserts.length, 2);
        });
        test('uses Python list literals for arrays', () => {
            const out = generateTestHarness(fixture(), 'python');
            assert.ok(out.includes('[2, 7]') || out.includes('[2,7]'));
        });
    });

    suite('generateTestHarness — JavaScript', () => {
        test('one assert.deepStrictEqual per test case', () => {
            const out = generateTestHarness(fixture(), 'javascript');
            const asserts = out.match(/assert\.(deepStrictEqual|strictEqual)/g) ?? [];
            assert.strictEqual(asserts.length, 2);
        });
        test('uses JS array literals for inputs', () => {
            const out = generateTestHarness(fixture(), 'javascript');
            assert.ok(out.includes('[2, 7]') || out.includes('[2,7]'));
        });
        test('call args follow params order: twoSum(nums, target)', () => {
            const out = generateTestHarness(fixture(), 'javascript');
            // nums first, target second — check the first call uses [2,7] then 9
            assert.ok(/twoSum\(\s*\[2,\s*7\]\s*,\s*9\s*\)/.test(out));
        });
    });

    test('empty tests array still produces compilable minimal harness with no assertions', () => {
        const out = generateTestHarness(fixture({ tests: [] }), 'python');
        const asserts = out.match(/^assert\s+/mg) ?? [];
        assert.strictEqual(asserts.length, 0);
        // non-empty string returned
        assert.ok(out.length > 0);
    });

    // ── jsonToLiteral ─────────────────────────────────────────────────────────

    suite('jsonToLiteral', () => {
        test('number → number literal in all languages', () => {
            assert.strictEqual(jsonToLiteral(42, 'java'),       '42');
            assert.strictEqual(jsonToLiteral(42, 'python'),     '42');
            assert.strictEqual(jsonToLiteral(42, 'javascript'), '42');
        });

        test('string → quoted in Java/JS, quoted in Python', () => {
            assert.strictEqual(jsonToLiteral('hi', 'java'),       '"hi"');
            assert.strictEqual(jsonToLiteral('hi', 'javascript'), '"hi"');
            assert.strictEqual(jsonToLiteral('hi', 'python'),     '"hi"');
        });

        test('int array → new int[]{…} for Java, [..] for Python/JS', () => {
            assert.strictEqual(jsonToLiteral([1, 2, 3], 'java'),       'new int[]{1, 2, 3}');
            assert.strictEqual(jsonToLiteral([1, 2, 3], 'python'),     '[1, 2, 3]');
            assert.strictEqual(jsonToLiteral([1, 2, 3], 'javascript'), '[1, 2, 3]');
        });

        test('nested array → nested literal for Python and JavaScript', () => {
            assert.strictEqual(jsonToLiteral([[1, 2], [3]], 'python'),     '[[1, 2], [3]]');
            assert.strictEqual(jsonToLiteral([[1, 2], [3]], 'javascript'), '[[1, 2], [3]]');
        });

        test('object → JSON for JS, dict for Python', () => {
            assert.strictEqual(jsonToLiteral({ a: 1 }, 'javascript'), '{"a": 1}');
            assert.strictEqual(jsonToLiteral({ a: 1 }, 'python'),     '{"a": 1}');
        });
    });

});
