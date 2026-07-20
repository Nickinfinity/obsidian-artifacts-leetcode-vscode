import * as assert from 'node:assert';
import {
    availableLanguages,
    renderActions,
    renderControls,
    renderLanguageRow,
    renderNavHeader,
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
            attempts:     [],
            tags:         [],
            ...overrides,
        };
    }

    // ── renderNavHeader ───────────────────────────────────────────────────────

    suite('renderNavHeader', () => {

        test('idle renders the back arrow, top-left, no close button', () => {
            const html = renderNavHeader('idle');
            assert.ok(html.includes('id="backBtn"'));
            assert.ok(html.includes('nav-header-left'));
            assert.ok(!html.includes('id="closeBtn"'));
        });

        test('running renders the close button, top-right, no back arrow', () => {
            const html = renderNavHeader('running');
            assert.ok(html.includes('id="closeBtn"'));
            assert.ok(html.includes('title="close"'));
            assert.ok(html.includes('nav-header-right'));
            assert.ok(!html.includes('id="backBtn"'));
        });

        test('solved and attempted both fall back to the back arrow', () => {
            for (const phase of ['solved', 'attempted'] as const) {
                const html = renderNavHeader(phase);
                assert.ok(html.includes('id="backBtn"'), phase);
                assert.ok(!html.includes('id="closeBtn"'), phase);
            }
        });

        test('running + bounded shows the timer, no "no limit" span', () => {
            const html = renderNavHeader('running', '29:58', false);
            assert.ok(html.includes('id="challengeTimer"'));
            assert.ok(html.includes('29:58'));
            assert.ok(!html.includes('id="challengeNoLimit"'));
        });

        test('running + unlimited shows the timer plus a #challengeNoLimit "no limit" span', () => {
            const html = renderNavHeader('running', '00:07', true);
            assert.ok(html.includes('id="challengeTimer"'));
            assert.ok(html.includes('00:07'));
            assert.ok(html.includes('id="challengeNoLimit"'));
            assert.ok(/no limit/i.test(html));
        });

        test('unlimited defaults to false — omitting the arg keeps bounded rendering', () => {
            const html = renderNavHeader('running', '10:00');
            assert.ok(!html.includes('id="challengeNoLimit"'));
        });

        test('idle/solved/attempted output is unchanged by the unlimited flag', () => {
            for (const phase of ['idle', 'solved', 'attempted'] as const) {
                const withFlag = renderNavHeader(phase, '', true);
                const without = renderNavHeader(phase);
                assert.strictEqual(withFlag, without, phase);
                assert.ok(!withFlag.includes('id="challengeNoLimit"'), phase);
            }
        });
    });

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
            // `ruby` has no registered function env (rust/typescript now do, as of
            // wave 3), so it is the honest stand-in for "declared but unrunnable".
            const p = fixture({
                setups:    [{ language: 'ruby', code: 'def two_sum; end' }],
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

        // A single runnable language is not a choice — the user configures
        // nothing, the run defaults to it. No visible chooser, but a hidden
        // marker still carries the id so the webview knows the language.
        test('a single runnable language renders no visible selector', () => {
            const p = fixture({
                setups:    [{ language: 'rust', code: 'fn two_sum() {}' }],
                solutions: [],
            });
            const html = renderLanguageRow(p);
            assert.ok(!html.includes('<select'), 'no dropdown for one language');
            assert.ok(/<input type="hidden" id="langSelector" value="rust"/.test(html),
                'a hidden marker carries the single language');
        });

        test('two or more runnable languages render a visible selector', () => {
            const html = renderLanguageRow(fixture());
            assert.ok(html.includes('<select id="langSelector"'));
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

    // ── renderControls ────────────────────────────────────────────────────────

    suite('renderControls', () => {

        test('idle shows the language select, practice settings, and Solve It', () => {
            const html = renderControls('idle', fixture());
            assert.ok(html.includes('id="langSelector"'));
            assert.ok(html.includes('class="practice-option"'));
            assert.ok(html.includes('id="solveBtn"'));
        });

        test('idle hides Run Tests and Submit', () => {
            const html = renderControls('idle', fixture());
            assert.ok(!html.includes('id="runTestsBtn"'));
            assert.ok(!html.includes('id="submitBtn"'));
        });

        test('running shows Run Tests and Submit', () => {
            const html = renderControls('running', fixture());
            assert.ok(html.includes('id="runTestsBtn"'));
            assert.ok(html.includes('id="submitBtn"'));
        });

        test('running hides practice settings and Solve It', () => {
            const html = renderControls('running', fixture());
            assert.ok(!html.includes('class="practice-option"'));
            assert.ok(!html.includes('id="timeLimit"'));
            assert.ok(!html.includes('id="solveBtn"'));
        });

        // The language is fixed once the clock starts — the selector was the
        // pre-start choice, and offering it mid-run risks grading a language
        // other than the one whose temp file is open.
        test('running renders no visible language selector, even with 2+ languages', () => {
            const html = renderControls('running', fixture(), 'python');
            assert.ok(!html.includes('<select'), 'no dropdown while running');
        });

        test('running carries the active language as a hidden marker', () => {
            const html = renderControls('running', fixture(), 'python');
            assert.ok(/<input type="hidden" id="langSelector" value="python"/.test(html),
                'the locked language is emitted so the webview filters blocks to it');
        });

        test('solved still offers the selector for a retry (2+ languages)', () => {
            const html = renderControls('solved', fixture());
            assert.ok(html.includes('<select id="langSelector"'));
        });

        test('solved shows the .solved-summary block and a Solve It retry button', () => {
            const html = renderControls('solved', fixture());
            assert.ok(html.includes('class="solved-summary"'));
            assert.ok(html.includes('id="solveBtn"'));
        });

        test('solved hides Run Tests, Submit, and practice settings', () => {
            const html = renderControls('solved', fixture());
            assert.ok(!html.includes('id="runTestsBtn"'));
            assert.ok(!html.includes('id="submitBtn"'));
            assert.ok(!html.includes('class="practice-option"'));
        });

        test('solved summary surfaces the recorded solve duration when present', () => {
            const p = fixture({
                solutions: [{ language: 'python', code: '# python', duration: '3m12s' }],
            });
            const html = renderControls('solved', p);
            assert.ok(html.includes('3m12s'));
        });

        test('attempted renders identically to idle', () => {
            const p = fixture();
            assert.strictEqual(renderControls('attempted', p), renderControls('idle', p));
        });

        test('Solve It is disabled in idle when no language has a test environment', () => {
            const html = renderControls('idle', fixture({ setups: [], solutions: [] }));
            assert.ok(/id="solveBtn"[^>]*disabled/.test(html));
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
