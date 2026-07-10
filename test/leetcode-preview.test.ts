import * as assert from 'node:assert';
import {
    renderLeetCodePreviewHtml,
    renderTestResultsHtml,
} from '../src/ui/panels/leetcodePreview.panel.js';
import { defaultPracticeConfig, defaultTestConfig } from '../src/services/leetcode-parser.service.js';
import { PRACTICE_OPTIONS } from '../src/types/constants.js';
import type { ParsedLeetCode, TestResult } from '../src/types/leetcode.types.js';

/**
 * Unit tests for the LeetCode preview panel renderers.
 *
 * These are HTML-shape assertions only — no DOM is constructed. We grep the
 * generated string for the elements/classes the orchestrator and stylesheet
 * rely on.
 */
suite('leetcodePreview', () => {

    function fixture(overrides: Partial<ParsedLeetCode> = {}): ParsedLeetCode {
        return {
            title:        'Two Sum',
            difficulty:   'easy',
            functionName: 'twoSum',
            algorithm:    'hash-map',
            status:       'unsolved',
            params:       [{ name: 'nums', type: 'int[]' }, { name: 'target', type: 'int' }],
            returns:      'int[]',
            description:  'Given an array of integers, return indices that sum to target.',
            examples:     [
                { input: 'nums = [2,7], target = 9', output: '[0,1]' },
            ],
            tests:        [
                { input: { nums: [2, 7], target: 9 }, expected: [0, 1] },
                { input: { nums: [3, 2, 4], target: 6 }, expected: [1, 2] },
            ],
            setups:       [
                { language: 'java',   code: 'static int[] twoSum(int[] nums, int target) {}' },
            ],
            finalTests:   [],
            test:         defaultTestConfig(),
            practice:     defaultPracticeConfig(),
            solutions:    [
                { language: 'java',   label: 'Brute Force', code: '// java code'   },
                { language: 'python', label: undefined,     code: '# python code' },
            ],
            ...overrides,
        };
    }

    // ── renderLeetCodePreviewHtml ─────────────────────────────────────────────

    suite('renderLeetCodePreviewHtml', () => {
        const css = 'vscode-webview://test/styles.css';
        const csp = 'vscode-webview://test';

        test('contains title inside <h1>', () => {
            const html = renderLeetCodePreviewHtml(fixture(), css, csp);
            assert.ok(/<h1[^>]*>[^<]*Two Sum[^<]*<\/h1>/.test(html));
        });

        test('difficulty badge uses difficulty-easy class for easy', () => {
            const html = renderLeetCodePreviewHtml(fixture(), css, csp);
            assert.ok(html.includes('difficulty-easy'));
        });

        test('difficulty badge uses difficulty-medium for medium', () => {
            const html = renderLeetCodePreviewHtml(fixture({ difficulty: 'medium' }), css, csp);
            assert.ok(html.includes('difficulty-medium'));
        });

        test('difficulty badge uses difficulty-hard for hard', () => {
            const html = renderLeetCodePreviewHtml(fixture({ difficulty: 'hard' }), css, csp);
            assert.ok(html.includes('difficulty-hard'));
        });

        test('status badge uses status-unsolved when unsolved', () => {
            const html = renderLeetCodePreviewHtml(fixture(), css, csp);
            assert.ok(html.includes('status-unsolved'));
        });

        test('status badge uses status-solved when solved', () => {
            const html = renderLeetCodePreviewHtml(fixture({ status: 'solved' }), css, csp);
            assert.ok(html.includes('status-solved'));
        });

        test('algorithm tag text appears when set', () => {
            const html = renderLeetCodePreviewHtml(fixture(), css, csp);
            assert.ok(html.includes('hash-map'));
        });

        test('renders the problem description text', () => {
            const html = renderLeetCodePreviewHtml(fixture(), css, csp);
            assert.ok(html.includes('Given an array of integers'));
        });

        test('renders one example-card per example with input + output', () => {
            const html = renderLeetCodePreviewHtml(fixture(), css, csp);
            assert.ok(html.includes('example-card'));
            assert.ok(html.includes('nums = [2,7]'));
            assert.ok(html.includes('[0,1]'));
        });

        test('shows the test case count', () => {
            const html = renderLeetCodePreviewHtml(fixture(), css, csp);
            assert.ok(/2 tests/.test(html));
        });

        test('lists solutions grouped by language, each with label when present', () => {
            const html = renderLeetCodePreviewHtml(fixture(), css, csp);
            // language headings present (case-insensitive substring)
            assert.ok(/java/i.test(html));
            assert.ok(/python/i.test(html));
            assert.ok(html.includes('Brute Force'));
        });

        test('exposes runTestsBtn / solveBtn / submitBtn / langSelector ids', () => {
            const html = renderLeetCodePreviewHtml(fixture(), css, csp);
            assert.ok(html.includes('id="runTestsBtn"'));
            assert.ok(html.includes('id="solveBtn"'));
            assert.ok(html.includes('id="submitBtn"'));
            assert.ok(html.includes('id="langSelector"'));
        });

        test('Run Tests renders disabled until a challenge is live', () => {
            const html = renderLeetCodePreviewHtml(fixture(), css, csp);
            assert.ok(/id="runTestsBtn"[^>]*disabled/.test(html));
        });

        test('the webview script re-gates Run Tests on the challengeState message', () => {
            const html = renderLeetCodePreviewHtml(fixture(), css, csp);
            assert.ok(html.includes("msg.command === 'challengeState'"));
            assert.ok(html.includes('runTestsBtn.disabled = !msg.active;'));
        });

        test('the results sink is empty by default', () => {
            const html = renderLeetCodePreviewHtml(fixture(), css, csp);
            assert.ok(html.includes('<div id="results" class="results-container"></div>'));
        });

        test('seeded results html lands inside the results sink', () => {
            const html = renderLeetCodePreviewHtml(fixture(), css, csp, '<b>seeded</b>');
            assert.ok(html.includes('<div id="results" class="results-container"><b>seeded</b></div>'));
        });

        test('counts line splits public and final when a grading suite exists', () => {
            const withFinal = fixture({ finalTests: [{ input: { nums: [987654] }, expected: [7] }] });
            const html = renderLeetCodePreviewHtml(withFinal, css, csp);
            assert.ok(/2 public tests/.test(html));
            assert.ok(/1 final tests/.test(html));
            // The hidden case's data must not appear anywhere in the document.
            assert.ok(!html.includes('987654'));
        });

        test('renders the setup starter block for each language', () => {
            const html = renderLeetCodePreviewHtml(fixture(), css, csp);
            assert.ok(html.includes('setup-block'));
            assert.ok(html.includes('static int[] twoSum'));
        });

        test('language selector unions setup and solution languages', () => {
            const html = renderLeetCodePreviewHtml(fixture(), css, csp);
            assert.ok(html.includes('<option value="java">'));
            assert.ok(html.includes('<option value="python">'));
            // java appears in both setups and solutions — listed once.
            assert.strictEqual((html.match(/<option value="java">/g) ?? []).length, 1);
        });

        test('renders one practice checkbox per PRACTICE_OPTIONS entry', () => {
            const html = renderLeetCodePreviewHtml(fixture(), css, csp);
            const boxes = html.match(/class="practice-option"/g) ?? [];
            assert.strictEqual(boxes.length, PRACTICE_OPTIONS.length);
            assert.ok(html.includes('id="timeLimit"'));
        });

        test('locked practice config disables every control', () => {
            const locked = fixture({
                practice: { options: ['noCompletion'], timeLimitMinutes: 30, locked: true },
            });
            const html = renderLeetCodePreviewHtml(locked, css, csp);
            const disabled = html.match(/ disabled>/g) ?? [];
            // one per checkbox + the time-limit input + the always-disabled Run Tests button
            assert.strictEqual(disabled.length, PRACTICE_OPTIONS.length + 2);
        });

        test('reference solutions are collapsed behind a details element', () => {
            const html = renderLeetCodePreviewHtml(fixture(), css, csp);
            assert.ok(html.includes('<details class="solutions-details">'));
            assert.ok(/spoilers/i.test(html));
        });
    });

    // ── renderTestResultsHtml ─────────────────────────────────────────────────

    suite('renderTestResultsHtml', () => {

        const passResult = (i: number): TestResult => ({
            index: i, passed: true, input: { x: i },
            expected: i, actual: String(i), duration: 1,
        });

        const failResult = (i: number): TestResult => ({
            index: i, passed: false, input: { x: i },
            expected: i, actual: String(i + 1), duration: 1,
        });

        const errorResult = (i: number): TestResult => ({
            index: i, passed: false, input: { x: i },
            expected: i, actual: '', duration: 1, error: 'boom',
        });

        test('all-pass summary shows N/N passed', () => {
            const html = renderTestResultsHtml([passResult(0), passResult(1), passResult(2)]);
            assert.ok(/3\s*\/\s*3\s+passed/i.test(html));
        });

        test('mixed summary shows correct passed/total', () => {
            const html = renderTestResultsHtml([passResult(0), passResult(1), failResult(2)]);
            assert.ok(/2\s*\/\s*3\s+passed/i.test(html));
        });

        test('each passing row carries class test-pass', () => {
            const html = renderTestResultsHtml([passResult(0), passResult(1)]);
            const matches = html.match(/test-pass/g) ?? [];
            assert.ok(matches.length >= 2);
        });

        test('each failing row carries class test-fail', () => {
            const html = renderTestResultsHtml([failResult(0)]);
            assert.ok(html.includes('test-fail'));
        });

        test('failing row shows actual output text', () => {
            const html = renderTestResultsHtml([failResult(0)]);
            // actual is '1' for failResult(0) (expected 0)
            assert.ok(html.includes('1'));
        });

        test('error row carries test-error class and shows error message', () => {
            const html = renderTestResultsHtml([errorResult(0)]);
            assert.ok(html.includes('test-error'));
            assert.ok(html.includes('boom'));
        });

        test('empty results array → 0/0 passed', () => {
            const html = renderTestResultsHtml([]);
            assert.ok(/0\s*\/\s*0\s+passed/i.test(html));
        });

        // ── Final-case masking ────────────────────────────────────────────────

        suite('final-case masking', () => {

            const finalPass = (i: number): TestResult => ({
                index: i, passed: true, input: { secret: 987654 },
                expected: 'sekrit', actual: '"sekrit"', duration: 7, kind: 'final',
            });

            const finalFail = (i: number): TestResult => ({
                index: i, passed: false, input: { secret: 987654 },
                expected: 'sekrit', actual: '"wrong"', duration: 7, kind: 'final',
            });

            const publicFail = (i: number): TestResult => ({
                index: i, passed: false, input: { x: 42 },
                expected: 1, actual: '2', duration: 1, kind: 'public',
            });

            test('a passing final row hides its input, expected, and actual', () => {
                const html = renderTestResultsHtml([finalPass(2)]);
                assert.ok(html.includes('<span class="masked">hidden</span>'));
                assert.ok(!html.includes('987654'));
                assert.ok(!html.includes('sekrit'));
            });

            test('a failing final row still hides everything but the verdict', () => {
                const html = renderTestResultsHtml([finalFail(2)]);
                assert.ok(html.includes('test-fail'));
                assert.ok(!html.includes('987654'));
                assert.ok(!html.includes('sekrit'));
                assert.ok(!html.includes('wrong'));
            });

            test('final rows are labelled Final #N', () => {
                assert.ok(renderTestResultsHtml([finalPass(2)]).includes('Final #3'));
            });

            test('final rows still show pass/fail and duration', () => {
                const html = renderTestResultsHtml([finalPass(0)]);
                assert.ok(html.includes('test-pass'));
                assert.ok(html.includes('7 ms'));
            });

            test('public rows are unmasked and keep the plain #N label', () => {
                const html = renderTestResultsHtml([publicFail(0)]);
                assert.ok(html.includes('42'));
                assert.ok(html.includes('actual:'));
                assert.ok(!html.includes('masked'));
                assert.ok(html.includes('#1'));
            });

            test('an untagged result renders as public — the runner is suite-blind', () => {
                const html = renderTestResultsHtml([failResult(0)]);
                assert.ok(!html.includes('masked'));
            });

            test('a mixed run masks only the final rows', () => {
                const html = renderTestResultsHtml([publicFail(0), finalPass(1)]);
                assert.strictEqual((html.match(/masked/g) ?? []).length, 1);
                assert.ok(html.includes('42'));
            });

            test('an errored final row reports the error but not the input', () => {
                const errored: TestResult = {
                    index: 1, passed: false, input: { secret: 987654 }, expected: 0,
                    actual: '', duration: 0, error: 'timeout', kind: 'final',
                };
                const html = renderTestResultsHtml([errored]);
                assert.ok(html.includes('timeout'));
                assert.ok(html.includes('Final #2'));
                assert.ok(!html.includes('987654'));
            });
        });
    });

});
