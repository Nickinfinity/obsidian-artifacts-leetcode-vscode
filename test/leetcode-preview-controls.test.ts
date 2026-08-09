import * as assert from 'node:assert';
import {
    availableLanguages,
    renderActions,
    renderControls,
    renderLanguageRow,
    renderNavHeader,
    renderPracticeControls,
    renderSetups,
} from '../src/ui/panels/leetcodePreview.controls.js';
import { renderTestCounts } from '../src/ui/panels/leetcodePreview.counts.js';
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

        // A `stack` has no registered env either, but it is a *file tree*: Solve
        // It writes `## Files` and opens the tabs, so gating it on the registry
        // left the exercise impossible to open at all. Grading stays refused
        // downstream — this only decides what the selector may offer.
        //
        // The shape is declared on the **leetcode-type axis**, not by
        // `test.type: 'service'`. Asking the test-type value a question about
        // the artifact's shape is the flattening the axis split undoes, and a
        // fixture that omits `leetcodeType` is read as a buffer — which is what
        // this assertion caught the moment `isMultiFile` stopped reading
        // `test.type`.
        test('a multi-file type with no env still offers its declared languages', () => {
            const p = fixture({ leetcodeType: 'stack', test: { type: 'service', timeoutMs: 5000 } });
            assert.deepStrictEqual(availableLanguages(p), ['javascript', 'python']);
        });

        // The `leetcodeType` argument T1.4 appended to `languagesForType` is
        // load-bearing here, and nothing pinned it until this test: the case
        // above cannot, because `languagesForType('service', …)` is `[]` with
        // or without the third argument, so it passes either way.
        //
        // This is the shape D14's migration actually produces — a check-graded
        // `package` whose `type:` line was deleted, so `test.type` falls back
        // to the default. Two answers diverge: with the argument,
        // `languagesForType('function', 'package')` is `[]` (a function env
        // serves one buffer, never a tree), the multi-file relaxation applies,
        // and every declared language is offered so the tree can be opened at
        // all. Drop the argument and the answer is all five runnable
        // languages, the relaxation switches off, and `ruby` — declared by
        // this artifact, runnable by nothing — silently disappears from the
        // selector.
        test('a migrated package offers every declared language, because the shape argument reaches the registry', () => {
            const p = fixture({
                leetcodeType: 'package',
                setups:       [{ language: 'ruby', code: 'def solve; end' }],
                solutions:    [{ language: 'python', code: '# py' }],
            });
            assert.deepStrictEqual(availableLanguages(p), ['ruby', 'python']);
        });

        test('the multi-file relaxation does not leak into a reserved single-file type', () => {
            const p = fixture({
                test:      { type: 'in-place', timeoutMs: 5000 },
                setups:    [{ language: 'ruby', code: '' }],
                solutions: [{ language: 'python', code: '' }],
            });
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

        // ── C15: refusalFor wiring ──────────────────────────────────────────
        // `refusalFor` is exported, unit-tested and had zero production callers
        // before this task — a documented authority nothing consulted. This is
        // its one live wiring point: `renderLanguageRow` falls back to a generic
        // hint today regardless of *why* no language is offered; C15 asks for
        // the three-axis sentence instead, whenever it can actually say more.

        test('names all three axes through refusalFor when leetcodeType is declared and the triple is unimplemented', () => {
            // The "obvious live case" from the task: `class` is reserved, so
            // `languagesForType('class', 'function')` is `[]` and the panel
            // reaches the empty-selector branch with a declared-but-unrunnable
            // 'java'. Before the wiring this rendered the generic hint.
            const p = fixture({
                leetcodeType: 'function',
                test:         { type: 'class', timeoutMs: 5000 },
                setups:       [{ language: 'java', code: 'class X {}' }],
                solutions:    [],
            });
            const html = renderLanguageRow(p);
            // The sentence goes through `escHtml` on its way into the webview
            // (C12) — `'` becomes `&#39;`, so the raw-quoted form never appears.
            assert.ok(html.includes('function artifacts cannot run &#39;class&#39; in java'), html);
            assert.ok(!html.includes("cannot run 'class'"), 'must not carry an unescaped quote: ' + html);
            assert.ok(!/in any language this exercise provides/.test(html), html);
        });

        test('keeps the generic hint when leetcodeType is undefined — never defaulted to function', () => {
            // Same reserved-type shape as above, but `leetcodeType` is left
            // undeclared (as a hand-built fixture elsewhere in the codebase
            // might). `refusalFor` requires a `LeetcodeTypeId`, so defaulting it
            // with `?? 'function'` would grade a `stack` as a buffer — the C15
            // instruction is explicit that this must never happen at a call site.
            const p = fixture({ test: { type: 'class', timeoutMs: 5000 } });
            const html = renderLanguageRow(p);
            assert.ok(html.includes('<code>class</code>'), html);
            assert.ok(!html.includes('cannot run'), html);
        });

        test('does not consult refusalFor for a check-graded package, even when its declared language has no matching env', () => {
            // A `package` with `checks:` grades through `gradeProjectDir`, never
            // the suite registry `refusalFor` reads — consulting it there is the
            // inert guard T1.16 shipped twice. `test.type: 'project'` plus a
            // `ruby` setup (no env registered for either) proves the guard is
            // load-bearing: without it this scenario has a genuine non-null
            // `refusalFor` answer and would leak the specific sentence.
            const p = fixture({
                leetcodeType: 'package',
                checks: [{ name: 'builds', kind: 'build', argv: ['true'], cases: [], publicCount: 0 }],
                test:      { type: 'project', timeoutMs: 5000 },
                setups:    [{ language: 'ruby', code: '' }],
                solutions: [],
            });
            const html = renderLanguageRow(p);
            assert.ok(!html.includes('cannot run'), html);
            assert.ok(/no test environment/i.test(html), html);
        });

        // C12: a refusal reason reaching a webview is untrusted the moment any
        // of its three interpolated axes can be artifact-authored text — the
        // declared language name is exactly that (a `## <Language>` heading is
        // free text `resolveLangId` passes through unchanged when unrecognised).
        test('escapes a hostile declared language name before the refusalFor sentence reaches the webview', () => {
            const p = fixture({
                leetcodeType: 'function',
                test:         { type: 'class', timeoutMs: 5000 },
                setups:       [{ language: '<img src=x onerror=alert(1)>', code: '' }],
                solutions:    [],
            });
            const html = renderLanguageRow(p);
            assert.ok(!/<img/i.test(html), `must not carry a raw <img tag: ${html}`);
            assert.ok(!/<script/i.test(html), `must not carry a raw <script tag: ${html}`);
            assert.ok(html.includes('&lt;img'), html);
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

        // ── project: the suite is `checks:`, not `## Tests` ────────────────────
        // The function-suite reading told a build-only exercise it had `0 tests`
        // and hid the second check gating a solver's Submit entirely.

        test('a build-only project names its check instead of reading "0 tests"', () => {
            const html = renderTestCounts(fixture({
                tests: [], finalTests: [],
                checks: [{ name: 'type-checks', kind: 'build', argv: ['tsc'], cases: [], publicCount: 0 }],
            }));
            assert.ok(!/0 tests/.test(html), `must not claim zero tests: ${html}`);
            assert.ok(html.includes('type-checks'), html);
            assert.ok(html.includes('build'), html);
        });

        test('every check is listed, so none gating Submit is invisible', () => {
            const html = renderTestCounts(fixture({
                tests: twoCases, finalTests: [twoCases[0]],
                checks: [
                    {
                        name: 'catalogue filter', kind: 'function',
                        file: 'src/lib/catalogue.ts', function: 'filterInStock',
                        cases: [...twoCases, twoCases[0]], publicCount: 2,
                    },
                    { name: 'app builds', kind: 'build', argv: ['tsc'], cases: [], publicCount: 0 },
                ],
            }));
            assert.ok(html.includes('catalogue filter'), html);
            assert.ok(html.includes('app builds'), html);
            assert.ok(/2 public/.test(html), html);
            assert.ok(/1 hidden/.test(html), html);
        });

        test('a check name is escaped — it is artifact-controlled', () => {
            const html = renderTestCounts(fixture({
                tests: [], finalTests: [],
                checks: [{
                    name: '<img src=x onerror=alert(1)>', kind: 'build',
                    argv: ['true'], cases: [], publicCount: 0,
                }],
            }));
            assert.ok(!html.includes('<img'), `check name must be escaped: ${html}`);
            assert.ok(html.includes('&lt;img'), html);
        });

        // `program` is not registered in the env registry this wave (T2.5 ships
        // the factory, T2.8 wires it in) — so a `package` + `program` artifact
        // has no test environment at all today. The counts line must still read
        // the parsed suite, never gate on the registry: this pins that a
        // registry-blind dispatch (the correct design) is what ships, guarding
        // against the naive wrong one the orchestrator flagged — a dispatch that
        // checks `languagesForType(...).length` before rendering would report
        // `0 tests` for this exact artifact.
        test('a package + program artifact renders its real case counts, never a registry-gated zero', () => {
            const p = fixture({
                leetcodeType: 'package',
                test:         { type: 'program', timeoutMs: 5000 },
                tests: twoCases, finalTests: [],
                checks: [],
            });
            const html = renderTestCounts(p);
            assert.ok(/2 tests/.test(html), html);
            assert.ok(!/0 tests/.test(html), html);
        });

        test('a project check never reveals a hidden case value', () => {
            const html = renderTestCounts(fixture({
                tests: [], finalTests: [],
                checks: [{
                    name: 'counter', kind: 'dom-assert', file: 'src/App.jsx',
                    cases: [{ input: { x: 1 }, expected: 'ok' }, { input: { x: 987654 }, expected: 'sekrit' }],
                    publicCount: 1,
                }],
            }));
            assert.ok(!html.includes('987654'), html);
            assert.ok(!html.includes('sekrit'), html);
        });
    });
});
