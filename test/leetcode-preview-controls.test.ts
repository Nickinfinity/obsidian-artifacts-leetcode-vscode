import * as assert from 'node:assert';
import {
    availableLanguages,
    renderActions,
    renderLanguageRow,
    renderPracticeControls,
    renderSetups,
    renderTestCounts,
} from '../src/ui/panels/leetcodePreview.controls.js';
import { defaultPracticeConfig, defaultTestConfig } from '../src/services/leetcode-parser.service.js';
import { PRACTICE_OPTIONS } from '../src/types/constants.js';
import type { ParsedLeetCode } from '../src/types/leetcode.types.js';

/**
 * Unit tests for the pre-challenge control renderers: language selector,
 * `# Setup` blocks, practice checkboxes + time limit, and the action buttons.
 *
 * HTML-shape assertions only — the webview script keys off the ids, classes,
 * and `data-language` attributes asserted here.
 */
suite('leetcodePreview.controls', () => {

    function fixture(overrides: Partial<ParsedLeetCode> = {}): ParsedLeetCode {
        return {
            title:        'Two Sum',
            difficulty:   'easy',
            functionName: 'twoSum',
            status:       'unsolved',
            params:       [],
            returns:      'int[]',
            description:  '',
            examples:     [],
            tests:        [],
            setups:       [{ language: 'javascript', code: 'function twoSum(a, b) {}' }],
            finalTests:   [],
            test:         defaultTestConfig(),
            practice:     defaultPracticeConfig(),
            solutions:    [{ language: 'python', code: '# python' }],
            ...overrides,
        };
    }

    // ── availableLanguages ────────────────────────────────────────────────────

    suite('availableLanguages', () => {

        test('unions setup languages first, then solution languages', () => {
            assert.deepStrictEqual(availableLanguages(fixture()), ['javascript', 'python']);
        });

        test('deduplicates a language present in both sections', () => {
            const p = fixture({
                setups:    [{ language: 'java', code: '' }],
                solutions: [{ language: 'java', code: '' }, { language: 'python', code: '' }],
            });
            assert.deepStrictEqual(availableLanguages(p), ['java', 'python']);
        });

        test('an artifact with neither section has no languages', () => {
            assert.deepStrictEqual(availableLanguages(fixture({ setups: [], solutions: [] })), []);
        });

        test('a language with no environment for the test type is filtered out', () => {
            const p = fixture({
                setups:    [{ language: 'rust', code: 'fn two_sum() {}' }],
                solutions: [{ language: 'python', code: '# py' }],
            });
            assert.deepStrictEqual(availableLanguages(p), ['python']);
        });

        test('a reserved test type leaves no language selectable', () => {
            const p = fixture({ test: { type: 'class', timeoutMs: 5000 } });
            assert.deepStrictEqual(availableLanguages(p), []);
        });

        test('alias headings resolve to canonical ids before filtering', () => {
            const p = fixture({ setups: [{ language: 'js', code: '' }], solutions: [] });
            assert.deepStrictEqual(availableLanguages(p), ['javascript']);
        });
    });

    // ── renderLanguageRow ─────────────────────────────────────────────────────

    suite('renderLanguageRow', () => {

        test('emits one <option> per available language', () => {
            const html = renderLanguageRow(fixture());
            assert.ok(html.includes('id="langSelector"'));
            assert.ok(html.includes('<option value="javascript">'));
            assert.ok(html.includes('<option value="python">'));
        });

        test('explains itself rather than rendering an empty selector', () => {
            const html = renderLanguageRow(fixture({ setups: [], solutions: [] }));
            assert.ok(!html.includes('<select'));
            assert.ok(/no test environment/i.test(html));
        });

        test('names the offending test type when it is a reserved one', () => {
            const html = renderLanguageRow(fixture({ test: { type: 'class', timeoutMs: 5000 } }));
            assert.ok(!html.includes('<select'));
            assert.ok(html.includes('<code>class</code>'));
        });
    });

    // ── renderSetups ──────────────────────────────────────────────────────────

    suite('renderSetups', () => {

        test('tags each block with data-language so the script can filter it', () => {
            const html = renderSetups(fixture());
            assert.ok(html.includes('class="setup-block" data-language="javascript"'));
        });

        test('escapes the starter code rather than injecting raw HTML', () => {
            const p = fixture({ setups: [{ language: 'javascript', code: 'if (a < b && c) {}' }] });
            const html = renderSetups(p);
            assert.ok(html.includes('&lt;'));
            assert.ok(html.includes('&amp;&amp;'));
            assert.ok(!html.includes('a < b'));
        });

        test('renders nothing when the artifact has no # Setup section', () => {
            assert.strictEqual(renderSetups(fixture({ setups: [] })), '');
        });
    });

    // ── renderPracticeControls ────────────────────────────────────────────────

    suite('renderPracticeControls', () => {

        test('renders one checkbox per PRACTICE_OPTIONS entry, in order', () => {
            const html = renderPracticeControls(fixture());
            const boxes = html.match(/class="practice-option"/g) ?? [];
            assert.strictEqual(boxes.length, PRACTICE_OPTIONS.length);
            for (const opt of PRACTICE_OPTIONS) {
                assert.ok(html.includes(`value="${opt.id}"`), opt.id);
            }
        });

        test('checks exactly the options named by the practice config', () => {
            const p = fixture({
                practice: { options: ['noSnippets'], timeLimitMinutes: 0, locked: false },
            });
            const html = renderPracticeControls(p);
            assert.strictEqual((html.match(/ checked/g) ?? []).length, 1);
            assert.ok(/value="noSnippets" checked/.test(html));
        });

        test('an empty options list checks nothing', () => {
            const p = fixture({ practice: { options: [], timeLimitMinutes: 0, locked: false } });
            assert.ok(!renderPracticeControls(p).includes(' checked'));
        });

        test('seeds the time-limit input from the config', () => {
            const p = fixture({ practice: { options: [], timeLimitMinutes: 45, locked: false } });
            const html = renderPracticeControls(p);
            assert.ok(html.includes('id="timeLimit"'));
            assert.ok(html.includes('value="45"'));
        });

        test('unlocked config leaves every control enabled', () => {
            assert.ok(!renderPracticeControls(fixture()).includes('disabled'));
        });

        test('locked config disables every checkbox and the time input', () => {
            const p = fixture({
                practice: { options: ['noCompletion'], timeLimitMinutes: 30, locked: true },
            });
            const html = renderPracticeControls(p);
            const disabled = html.match(/ disabled>/g) ?? [];
            assert.strictEqual(disabled.length, PRACTICE_OPTIONS.length + 1);
        });

        test('locked config explains itself to the user', () => {
            const p = fixture({ practice: { options: [], timeLimitMinutes: 0, locked: true } });
            assert.ok(/fixes its practice settings/i.test(renderPracticeControls(p)));
        });
    });

    // ── renderActions ─────────────────────────────────────────────────────────

    suite('renderActions', () => {

        test('exposes all three buttons', () => {
            const html = renderActions(fixture());
            assert.ok(html.includes('id="runTestsBtn"'));
            assert.ok(html.includes('id="solveBtn"'));
            assert.ok(html.includes('id="submitBtn"'));
            assert.ok(html.includes('Run Tests'));
            assert.ok(html.includes('Solve It'));
        });

        test('Run Tests starts disabled — there is no attempt buffer to grade yet', () => {
            assert.ok(/id="runTestsBtn"[^>]*disabled/.test(renderActions(fixture())));
        });

        test('Solve It and Submit are enabled when a language is runnable', () => {
            const html = renderActions(fixture());
            assert.ok(!/id="solveBtn"[^>]*disabled/.test(html));
            assert.ok(!/id="submitBtn"[^>]*disabled/.test(html));
        });

        test('every button is disabled when no language has an environment', () => {
            const html = renderActions(fixture({ test: { type: 'class', timeoutMs: 5000 } }));
            assert.ok(/id="solveBtn"[^>]*disabled/.test(html));
            assert.ok(/id="submitBtn"[^>]*disabled/.test(html));
        });
    });

    // ── renderTestCounts ──────────────────────────────────────────────────────

    suite('renderTestCounts', () => {

        const twoCases = [
            { input: { x: 1 }, expected: 1 },
            { input: { x: 2 }, expected: 4 },
        ];

        test('reads "N tests" when the artifact has no grading suite', () => {
            const html = renderTestCounts(fixture({ tests: twoCases, finalTests: [] }));
            assert.ok(html.includes('2 tests'));
            assert.ok(!html.includes('final'));
        });

        test('splits public and final counts when a grading suite exists', () => {
            const html = renderTestCounts(fixture({ tests: twoCases, finalTests: [twoCases[0]] }));
            assert.ok(/2 public tests/.test(html));
            assert.ok(/1 final tests/.test(html));
        });

        test('never reveals a final case input or expected value', () => {
            const secret = [{ input: { x: 987654 }, expected: 'sekrit' }];
            const html = renderTestCounts(fixture({ tests: twoCases, finalTests: secret }));
            assert.ok(!html.includes('987654'));
            assert.ok(!html.includes('sekrit'));
        });
    });
});
