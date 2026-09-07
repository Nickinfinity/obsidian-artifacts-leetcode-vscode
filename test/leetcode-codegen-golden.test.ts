import * as assert from 'node:assert';
import {
    generateBoilerplate,
    generateTestHarness,
} from '../src/services/leetcode-codegen.service.js';
import { defaultPracticeConfig, defaultTestConfig } from '../src/services/leetcode-parser.service.js';
import type { ParsedLeetCode } from '../src/types/leetcode.types.js';

/**
 * Byte-exact golden lock for every codegen emit path.
 *
 * The refactor that collapses the per-language `if (lang === …)` cascades into
 * map dispatch MUST leave these strings identical to the character — that is the
 * behavior-preservation proof. These snapshots were captured from the
 * pre-refactor implementation; do not "update" them to match a change, a diff
 * here means the refactor altered generated code.
 */
suite('leetcode-codegen golden', () => {

    function fixture(overrides: Partial<ParsedLeetCode> = {}): ParsedLeetCode {
        return {
            title:        'Two Sum',
            leetcodeType: 'function',
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

    test('java boilerplate is byte-identical', () => {
        assert.strictEqual(generateBoilerplate(fixture(), 'java'),
            'import java.util.*;\n\nclass Main {\n\tpublic static int[] twoSum(int[] nums, int target) {\n\t\t<<SOLUTION>>\n\t}\n\n\tpublic static void main(String[] args) {\n\t\tScanner sc = new Scanner(System.in);\n\t\t// read nums from sc\n\t\t// read target from sc\n\t\tSystem.out.print("");\n\t}\n}\n');
    });

    test('python boilerplate is byte-identical', () => {
        assert.strictEqual(generateBoilerplate(fixture(), 'python'),
            'def twoSum(nums, target):\n\t<<SOLUTION>>\n\nif __name__ == "__main__":\n\tnums = input()\n\ttarget = input()\n\tprint(twoSum(nums, target))\n');
    });

    test('javascript boilerplate is byte-identical', () => {
        assert.strictEqual(generateBoilerplate(fixture(), 'javascript'),
            'const readline = require(\'readline\');\nconst rl = readline.createInterface({ input: process.stdin });\n\nfunction twoSum(nums, target) {\n\t<<SOLUTION>>\n}\n\nconst lines = [];\nrl.on(\'line\', (l) => lines.push(l));\nrl.on(\'close\', () => {\n\tconst result = twoSum(nums, target);\n\tprocess.stdout.write(String(result));\n});\n');
    });

    // `ruby`, deliberately: this asserts the *non-`LangId`* fallback, and every
    // runnable language now emits real code. It named `rust` until rust became
    // runnable — a fixture, not a snapshot, so repointing it preserves the
    // assertion's intent rather than relaxing the golden net.
    test('an unsupported language yields empty boilerplate', () => {
        assert.strictEqual(generateBoilerplate(fixture(), 'ruby'), '');
    });

    // ── Harness ───────────────────────────────────────────────────────────────

    test('java harness is byte-identical', () => {
        assert.strictEqual(generateTestHarness(fixture(), 'java'),
            'class Main {\n\tpublic static void main(String[] args) {\n\t\ttwoSum(new int[]{2, 7}, 9);\n\t\ttwoSum(new int[]{3, 2, 4}, 6);\n\t}\n}\n');
    });

    test('python harness is byte-identical', () => {
        assert.strictEqual(generateTestHarness(fixture(), 'python'),
            'assert twoSum([2, 7], 9) == [0, 1]\nassert twoSum([3, 2, 4], 6) == [1, 2]\n');
    });

    test('javascript harness is byte-identical', () => {
        assert.strictEqual(generateTestHarness(fixture(), 'javascript'),
            'const assert = require(\'assert\');\nassert.deepStrictEqual(twoSum([2, 7], 9), [0, 1]);\nassert.deepStrictEqual(twoSum([3, 2, 4], 6), [1, 2]);\n');
    });

    // ── Empty-suite harness (per-language minimal shapes) ─────────────────────

    test('java empty harness keeps the class+main skeleton', () => {
        assert.strictEqual(generateTestHarness(fixture({ tests: [] }), 'java'),
            'class Main {\n\tpublic static void main(String[] args) {\n\t}\n}\n');
    });

    test('python empty harness is the no-cases comment', () => {
        assert.strictEqual(generateTestHarness(fixture({ tests: [] }), 'python'),
            '# no test cases\n');
    });

    test('javascript empty harness keeps only the assert require', () => {
        assert.strictEqual(generateTestHarness(fixture({ tests: [] }), 'javascript'),
            'const assert = require(\'assert\');\n');
    });

    // See the boilerplate counterpart above for why this is `ruby` and not `rust`.
    test('an unsupported language yields empty harness', () => {
        assert.strictEqual(generateTestHarness(fixture(), 'ruby'), '');
    });
});
