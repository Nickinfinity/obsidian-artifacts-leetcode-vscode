import * as assert from 'node:assert';
import { verifyExercise } from '../src/services/exercise-verify.helpers.js';

/**
 * VSX-154 (T1.7) — `verifyExercise` dispatches on the **leetcode-type axis**
 * (`parsed.leetcodeType`) through a rules registry, not a hand-rolled
 * `if (parsed.test.type === 'project')` branch.
 *
 * `exercise-verify.test.ts` already pins the full `function` floor and the
 * `project`-derived `package` behaviour byte-for-byte; this suite adds only
 * what T1.7 changes: the registry-based dispatch itself, the `package:`
 * message rename, the `checks:` / `test.type` mirror rule, and the `stack`
 * routing decision.
 */
suite('exercise-verify — rules registry (leetcode-type axis)', () => {

    const NODE = process.execPath.replace(/\\/g, '\\\\');

    // ── T1.7's own test-first assertion ───────────────────────────────────
    //
    // A `package`-shaped artifact (derived from the legacy `test.type:
    // project`, same as every `exercise-verify.test.ts` project fixture)
    // declaring no `## Files` must fail structurally, before anything is
    // installed or run — and the message must come from `package.rules.ts`,
    // not the old inline `project:`-prefixed string.

    test('a package artifact with no ## Files fails with the exact registry message', async () => {
        const md = [
            '---',
            'artifactType: leetcode',
            'title: Widget',
            'difficulty: medium',
            '---',
            '',
            'A multi-file exercise.',
            '',
            '```yaml leetcode',
            'test:',
            '  type: project',
            '```',
            '',
        ].join('\n');

        const result = await verifyExercise(md);
        assert.strictEqual(result.ok, false);
        assert.strictEqual(!result.ok ? result.reason : '', 'package: no ## Files declared');
    });

    // ── registry routing: leetcodeType drives dispatch, not test.type ─────

    /** A well-formed `package` artifact: one `build` check that reads `probe.js`. */
    function buildPackageMd(opts: { testBlock?: string } = {}): string {
        const { testBlock = '' } = opts;
        return [
            '---',
            'artifactType: leetcode',
            'leetcodeType: package',
            'title: Widget',
            'difficulty: medium',
            '---',
            '',
            'A multi-file exercise.',
            '',
            '```yaml leetcode',
            testBlock,
            'checks:',
            '  - name: probe',
            '    kind: build',
            `    argv: ["${NODE}", "probe.js"]`,
            '```',
            '',
            '## Files',
            '',
            '```javascript path=probe.js role=editable',
            'process.exit(1);',
            '```',
            '',
            '# Solutions',
            '',
            '```javascript path=probe.js',
            'process.exit(0);',
            '```',
        ].join('\n');
    }

    test('a migrated package — checks, no test.type at all — verifies green', async () => {
        // This is the shape the migration *produces*: it deletes the `type:`
        // line from every `test:` block declaring `checks:`. An earlier cut of
        // the mirror rule required the legacy shape marker to be **present**,
        // which would have failed every artifact the migration writes.
        const result = await verifyExercise(buildPackageMd());
        assert.strictEqual(result.ok, true, JSON.stringify(result));
    });

    test('an unmigrated package still carrying the legacy shape marker verifies green', async () => {
        const result = await verifyExercise(buildPackageMd({ testBlock: 'test:\n  type: project' }));
        assert.strictEqual(result.ok, true, JSON.stringify(result));
    });

    // C10: the residual gap the mirror rule was written to catch but could
    // not see — `type: call` names exactly the default, so before the parser
    // recorded the raw scalar this was indistinguishable from no `type:` at
    // all and slipped through green. It must refuse exactly like `in-place`
    // does below, not because `call` is a worse strategy but because it was
    // *declared*, and `checks:` + a declared strategy are mutually exclusive.
    test('a package explicitly naming test.type: call (the default) is refused by the mirror rule', async () => {
        const result = await verifyExercise(buildPackageMd({ testBlock: 'test:\n  type: call' }));
        assert.strictEqual(result.ok, false, JSON.stringify(result));
        assert.strictEqual(
            !result.ok ? result.reason : '',
            "package: checks declared but test.type is 'call' — "
                + 'a checks-graded exercise must not also declare a top-level execution strategy',
        );
    });

    test('a package that also names a real execution strategy is refused by the mirror rule', async () => {
        // The direction that stays a violation: `checks:` and a deliberately
        // named single-suite strategy are mutually exclusive. Everything else
        // about this fixture is valid — the overlay exits 0 — so a green
        // result would mean the guard was deleted, not that the fixture is
        // malformed.
        const result = await verifyExercise(buildPackageMd({ testBlock: 'test:\n  type: in-place' }));
        assert.strictEqual(result.ok, false, JSON.stringify(result));
        assert.strictEqual(
            !result.ok ? result.reason : '',
            "package: checks declared but test.type is 'in-place' — "
                + 'a checks-graded exercise must not also declare a top-level execution strategy',
        );
    });

    // ── C37: a `call` check needs the artifact's own top-level `params:` ──
    //
    // T4.4 gave `stack.rules.ts` this exact rule (its rule 3) but
    // `package.rules.ts` never checked it — so a `package` declaring a `call`
    // check with no top-level `params:` graded its cases against nothing
    // instead of failing by name. `runFunctionCheck` builds each case's
    // arguments from the artifact's own `params:`, never anything the check
    // itself declares, so this is a genuine case-shape mismatch. The rule now
    // lives once, in the shared structural path both `package.rules.ts` and
    // `stack.rules.ts` delegate through (`checkPackageStructure`) — this
    // fixture is the `package` half of the pin; `exercise-verify-stack.test.ts`
    // still pins the `stack` half, now reached the same way.

    test('a package with a call check and no top-level params fails on the case-shape mismatch', async () => {
        const md = [
            '---',
            'artifactType: leetcode',
            'leetcodeType: package',
            'title: Widget',
            'difficulty: medium',
            '---',
            '',
            'A multi-file exercise.',
            '',
            '```yaml leetcode',
            'checks:',
            '  - name: pricing',
            '    kind: call',
            '    file: index.js',
            '    function: computePrice',
            '```',
            '',
            '## Files',
            '',
            '```javascript path=index.js role=editable',
            'module.exports = { computePrice: () => 0 };',
            '```',
            '',
            '## Tests',
            '```json check=pricing',
            '[{"input": {"price": 10}, "expected": 10}]',
            '```',
        ].join('\n');

        const result = await verifyExercise(md);
        assert.strictEqual(result.ok, false, JSON.stringify(result));
        assert.strictEqual(
            !result.ok ? result.reason : '',
            "package: check 'pricing' is kind 'call' but the artifact declares no params "
                + "— a call check runs against the artifact's own top-level function shape",
        );
    });

    test('an explicit leetcodeType: stack is held to the package rules, not the function floors', async () => {
        // A `stack` is *several packages* — the most tree-shaped artifact in
        // the model — so it is graded by declared checks, never by one
        // candidate buffer. An earlier cut routed it to the function rules to
        // keep two `test.type: 'service'` fixtures green; those fixtures
        // assert the **reserved-test-type** relaxation and their `service`
        // spelling merely predated the axis, so they now say `class` and the
        // routing follows the model instead of the fixtures.
        //
        // What that routing actually bought: a `stack` could not verify in any
        // `test.type` spelling, *and* one with duplicate check names, failing
        // checks and no overlay reported ok — the function rules never look at
        // a file tree.
        //
        // T4.4 gives `stack` its own rule set (`stack.rules.ts`), whose first
        // gate is the shape check this suite pins separately
        // (`exercise-verify-stack.test.ts`); two `packages:` entries here
        // clear that gate so this fixture still exercises the *next* one down
        // — the reused package rules' `## Files` requirement — exactly as it
        // did before T4.4.
        const md = [
            '---',
            'artifactType: leetcode',
            'leetcodeType: stack',
            'title: Widget',
            'difficulty: medium',
            '---',
            '',
            'Problem description.',
            '',
            '```yaml leetcode',
            'packages:',
            '  - name: api',
            '    dir: pkg-api',
            '    install: ["noop"]',
            '    start: ["noop"]',
            '  - name: web',
            '    dir: pkg-web',
            '    install: ["noop"]',
            '    start: ["noop"]',
            '```',
            '',
            '## Examples',
            '```example',
            'input: a = 1',
            'output: 2',
            '```',
            '',
            '## Tests',
            '```json',
            '[{"input": {"a": 1}, "expected": 2}]',
            '```',
        ].join('\n');

        const result = await verifyExercise(md);
        assert.strictEqual(result.ok, false, JSON.stringify(result));
        assert.match(result.reason ?? '', /^stack: no ## Files declared$/);
    });

    // ── VSX-231 C12 follow-up: package.rules.ts's own untrusted-text sinks ───
    //
    // `sanitize-text.helpers.test.ts` proves the two sanitizers themselves are
    // correct in isolation; it does NOT prove `package.rules.ts` actually calls
    // them at each sink. These fixtures drive real artifact-authored content
    // (a check's own declared `name:`, a real subprocess's own stderr) through
    // `verifyPackageExercise` end to end, so a removed `sanitizeUntrustedText`/
    // `sanitizeChildOutput` call at any of these sites fails a test here, not
    // just in the sanitizer's own unit suite. Hostile bytes are built at
    // runtime via `String.fromCharCode` — never typed as `\uXXXX` text — per
    // the tool-pipeline hazard that silently decodes bare 4-hex escapes.

    suite('C12: sinks are actually sanitized, not just sanitizable', () => {

        const ESC = String.fromCharCode(0x1b);

        test('a failing build check sanitizes both its own hostile name and multi-line hostile stderr', async () => {
            // A real `node -e` subprocess writes hostile, multi-line stderr and
            // exits 1 — the exact shape `build.check.ts`'s `failureText` returns
            // as `detail` verbatim. The hostile bytes travel as one `execFile`
            // argv element (no shell), landing in the child's own `process.argv`
            // intact, so this is the real code path, not a simulated string.
            const hostileStderr = ['line one', `${ESC}[31mline two${ESC}[0m`, 'line three'].join('\n');
            const childScript = 'process.stderr.write(process.argv[1]); process.exit(1);';
            const argv = JSON.stringify([process.execPath, '-e', childScript, hostileStderr]);
            const hostileName = `${ESC}[31mFAKE-PASS${ESC}[0m`;

            const md = [
                '---',
                'artifactType: leetcode',
                'leetcodeType: package',
                'title: Widget',
                'difficulty: medium',
                '---',
                '',
                'A multi-file exercise.',
                '',
                '```yaml leetcode',
                'checks:',
                `  - name: ${hostileName}`,
                '    kind: build',
                `    argv: ${argv}`,
                '```',
                '',
                '## Files',
                '',
                '```javascript path=probe.js role=editable',
                '// nothing to build',
                '```',
            ].join('\n');

            const result = await verifyExercise(md);
            assert.strictEqual(result.ok, false, JSON.stringify(result));
            const reason = !result.ok ? result.reason : '';

            // No raw ESC byte anywhere in the composed reason (name OR detail) —
            // the sanitizer strips only the C0/C1 trigger byte, not the inert
            // printable text that followed it (`[31m...[0m` survives literally,
            // exactly like `sanitizeUntrustedText`'s own documented example).
            assert.ok(!reason.includes(ESC), `ESC byte leaked into reason: ${JSON.stringify(reason)}`);
            assert.strictEqual(
                reason,
                "package: check '[31mFAKE-PASS[0m' failed: line one\n[31mline two[0m\nline three",
                JSON.stringify(reason),
            );
            // The multi-line stderr must keep its newlines — the whole reason
            // `sanitizeChildOutput` exists instead of reusing `sanitizeUntrustedText`.
            assert.ok(reason.includes('line one\n') && reason.includes('\nline three'), JSON.stringify(reason));
        });

        test('an unbound (no cases) check with a hostile name is sanitized', async () => {
            const hostileName = `${ESC}[31mFAKE${ESC}[0m`;
            const md = [
                '---',
                'artifactType: leetcode',
                'leetcodeType: package',
                'title: Widget',
                'difficulty: medium',
                '---',
                '',
                'A multi-file exercise.',
                '',
                '```yaml leetcode',
                'checks:',
                `  - name: ${hostileName}`,
                '    kind: dom-assert',
                '    file: App.jsx',
                '```',
                '',
                '## Files',
                '',
                '```javascript path=App.jsx role=editable',
                '// stub',
                '```',
            ].join('\n');

            const result = await verifyExercise(md);
            assert.strictEqual(result.ok, false, JSON.stringify(result));
            const reason = !result.ok ? result.reason : '';
            assert.ok(!reason.includes(ESC), `ESC byte leaked: ${JSON.stringify(reason)}`);
            assert.strictEqual(
                reason,
                "package: check '[31mFAKE[0m' has no cases — bind them with a `check=` fence attribute",
                JSON.stringify(reason),
            );
        });

        test("a call check's hostile name is sanitized in the no-params case-shape message", async () => {
            const hostileName = `${ESC}[31mpricing${ESC}[0m`;
            const md = [
                '---',
                'artifactType: leetcode',
                'leetcodeType: package',
                'title: Widget',
                'difficulty: medium',
                '---',
                '',
                'A multi-file exercise.',
                '',
                '```yaml leetcode',
                'checks:',
                `  - name: ${hostileName}`,
                '    kind: call',
                '    file: index.js',
                '    function: computePrice',
                '```',
                '',
                '## Files',
                '',
                '```javascript path=index.js role=editable',
                'module.exports = { computePrice: () => 0 };',
                '```',
                '',
                '## Tests',
                `\`\`\`json check=${hostileName}`,
                '[{"input": {"price": 10}, "expected": 10}]',
                '```',
            ].join('\n');

            const result = await verifyExercise(md);
            assert.strictEqual(result.ok, false, JSON.stringify(result));
            const reason = !result.ok ? result.reason : '';
            assert.ok(!reason.includes(ESC), `ESC byte leaked: ${JSON.stringify(reason)}`);
            assert.strictEqual(
                reason,
                "package: check '[31mpricing[0m' is kind 'call' but the artifact declares no params "
                    + "— a call check runs against the artifact's own top-level function shape",
                JSON.stringify(reason),
            );
        });

        // No hostile-`declared` test: `checkTestTypeMirror`'s `declared` is
        // `parsed.test.type`, which `parseTestType` (leetcode-parser.helpers.ts)
        // already collapses to `DEFAULT_TEST_TYPE` for anything outside the
        // closed `VALID_TEST_TYPES` vocabulary *before* this rule ever sees it —
        // confirmed by hand: a hostile `type:` value parses to `'call'` (the
        // default), never survives as authored text. `declared` therefore
        // cannot carry attacker bytes any more than `lang` (a `LangId`) can in
        // `function.rules.ts`; `sanitizeUntrustedText` around it is
        // defense-in-depth against the vocabulary check ever loosening, not a
        // reachable sink today. The existing "refused by the mirror rule" test
        // above already pins the plain (non-hostile) case byte-for-byte.

        test('an over-long hostile check name is both stripped and truncated with a visible marker', async () => {
            const hostileName = `${ESC}[31m${'A'.repeat(300)}`;
            const md = [
                '---',
                'artifactType: leetcode',
                'leetcodeType: package',
                'title: Widget',
                'difficulty: medium',
                '---',
                '',
                'A multi-file exercise.',
                '',
                '```yaml leetcode',
                'checks:',
                `  - name: ${hostileName}`,
                '    kind: dom-assert',
                '    file: App.jsx',
                '```',
                '',
                '## Files',
                '',
                '```javascript path=App.jsx role=editable',
                '// stub',
                '```',
            ].join('\n');

            const result = await verifyExercise(md);
            assert.strictEqual(result.ok, false, JSON.stringify(result));
            const reason = !result.ok ? result.reason : '';
            assert.ok(!reason.includes(ESC), `ESC byte leaked: ${JSON.stringify(reason)}`);
            assert.ok(/truncated/.test(reason), reason);
        });
    });

    // ── Finding 6 (independent-review follow-up on 16453e7): P3/P4/P5 ────────
    //
    // `verifyProgramSuite`'s own mismatch branch (`package.rules.ts:104-105`)
    // is a *separate* code path from `checkPackageStructure`'s check-graded
    // sinks above — reached only when an artifact declares `program:` and no
    // `checks:` (`isProgramSuite`) — and it was entirely unpinned: the C12
    // suite above never builds a `program`-suite artifact. `bad.actual` is
    // already `canonicalJson`-encoded by `out-channel.ts`'s `readOutChannel`
    // by the time it reaches `sanitizeChildOutput`, so — same reasoning as the
    // F1/F2 fixture in `exercise-verify.test.ts` — an ESC byte inside it would
    // already have been neutralized into safe escaped text upstream; RLO is
    // the one hostile byte that survives raw through `canonicalJson` and
    // actually exercises the sanitizer at this call site.

    suite('Finding 6: package.rules.ts verifyProgramSuite sinks (P3/P4/P5)', () => {

        test('a mismatched program-suite case sanitizes both the artifact expected and the program actual', async () => {
            const rlo = String.fromCharCode(0x202e);
            const hostileExpected = `EXPECTED-${rlo}hostile`;
            const hostileActual = `ACTUAL-${rlo}raw`;

            const md = [
                '---',
                'artifactType: leetcode',
                'leetcodeType: package',
                'title: Widget',
                'difficulty: medium',
                '---',
                '',
                'A program-suite exercise.',
                '',
                '```yaml leetcode',
                'program:',
                '  channel: argv',
                'params:',
                '  - name: a',
                '    type: string',
                '```',
                '',
                '## Files',
                '',
                '```javascript path=main.js role=editable',
                '// starter stub, overlaid by # Solutions below',
                '```',
                '',
                '## Tests',
                '```json',
                JSON.stringify([{ input: { a: 'x' }, expected: hostileExpected }]),
                '```',
                '',
                '# Solutions',
                '',
                '```javascript path=main.js',
                'require("node:fs").writeFileSync(',
                `  process.env.LEET_OUT, JSON.stringify("ACTUAL-" + String.fromCharCode(0x202e) + "raw"),`,
                ');',
                '```',
            ].join('\n');

            const result = await verifyExercise(md);
            assert.strictEqual(result.ok, false, JSON.stringify(result));
            const reason = !result.ok ? result.reason : '';
            assert.ok(!reason.includes(rlo), `RLO code point leaked: ${JSON.stringify(reason)}`);
            assert.strictEqual(
                reason,
                'package: case 0 failed: expected "EXPECTED-hostile", got "ACTUAL-raw"',
                JSON.stringify(reason),
            );
            // Sanity: the hostile fixture values themselves actually carried
            // the byte under test, so a vacuous fixture (nothing hostile to
            // strip) cannot masquerade as a passing pin.
            assert.ok(hostileExpected.includes(rlo) && hostileActual.includes(rlo));
        });
    });
});
