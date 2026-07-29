import * as assert from 'node:assert';
import { compareExpecteds, verifyExercise } from '../src/services/exercise-verify.helpers.js';

/**
 * Unit tests for the pure CoderByte-migration verification harness
 * (`verifyExercise` / `compareExpecteds`). Every fixture here is an inline
 * `.md` string built by `buildMd` — no `test/fixtures/` directory, per repo
 * convention.
 *
 * `verifyExercise` runs real solution code through `runSuite` (a `node`
 * subprocess), so this suite is an integration test of the harness, not a
 * pure-function test — same trade-off `leetcode-runner.test.ts` already makes.
 */
suite('exercise-verify', () => {

    interface CaseFixture { input: Record<string, unknown>; expected: unknown }
    interface ExampleFixture { input: string; output: string }

    interface FixtureOpts {
        title?: string;
        functionName?: string;
        params?: { name: string; type: string }[];
        returns?: string;
        testType?: string;
        timeoutMs?: number;
        examples?: ExampleFixture[];
        tests?: CaseFixture[];
        finalTests?: CaseFixture[];
        /** `null` omits the `# Solutions` section entirely. */
        solutionCode?: string | null;
        /** `null` omits the `# Setup` section entirely. */
        setupCode?: string | null;
    }

    const DEFAULT_EXAMPLES: ExampleFixture[] = [
        { input: 'a = 1, b = 2', output: '3' },
        { input: 'a = 5, b = 7', output: '12' },
    ];

    const DEFAULT_TESTS: CaseFixture[] = [
        { input: { a: 1, b: 2 }, expected: 3 },
        { input: { a: 5, b: 7 }, expected: 12 },
        { input: { a: 0, b: 0 }, expected: 0 },
        { input: { a: -1, b: 1 }, expected: 0 },
        { input: { a: 10, b: 20 }, expected: 30 },
        { input: { a: 100, b: 200 }, expected: 300 },
    ];

    const DEFAULT_FINAL_TESTS: CaseFixture[] = [
        { input: { a: 2, b: 2 }, expected: 4 },
        { input: { a: 3, b: 3 }, expected: 6 },
        { input: { a: 4, b: 4 }, expected: 8 },
    ];

    /** Builds a `type: leetcode` `.md` fixture; every option defaults to a valid, green exercise. */
    function buildMd(opts: FixtureOpts = {}): string {
        const {
            title = 'Sum',
            functionName = 'sum',
            params = [{ name: 'a', type: 'int' }, { name: 'b', type: 'int' }],
            returns = 'int',
            testType = 'function',
            timeoutMs,
            examples = DEFAULT_EXAMPLES,
            tests = DEFAULT_TESTS,
            finalTests = DEFAULT_FINAL_TESTS,
            solutionCode = 'function sum(a, b) { return a + b; }',
            setupCode = 'function sum(a, b) {\n  // solution here\n}',
        } = opts;

        const paramsYaml = params.map(p => `  - name: ${p.name}\n    type: ${p.type}`).join('\n');
        const timeoutLine = timeoutMs !== undefined ? `\n  timeoutMs: ${timeoutMs}` : '';
        const frontmatter = [
            '---',
            'type: leetcode',
            `title: ${title}`,
            'difficulty: easy',
            `function: ${functionName}`,
            'params:',
            paramsYaml,
            `returns: ${returns}`,
            'test:',
            `  type: ${testType}${timeoutLine}`,
            '---',
        ].join('\n');

        const examplesBlock = examples
            .map(e => '```example\ninput: ' + e.input + '\noutput: ' + e.output + '\n```')
            .join('\n\n');

        const setupSection = setupCode !== null
            ? `# Setup\n\n## JavaScript\n\`\`\`javascript\n${setupCode}\n\`\`\`\n\n`
            : '';
        const solutionsSection = solutionCode !== null
            ? `# Solutions\n\n## JavaScript\n\`\`\`javascript\n${solutionCode}\n\`\`\`\n`
            : '';

        return `${frontmatter}\n\nProblem description.\n\n## Examples\n${examplesBlock}\n\n`
            + `## Tests\n\`\`\`json\n${JSON.stringify(tests, null, 2)}\n\`\`\`\n\n`
            + `## Final Tests\n\`\`\`json\n${JSON.stringify(finalTests, null, 2)}\n\`\`\`\n\n`
            + `${setupSection}${solutionsSection}`;
    }

    // ── verifyExercise: happy path ────────────────────────────────────────────

    test('a conforming exercise with a green reference solution returns ok: true', async () => {
        const result = await verifyExercise(buildMd());
        assert.strictEqual(result.ok, true);
    });

    // ── Rule 1: parses ────────────────────────────────────────────────────────

    suite('rule 1 — parses', () => {

        test('an empty title fails', async () => {
            const result = await verifyExercise(buildMd({ title: '' }));
            assert.strictEqual(result.ok, false);
            assert.ok(!result.ok && /missing title/.test(result.reason), JSON.stringify(result));
        });

        test('an empty function name fails for a runnable test.type', async () => {
            const result = await verifyExercise(buildMd({ functionName: '' }));
            assert.strictEqual(result.ok, false);
            assert.ok(!result.ok && /missing function name/.test(result.reason), JSON.stringify(result));
        });
    });

    // ── Rule 2: structural shape ──────────────────────────────────────────────

    suite('rule 2 — structural shape', () => {

        test('fewer than 2 examples fails', async () => {
            const result = await verifyExercise(buildMd({ examples: [DEFAULT_EXAMPLES[0]] }));
            assert.strictEqual(result.ok, false);
            assert.ok(!result.ok && /need >= 2 examples/.test(result.reason), JSON.stringify(result));
        });

        test('a ## Tests input whose keys do not match params fails', async () => {
            const mismatched = DEFAULT_TESTS.map((t, i) =>
                i === 2 ? { input: { a: t.input.a, c: t.input.b }, expected: t.expected } : t);
            const result = await verifyExercise(buildMd({ tests: mismatched }));
            assert.strictEqual(result.ok, false);
            assert.ok(!result.ok && /input keys do not match params/.test(result.reason), JSON.stringify(result));
        });
    });

    // ── Rule 3: runnable languages green ──────────────────────────────────────

    suite('rule 3 — runnable, all declared languages green', () => {

        test('a failing reference solution fails', async () => {
            const result = await verifyExercise(buildMd({ solutionCode: 'function sum(a, b) { return a - b; }' }));
            assert.strictEqual(result.ok, false);
            assert.ok(!result.ok && result.reason.startsWith('run: javascript failed'), JSON.stringify(result));
        });

        // ── Security-critical: hostile reference solutions must not hang the harness ──

        test('a reference solution that throws fails without hanging', async () => {
            const result = await verifyExercise(
                buildMd({ solutionCode: 'function sum(a, b) { throw new Error("boom"); }' }),
            );
            assert.strictEqual(result.ok, false);
            assert.ok(!result.ok && result.reason.startsWith('run: javascript failed'), JSON.stringify(result));
        });

        test('a reference solution that spins forever fails via the suite timeout, not a hang', async () => {
            const result = await verifyExercise(
                buildMd({ solutionCode: 'function sum(a, b) { while (true) {} }', timeoutMs: 100 }),
            );
            assert.strictEqual(result.ok, false);
            assert.ok(!result.ok && /timeout/.test(result.reason), JSON.stringify(result));
        });
    });

    // ── Rule 4: reserved test.type ────────────────────────────────────────────

    suite('rule 4 — reserved test.type', () => {

        test('a reserved type skips the run step and relaxes the public-test floor to >= 1', async () => {
            const result = await verifyExercise(buildMd({
                testType: 'class',
                tests: DEFAULT_TESTS.slice(0, 2),
                finalTests: [],
                solutionCode: null,
                setupCode: null,
            }));
            assert.strictEqual(result.ok, true, JSON.stringify(result));
        });

        test('a reserved type still enforces its own (relaxed) floor', async () => {
            const result = await verifyExercise(buildMd({
                testType: 'class',
                tests: [],
                finalTests: [],
                solutionCode: null,
                setupCode: null,
            }));
            assert.strictEqual(result.ok, false);
            assert.ok(!result.ok && /need >= 1 public tests/.test(result.reason), JSON.stringify(result));
        });
    });

    // ── Rule 5: ## Examples ⊆ ## Tests pin ────────────────────────────────────

    suite('rule 5 — ## Examples ⊆ ## Tests pin', () => {

        test('an example pair absent from ## Tests fails', async () => {
            const result = await verifyExercise(buildMd({
                examples: [DEFAULT_EXAMPLES[0], { input: 'a = 9, b = 9', output: '18' }],
            }));
            assert.strictEqual(result.ok, false);
            assert.ok(!result.ok && /not mirrored in ## Tests/.test(result.reason), JSON.stringify(result));
        });

        // The pin matches input VALUES, not just the key set: an example that shares a
        // test case's param names AND expected value but differs in its input values is
        // NOT mirrored — a green solution never had to reproduce this specific input→output.
        test('an example sharing a test\'s keys and expected but not its input values fails', async () => {
            const result = await verifyExercise(buildMd({
                examples: [DEFAULT_EXAMPLES[0], { input: 'a = 9, b = 0', output: '3' }],
            }));
            assert.strictEqual(result.ok, false);
            assert.ok(!result.ok && /not mirrored in ## Tests/.test(result.reason), JSON.stringify(result));
        });
    });

    // ── path prefixing ────────────────────────────────────────────────────────

    test('a supplied path is prefixed onto the failure reason', async () => {
        const result = await verifyExercise(buildMd({ title: '' }), 'CoderByte/Strings/Bad.md');
        assert.strictEqual(result.ok, false);
        assert.ok(!result.ok && result.reason.startsWith('CoderByte/Strings/Bad.md: '), JSON.stringify(result));
    });

    // ── compareExpecteds ──────────────────────────────────────────────────────

    suite('compareExpecteds', () => {

        test('agreeing recomputed values return no mismatches', () => {
            const cases = [{ input: { a: 1 }, expected: 2 }, { input: { a: 2 }, expected: 4 }];
            assert.deepStrictEqual(compareExpecteds(cases, [2, 4]), []);
        });

        test('a single disagreement is reported by index', () => {
            const cases = [{ input: { a: 1 }, expected: 2 }, { input: { a: 2 }, expected: 4 }];
            assert.deepStrictEqual(compareExpecteds(cases, [2, 5]), [
                { index: 1, input: { a: 2 }, artifact: 4, recomputed: 5 },
            ]);
        });
    });

    // ── test.type: project — checks, not the function floor ──────────────────
    //
    // Every fixture here grades with `build` checks only. That is deliberate: a
    // build check runs a node one-liner and needs no toolchain install, so the
    // project branch is exercised deterministically and offline. The render
    // kinds have their own end-to-end coverage in `project-checks.test.ts`.

    suite('project exercises', () => {

        interface ProjectOpts {
            title?: string;
            files?: string;
            checks?: string;
            tests?: string;
        }

        const EXIT_OK = '["' + process.execPath.replace(/\\/g, '\\\\') + '", "-e", "process.exit(0)"]';
        const EXIT_BAD = '["' + process.execPath.replace(/\\/g, '\\\\') + '", "-e", "process.exit(1)"]';

        function buildProjectMd(opts: ProjectOpts = {}): string {
            const {
                title = 'Widget',
                files = '```javascript path=src/App.jsx role=editable\nexport default function App() { return null; }\n```',
                checks = `    - name: app builds\n      kind: build\n      argv: ${EXIT_OK}`,
                tests = '',
            } = opts;

            return [
                '---',
                'type: leetcode',
                `title: ${title}`,
                'difficulty: medium',
                'test:',
                '  type: project',
                '  checks:',
                checks,
                '---',
                '',
                'A multi-file exercise.',
                '',
                tests,
                '## Files',
                '',
                files,
                '',
            ].join('\n');
        }

        test('a project whose every check passes is ok', async () => {
            const result = await verifyExercise(buildProjectMd());
            assert.strictEqual(result.ok, true, !result.ok ? result.reason : '');
        });

        test('the function floor is not applied — no params, returns, or 6/3 case counts needed', async () => {
            // The same artifact would fail `checkStructure` on every count.
            const parsedFree = buildProjectMd();
            assert.ok(!parsedFree.includes('params:'), 'fixture must declare no params');
            assert.strictEqual((await verifyExercise(parsedFree)).ok, true);
        });

        test('a failing check fails the exercise and names the check', async () => {
            const result = await verifyExercise(buildProjectMd({
                checks: `    - name: app builds\n      kind: build\n      argv: ${EXIT_BAD}`,
            }));

            assert.strictEqual(result.ok, false);
            assert.ok(!result.ok && result.reason.includes('app builds'), !result.ok ? result.reason : '');
        });

        test('one red check among several fails the whole exercise', async () => {
            const result = await verifyExercise(buildProjectMd({
                checks: [
                    `    - name: first\n      kind: build\n      argv: ${EXIT_OK}`,
                    `    - name: second\n      kind: build\n      argv: ${EXIT_BAD}`,
                ].join('\n'),
            }));

            assert.strictEqual(result.ok, false);
            assert.ok(!result.ok && result.reason.includes('second'), !result.ok ? result.reason : '');
        });

        test('a project with no ## Files is refused before anything runs', async () => {
            const result = await verifyExercise(buildProjectMd({ files: '' }));
            assert.strictEqual(result.ok, false);
            assert.ok(!result.ok && /## Files/.test(result.reason), !result.ok ? result.reason : '');
        });

        test('duplicate check names are refused', async () => {
            const result = await verifyExercise(buildProjectMd({
                checks: [
                    `    - name: same\n      kind: build\n      argv: ${EXIT_OK}`,
                    `    - name: same\n      kind: build\n      argv: ${EXIT_OK}`,
                ].join('\n'),
            }));

            assert.strictEqual(result.ok, false);
            assert.ok(!result.ok && /unique/.test(result.reason), !result.ok ? result.reason : '');
        });

        test('a render check with no bound cases is refused rather than passing empty', async () => {
            const result = await verifyExercise(buildProjectMd({
                checks: '    - name: renders\n      kind: dom-assert\n      file: src/App.jsx',
            }));

            assert.strictEqual(result.ok, false);
            assert.ok(!result.ok && /no cases/.test(result.reason), !result.ok ? result.reason : '');
        });

        test('# Solutions overlays the starter, so an exercise ships unsolved and still verifies', async () => {
            // The starter exits 1; only the overlay's file makes the check pass, so a
            // green result proves the overlay was applied rather than the starter graded.
            const md = [
                buildProjectMd({
                    files: '```javascript path=probe.js role=editable\nprocess.exit(1);\n```',
                    checks: `    - name: probe\n      kind: build\n      argv: ["${process.execPath.replace(/\\/g, '\\\\')}", "probe.js"]`,
                }),
                '# Solutions',
                '',
                '```javascript path=probe.js',
                'process.exit(0);',
                '```',
                '',
            ].join('\n');

            const result = await verifyExercise(md);
            assert.strictEqual(result.ok, true, !result.ok ? result.reason : '');
        });

        test('without an overlay the starter itself is graded', async () => {
            const result = await verifyExercise(buildProjectMd({
                files: '```javascript path=probe.js role=editable\nprocess.exit(1);\n```',
                checks: `    - name: probe\n      kind: build\n      argv: ["${process.execPath.replace(/\\/g, '\\\\')}", "probe.js"]`,
            }));

            assert.strictEqual(result.ok, false);
        });

        test('a traversal path in ## Files fails every check, and writes nothing', async () => {
            const result = await verifyExercise(buildProjectMd({
                files: '```javascript path=../../escape.js role=editable\nx\n```',
            }));

            assert.strictEqual(result.ok, false);
            assert.ok(!result.ok && /path/i.test(result.reason), !result.ok ? result.reason : '');
        });
    });
});
