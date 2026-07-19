import * as assert from 'node:assert';
import {
    generateBoilerplate,
    generateTestHarness,
} from '../src/services/leetcode-codegen.service.js';
import { defaultPracticeConfig, defaultTestConfig } from '../src/services/leetcode-parser.service.js';
import { SOLUTION_MARKER } from '../src/types/constants.js';
import type { ParsedLeetCode } from '../src/types/leetcode.types.js';

/**
 * TypeScript codegen row (T3) — replaces the T1 `tsBoilerplate`/`tsHarness`
 * stubs. Byte-exact golden-style asserts for this language live here, never
 * in the shared `leetcode-codegen-golden.test.ts` file.
 */
suite('leetcode-codegen — TypeScript', () => {

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
        const src = generateBoilerplate(fixture(), 'typescript');
        assert.ok(src.includes('function twoSum(nums: number[], target: number): number[] {'),
            'expected a mapType-typed signature (number[] params/return, not int[])');
        const markerCount = src.split(SOLUTION_MARKER).length - 1;
        assert.strictEqual(markerCount, 1);
    });

    test('reads stdin via readline / process.stdin, same runtime shape as JavaScript', () => {
        const src = generateBoilerplate(fixture(), 'typescript');
        assert.ok(src.includes('process.stdin'));
        assert.ok(src.includes('readline'));
    });

    test('a functions: override names the function instead of functionName', () => {
        const src = generateBoilerplate(fixture({ functions: { typescript: 'twoSumImpl' } }), 'typescript');
        assert.ok(src.includes('function twoSumImpl(nums: number[], target: number): number[] {'));
    });

    test('boilerplate is byte-identical', () => {
        assert.strictEqual(generateBoilerplate(fixture(), 'typescript'),
            'const readline = require(\'readline\');\nconst rl = readline.createInterface({ input: process.stdin });\n\nfunction twoSum(nums: number[], target: number): number[] {\n\t<<SOLUTION>>\n}\n\nconst lines: string[] = [];\nrl.on(\'line\', (l: string) => lines.push(l));\nrl.on(\'close\', () => {\n\tconst result = twoSum(nums, target);\n\tprocess.stdout.write(String(result));\n});\n');
    });

    // ── Harness ───────────────────────────────────────────────────────────────

    test('one assert.deepStrictEqual per test case', () => {
        const out = generateTestHarness(fixture(), 'typescript');
        const asserts = out.match(/assert\.deepStrictEqual/g) ?? [];
        assert.strictEqual(asserts.length, 2);
    });

    test('harness is byte-identical', () => {
        assert.strictEqual(generateTestHarness(fixture(), 'typescript'),
            'const assert = require(\'assert\');\nassert.deepStrictEqual(twoSum([2, 7], 9), [0, 1]);\nassert.deepStrictEqual(twoSum([3, 2, 4], 6), [1, 2]);\n');
    });

    test('empty tests array still produces the assert-require-only harness', () => {
        assert.strictEqual(generateTestHarness(fixture({ tests: [] }), 'typescript'),
            'const assert = require(\'assert\');\n');
    });
});
