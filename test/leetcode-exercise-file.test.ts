import * as assert from 'node:assert';
import {
    exerciseFileName,
    resolveStarterCode,
    slugify,
} from '../src/services/exercise-file.helpers.js';
import { defaultPracticeConfig, defaultTestConfig } from '../src/services/leetcode-parser.service.js';
import type { ParsedLeetCode } from '../src/types/leetcode.types.js';

/**
 * Unit tests for the pure half of the exercise-file service — the naming rule
 * and the starter-code resolution that decide what lands in the editor when
 * "Solve It" is pressed.
 */
suite('exercise-file', () => {

    function fixture(overrides: Partial<ParsedLeetCode> = {}): ParsedLeetCode {
        return {
            title:        'Two Sum',
            difficulty:   'easy',
            functionName: 'twoSum',
            algorithm:    'hash-map',
            status:       'unsolved',
            params:       [{ name: 'nums', type: 'int[]' }, { name: 'target', type: 'int' }],
            returns:      'int[]',
            description:  '',
            examples:     [],
            tests:        [],
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

    // ── slugify ───────────────────────────────────────────────────────────────

    suite('slugify', () => {

        test('lower-kebabs a plain title', () => {
            assert.strictEqual(slugify('Two Sum'), 'two-sum');
            assert.strictEqual(slugify('Longest Substring'), 'longest-substring');
        });

        test('collapses runs of punctuation into a single dash', () => {
            assert.strictEqual(slugify('Two   Sum!! II'), 'two-sum-ii');
        });

        test('strips leading and trailing dashes', () => {
            assert.strictEqual(slugify('  !Two Sum!  '), 'two-sum');
        });

        test('keeps digits', () => {
            assert.strictEqual(slugify('3Sum Closest'), '3sum-closest');
        });

        test('a title with no usable characters falls back to "exercise"', () => {
            assert.strictEqual(slugify('!!!'), 'exercise');
            assert.strictEqual(slugify(''), 'exercise');
        });
    });

    // ── exerciseFileName ──────────────────────────────────────────────────────

    suite('exerciseFileName', () => {

        test('prefixes the slug, appends a run suffix, and the language extension', () => {
            assert.match(exerciseFileName('Two Sum', 'javascript'), /^leetcode_two-sum_[a-z0-9]+\.js$/);
            assert.match(exerciseFileName('Two Sum', 'python'), /^leetcode_two-sum_[a-z0-9]+\.py$/);
            assert.match(exerciseFileName('Two Sum', 'java'), /^leetcode_two-sum_[a-z0-9]+\.java$/);
        });

        test('an unknown but safe language id becomes its own extension', () => {
            assert.match(exerciseFileName('Two Sum', 'nim'), /^leetcode_two-sum_[a-z0-9]+\.nim$/);
        });

        test('produces a distinct name on successive calls for the same title + language', () => {
            const names = new Set(
                Array.from({ length: 20 }, () => exerciseFileName('Two Sum', 'javascript')),
            );
            assert.strictEqual(names.size, 20);
        });
    });

    // ── resolveStarterCode ────────────────────────────────────────────────────

    suite('resolveStarterCode', () => {

        test('prefers the # Setup stub for the language', () => {
            const parsed = fixture({
                setups: [{ language: 'javascript', code: 'function twoSum(nums, target) {}' }],
            });
            assert.strictEqual(resolveStarterCode(parsed, 'javascript'), 'function twoSum(nums, target) {}');
        });

        test('matches a setup whose heading used a language alias', () => {
            const parsed = fixture({ setups: [{ language: 'js', code: '// aliased' }] });
            assert.strictEqual(resolveStarterCode(parsed, 'javascript'), '// aliased');
        });

        test('falls back to generated boilerplate when no setup exists', () => {
            const code = resolveStarterCode(fixture(), 'javascript');
            assert.ok(code.includes('function twoSum(nums, target)'));
        });

        test('the <<SOLUTION>> marker never reaches the editor', () => {
            for (const lang of ['java', 'python', 'javascript']) {
                assert.ok(!resolveStarterCode(fixture(), lang).includes('<<SOLUTION>>'), lang);
            }
        });

        test('the marker becomes a // comment for C-style languages', () => {
            assert.ok(resolveStarterCode(fixture(), 'javascript').includes('// solution here'));
            assert.ok(resolveStarterCode(fixture(), 'java').includes('// solution here'));
        });

        test('the marker becomes a # comment for Python', () => {
            const code = resolveStarterCode(fixture(), 'python');
            assert.ok(code.includes('# solution here'));
            assert.ok(!code.includes('// solution here'));
        });

        // Deliberately a non-`LangId`: every runnable language has a codegen
        // template, so naming one here only holds until that language lands.
        // `generateBoilerplate` returns '' for anything outside the registry,
        // which is the condition this test actually cares about.
        test('a language with neither a setup nor a template yields empty source', () => {
            assert.strictEqual(resolveStarterCode(fixture(), 'ruby'), '');
        });

        test('a setup wins even for a language that has a template', () => {
            const parsed = fixture({ setups: [{ language: 'python', code: 'def two_sum(): ...' }] });
            assert.strictEqual(resolveStarterCode(parsed, 'python'), 'def two_sum(): ...');
        });
    });
});
