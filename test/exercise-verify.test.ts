import * as assert from 'node:assert';
import { compareExpecteds, verifyExercise } from '../src/services/exercise-verify.helpers.js';

/**
 * Unit tests for the pure artifact verification harness
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

    /** Builds an `artifactType: leetcode` `.md` fixture; every option defaults to a valid, green exercise. */
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
            'artifactType: leetcode',
            `title: ${title}`,
            'difficulty: easy',
            '---',
        ].join('\n');

        const signatureFence = '```yaml leetcode\n'
            + `function: ${functionName}\n`
            + 'params:\n'
            + `${paramsYaml}\n`
            + `returns: ${returns}\n`
            + '```';

        const testFence = '```yaml leetcode\n'
            + 'test:\n'
            + `  type: ${testType}${timeoutLine}\n`
            + '```';

        const examplesBlock = examples
            .map(e => '```example\ninput: ' + e.input + '\noutput: ' + e.output + '\n```')
            .join('\n\n');

        const setupSection = setupCode !== null
            ? `# Setup\n\n## JavaScript\n\`\`\`javascript\n${setupCode}\n\`\`\`\n\n`
            : '';
        const solutionsSection = solutionCode !== null
            ? `# Solutions\n\n## JavaScript\n\`\`\`javascript\n${solutionCode}\n\`\`\`\n`
            : '';

        return `${frontmatter}\n\nProblem description.\n\n${signatureFence}\n\n## Examples\n${examplesBlock}\n\n`
            + `${testFence}\n\n## Tests\n\`\`\`json\n${JSON.stringify(tests, null, 2)}\n\`\`\`\n\n`
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

        // ── VSX-231 C12 follow-up: function.rules.ts's own untrusted-text sink ──
        //
        // `bad.error` (child-process output — here, a thrown `Error`'s own
        // message) must be sanitized without losing its newlines. The hostile
        // bytes are produced by the *candidate itself*, at runtime, via
        // `String.fromCharCode` inside the solution source — never typed as
        // literal control bytes or `\uXXXX` text in this file — so this proves
        // the real `runSuite` → `checkSolutionsGreen` path, not a simulated one.

        test('SEC: a thrown Error with a multi-line, ANSI-laden message is sanitized but keeps its newlines', async () => {
            const solutionCode = [
                'function sum(a, b) {',
                '  throw new Error(',
                '    "line one\\n" + String.fromCharCode(27) + "[31mline two"',
                '      + String.fromCharCode(27) + "[0m\\nline three",',
                '  );',
                '}',
            ].join('\n');
            const result = await verifyExercise(buildMd({ solutionCode }));
            assert.strictEqual(result.ok, false);
            const reason = !result.ok ? result.reason : '';
            const esc = String.fromCharCode(27);
            assert.ok(!reason.includes(esc), `ESC byte leaked into reason: ${JSON.stringify(reason)}`);
            assert.strictEqual(
                reason,
                'run: javascript failed case 0: line one\n[31mline two[0m\nline three',
                JSON.stringify(reason),
            );
        });

        // ── Finding 6 (independent-review follow-up on 16453e7): F1/F2 ──────
        //
        // The thrown-Error test above only proves `bad.error`'s sanitizer
        // (the branch `checkSolutionsGreen` takes when the candidate throws).
        // F1/F2 name the *other* branch — `bad.error` falsy, the candidate
        // returns cleanly but the value disagrees with `## Tests`' own
        // `expected` — which stayed unpinned: `sanitizeUntrustedText` around
        // `canonicalJson(bad.expected)` (an artifact-authored value, F1) and
        // `sanitizeChildOutput` around `bad.actual` (the candidate's own
        // return value, F2). Hostile bytes are produced by the candidate
        // itself at runtime via `String.fromCharCode`, never typed as literal
        // control bytes or `\uXXXX` text in this file — same discipline as
        // the thrown-Error fixture above.

        test('SEC (F1/F2): a mismatched (non-throwing) result sanitizes both the artifact expected and the candidate actual', async () => {
            // Both hostile values carry a bidi-control mark (RLO), not an ESC
            // byte: bad.actual is already a canonicalJson-encoded string by
            // the time it reaches this sink (the js driver's own sentinel
            // protocol), and JSON encoding neutralizes a raw ESC byte into
            // safe backslash-escaped text on its own -- measured directly,
            // this is the same asymmetry SEC-3 hit in verify-exercise.mjs.
            // RLO survives canonicalJson unescaped, so it is the one hostile
            // byte that actually reaches sanitizeChildOutput/sanitizeUntrustedText
            // raw at this call site, making it the fixture that actually
            // exercises the sanitizer rather than one that trivially passes
            // either way.
            const rlo = String.fromCharCode(0x202e);
            // Every case's candidate output is this fixed hostile string —
            // giving every case bar one the *same* value as its own `expected`
            // keeps the suite green everywhere except the one case under test,
            // so `bad` is unambiguously case 0.
            const hostileActual = 'ACTUAL-' + rlo + 'raw';
            const hostileExpected = 'EXPECTED-' + rlo + 'hostile';

            const solutionCode = [
                'function identity(a) {',
                '  return "ACTUAL-" + String.fromCharCode(0x202e) + "raw";',
                '}',
            ].join('\n');

            const passingCase = { input: { a: 'x' }, expected: hostileActual };
            const tests = [
                { input: { a: 'x' }, expected: hostileExpected },
                passingCase, passingCase, passingCase, passingCase, passingCase,
            ];
            const finalTests = [passingCase, passingCase, passingCase];

            const result = await verifyExercise(buildMd({
                functionName: 'identity',
                params: [{ name: 'a', type: 'string' }],
                returns: 'string',
                tests,
                finalTests,
                solutionCode,
            }));

            assert.strictEqual(result.ok, false, JSON.stringify(result));
            const reason = !result.ok ? result.reason : '';
            assert.ok(!reason.includes(rlo), `RLO code point leaked into reason: ${JSON.stringify(reason)}`);
            assert.strictEqual(
                reason,
                'run: javascript failed case 0: expected "EXPECTED-hostile", got "ACTUAL-raw"',
                JSON.stringify(reason),
            );
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

        test('a reserved type declares no params or returns — it has no candidate function', async () => {
            // `service` is check-graded like `project`: a file tree and a list of
            // checks, no single function. Measuring it against the function floor
            // reported `structural: missing params`, which named the wrong thing.
            const result = await verifyExercise(buildMd({
                testType: 'class',
                params: [],
                returns: '',
                tests: DEFAULT_TESTS.slice(0, 2),
                finalTests: [],
                solutionCode: null,
                setupCode: null,
            }));
            assert.strictEqual(result.ok, true, JSON.stringify(result));
        });

        test('a reserved type is not held to the examples-pinned rule', async () => {
            // `## Examples` for a check-graded type are illustrative (an HTTP
            // request/response sample), not function input/output pairs, so there
            // is nothing in `## Tests` for them to mirror.
            const result = await verifyExercise(buildMd({
                testType: 'class',
                params: [],
                returns: '',
                examples: [
                    { input: 'GET /orders', output: '200 [{"id":1}]' },
                    { input: 'POST /orders', output: '201' },
                ],
                tests: DEFAULT_TESTS.slice(0, 2),
                finalTests: [],
                solutionCode: null,
                setupCode: null,
            }));
            assert.strictEqual(result.ok, true, JSON.stringify(result));
        });

        test('a runnable type is still held to the examples-pinned rule', async () => {
            // The relaxation must not leak into the function path — this is the
            // mutation that would otherwise go unnoticed.
            const result = await verifyExercise(buildMd({
                examples: [
                    { input: 'a = 1, b = 2', output: '3' },
                    { input: 'a = 99, b = 99', output: '198' },
                ],
            }));
            assert.strictEqual(result.ok, false);
            assert.ok(!result.ok && /pin: example\[1\]/.test(result.reason), JSON.stringify(result));
        });

        test('a reserved type that does declare params still has its input keys checked', async () => {
            // The relaxation is about *absence*, not a licence to drift: a reserved
            // type carrying params is still held to them.
            const result = await verifyExercise(buildMd({
                testType: 'class',
                tests: [{ input: { wrong: 1 }, expected: 2 }],
                finalTests: [],
                solutionCode: null,
                setupCode: null,
            }));
            assert.strictEqual(result.ok, false);
            assert.ok(
                !result.ok && /input keys do not match params/.test(result.reason),
                JSON.stringify(result),
            );
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
        const result = await verifyExercise(buildMd({ title: '' }), 'Strings/Bad.md');
        assert.strictEqual(result.ok, false);
        assert.ok(!result.ok && result.reason.startsWith('Strings/Bad.md: '), JSON.stringify(result));
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
            /** `''` omits `# Solutions` entirely — the pre-solved condition. */
            solutions?: string;
        }

        const EXIT_OK = '["' + process.execPath.replace(/\\/g, '\\\\') + '", "-e", "process.exit(0)"]';
        const EXIT_BAD = '["' + process.execPath.replace(/\\/g, '\\\\') + '", "-e", "process.exit(1)"]';

        function buildProjectMd(opts: ProjectOpts = {}): string {
            const {
                title = 'Widget',
                files = '```javascript path=src/App.jsx role=editable\nexport default function App() { return null; }\n```',
                checks = `    - name: app builds\n      kind: build\n      argv: ${EXIT_OK}`,
                tests = '',
                // A real exercise ships a starter plus a reference overlay; green
                // with no overlay means the starter passed, which is pre-solved.
                solutions = '# Solutions\n\n```javascript path=src/App.jsx\nexport default function App() { return null; }\n```\n',
            } = opts;

            return [
                '---',
                'artifactType: leetcode',
                `title: ${title}`,
                'difficulty: medium',
                '---',
                '',
                'A multi-file exercise.',
                '',
                '```yaml leetcode',
                'test:',
                '  type: project',
                '  checks:',
                checks,
                '```',
                '',
                tests,
                '## Files',
                '',
                files,
                '',
                solutions,
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
            const md = buildProjectMd({
                files: '```javascript path=probe.js role=editable\nprocess.exit(1);\n```',
                checks: `    - name: probe\n      kind: build\n      argv: ["${process.execPath.replace(/\\/g, '\\\\')}", "probe.js"]`,
                solutions: '# Solutions\n\n```javascript path=probe.js\nprocess.exit(0);\n```\n',
            });

            const result = await verifyExercise(md);
            assert.strictEqual(result.ok, true, !result.ok ? result.reason : '');
        });

        test('a project verifying green with no # Solutions overlay ships pre-solved', async () => {
            // Green *and* no overlay means the harness graded the starter, so the
            // starter passes — the solver presses Solve It, Submit, and is marked
            // solved having written nothing. `react-counter.md` shipped this way.
            const result = await verifyExercise(buildProjectMd({ solutions: '' }));
            assert.strictEqual(result.ok, false, JSON.stringify(result));
            assert.ok(
                !result.ok && /pre-solved/.test(result.reason),
                `reason must name the pre-solved condition: ${JSON.stringify(result)}`,
            );
        });

        test('without an overlay the starter itself is graded', async () => {
            const result = await verifyExercise(buildProjectMd({
                files: '```javascript path=probe.js role=editable\nprocess.exit(1);\n```',
                checks: `    - name: probe\n      kind: build\n      argv: ["${process.execPath.replace(/\\/g, '\\\\')}", "probe.js"]`,
                solutions: '',
            }));

            assert.strictEqual(result.ok, false);
            // It must fail because the *check* went red on the starter, not because
            // the pre-solved rule fired — otherwise this stops testing the fallback.
            assert.ok(
                !result.ok && result.reason.includes("check 'probe' failed"),
                `must fail on the graded starter, not the overlay rule: ${JSON.stringify(result)}`,
            );
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
