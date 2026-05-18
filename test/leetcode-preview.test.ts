import * as assert from 'node:assert';
import {
    renderLeetCodePreviewHtml,
    renderTestResultsHtml,
} from '../src/ui/panels/leetcodePreview.panel.js';
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
            assert.ok(/2 test cases/.test(html));
        });

        test('lists solutions grouped by language, each with label when present', () => {
            const html = renderLeetCodePreviewHtml(fixture(), css, csp);
            // language headings present (case-insensitive substring)
            assert.ok(/java/i.test(html));
            assert.ok(/python/i.test(html));
            assert.ok(html.includes('Brute Force'));
        });

        test('exposes runTestsBtn / submitBtn / langSelector ids', () => {
            const html = renderLeetCodePreviewHtml(fixture(), css, csp);
            assert.ok(html.includes('id="runTestsBtn"'));
            assert.ok(html.includes('id="submitBtn"'));
            assert.ok(html.includes('id="langSelector"'));
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

    });

});
