import * as assert from 'node:assert';
import { verifyExercise } from '../src/services/exercise-verify.helpers.js';

/**
 * T7 — `verifyExercise` fails an artifact carrying D2 body-set config
 * (`function`, `params`, `libs`, …) left in frontmatter instead of a
 * ` ```yaml leetcode ` body fence.
 *
 * `parseLeetCode` already *ignores* such a key (D4's hard cut) rather than
 * reading it, so this suite is the third leg: proving the harness reports
 * `ok: false` and names the offender, instead of silently verifying a v1
 * artifact clean.
 */
suite('exercise-verify — legacy frontmatter config', () => {

    /** A v1 artifact: every execution-config key still in frontmatter, no body fence at all. */
    const V1_FIXTURE = [
        '---',
        'type: leetcode',
        'title: Sum',
        'difficulty: easy',
        'function: sum',
        'params:',
        '  - name: a',
        '    type: int',
        '  - name: b',
        '    type: int',
        'returns: int',
        'test:',
        '  type: function',
        '---',
        '',
        'Problem description.',
        '',
        '## Examples',
        '```example',
        'input: a = 1, b = 2',
        'output: 3',
        '```',
        '',
        '## Tests',
        '```json',
        '[]',
        '```',
    ].join('\n');

    // ── Spec's own test-first assertion ───────────────────────────────────

    test('a v1 artifact (config still in frontmatter) fails', async () => {
        assert.strictEqual((await verifyExercise(V1_FIXTURE)).ok, false);
    });

    test('the message names the offending key and the fence it belongs in', async () => {
        const result = await verifyExercise(V1_FIXTURE);
        assert.strictEqual(result.ok, false);
        assert.ok(!result.ok && result.reason.includes("'function:'"), JSON.stringify(result));
        assert.ok(!result.ok && result.reason.includes('yaml leetcode'), JSON.stringify(result));
    });

    test('every offending key is named, not just the first', async () => {
        const result = await verifyExercise(V1_FIXTURE);
        assert.strictEqual(result.ok, false);
        assert.ok(!result.ok, JSON.stringify(result));
        if (!result.ok) {
            assert.ok(result.reason.includes("'function:'"), result.reason);
            assert.ok(result.reason.includes("'params:'"), result.reason);
            assert.ok(result.reason.includes("'returns:'"), result.reason);
            assert.ok(result.reason.includes("'test:'"), result.reason);
        }
    });

    // ── A clean v2 artifact must be unaffected ────────────────────────────

    interface CaseFixture { input: Record<string, unknown>; expected: unknown }

    const TESTS: CaseFixture[] = [
        { input: { a: 1, b: 2 }, expected: 3 },
        { input: { a: 5, b: 7 }, expected: 12 },
        { input: { a: 0, b: 0 }, expected: 0 },
        { input: { a: -1, b: 1 }, expected: 0 },
        { input: { a: 10, b: 20 }, expected: 30 },
        { input: { a: 100, b: 200 }, expected: 300 },
    ];
    const FINAL_TESTS: CaseFixture[] = [
        { input: { a: 2, b: 2 }, expected: 4 },
        { input: { a: 3, b: 3 }, expected: 6 },
        { input: { a: 4, b: 4 }, expected: 8 },
    ];

    /** A conforming v2 artifact: all execution config in a body fence, nothing legacy in frontmatter. */
    function buildCleanV2Md(opts: { extraFrontmatter?: string; solutionExtra?: string } = {}): string {
        const { extraFrontmatter = '', solutionExtra = '' } = opts;

        const frontmatter = [
            '---',
            'artifactType: leetcode',
            'title: Sum',
            'difficulty: easy',
            extraFrontmatter,
            '---',
        ].filter(l => l !== '').join('\n');

        const configFence = '```yaml leetcode\n'
            + 'function: sum\n'
            + 'params:\n'
            + '  - name: a\n    type: int\n'
            + '  - name: b\n    type: int\n'
            + 'returns: int\n'
            + 'test:\n'
            + '  type: function\n'
            + '```';

        const examplesBlock = [
            '```example\ninput: a = 1, b = 2\noutput: 3\n```',
            '```example\ninput: a = 5, b = 7\noutput: 12\n```',
        ].join('\n\n');

        const solutionCode = `function sum(a, b) {\n  ${solutionExtra}\n  return a + b;\n}`;

        return `${frontmatter}\n\nProblem description.\n\n${configFence}\n\n## Examples\n${examplesBlock}\n\n`
            + `## Tests\n\`\`\`json\n${JSON.stringify(TESTS, null, 2)}\n\`\`\`\n\n`
            + `## Final Tests\n\`\`\`json\n${JSON.stringify(FINAL_TESTS, null, 2)}\n\`\`\`\n\n`
            + `# Setup\n\n## JavaScript\n\`\`\`javascript\nfunction sum(a, b) {\n  // solution here\n}\n\`\`\`\n\n`
            + `# Solutions\n\n## JavaScript\n\`\`\`javascript\n${solutionCode}\n\`\`\`\n`;
    }

    test('a clean v2 artifact (config only in a body fence) verifies ok', async () => {
        const result = await verifyExercise(buildCleanV2Md());
        assert.strictEqual(result.ok, true, JSON.stringify(result));
    });

    // ── SEC: hostile inputs ────────────────────────────────────────────────

    // A body-set key appearing ONLY inside the config fence is the correct v2
    // form — the check must not treat the fence body itself as frontmatter.
    test('SEC: body-set keys present only in the config fence do not fail', async () => {
        const result = await verifyExercise(buildCleanV2Md());
        assert.strictEqual(result.ok, true, JSON.stringify(result));
    });

    // A line that merely LOOKS like a frontmatter key (`params:`) sitting inside
    // a `# Solutions` code fence is body content, never frontmatter — the check
    // reads only the `---`-delimited block via `splitFrontmatter`, so this must
    // not misfire.
    test('SEC: a key-shaped comment inside a # Solutions code fence is not mistaken for frontmatter', async () => {
        const result = await verifyExercise(buildCleanV2Md({ solutionExtra: '// params: not frontmatter' }));
        assert.strictEqual(result.ok, true, JSON.stringify(result));
    });

    // No frontmatter block at all: `splitFrontmatter` returns `fmRaw: ''`, so
    // `legacyFrontmatterKeys` finds nothing — the check must degrade quietly
    // rather than crash, leaving any failure to a later rule (missing title).
    test('SEC: an artifact with no frontmatter at all does not crash and reports no legacy failure', async () => {
        const noFrontmatter = 'Just a body, no --- frontmatter block, no config fence.';
        const result = await verifyExercise(noFrontmatter);
        assert.strictEqual(result.ok, false);
        assert.ok(!result.ok && !result.reason.startsWith('legacy:'), JSON.stringify(result));
    });

    // CRLF frontmatter must be scanned exactly like LF — `legacyFrontmatterKeys`
    // already handles `\r?\n`, this pins that the verifier-level check inherits it.
    test('SEC: a CRLF frontmatter block carrying a legacy key still fails', async () => {
        const crlf = V1_FIXTURE.replace(/\n/g, '\r\n');
        const result = await verifyExercise(crlf);
        assert.strictEqual(result.ok, false);
        assert.ok(!result.ok && result.reason.includes("'function:'"), JSON.stringify(result));
    });

    // `paramsX:` merely starts with a body-set name — `TOP_LEVEL_KEY_RE` captures
    // the whole `\w+` token, so it must NOT be mistaken for `params`.
    test('SEC: a frontmatter key that only starts with a body-set name does not fail', async () => {
        const result = await verifyExercise(buildCleanV2Md({ extraFrontmatter: 'paramsX: unrelated' }));
        assert.strictEqual(result.ok, true, JSON.stringify(result));
    });

    // ── path prefixing still applies to this rule ─────────────────────────

    test('a supplied path is prefixed onto the legacy-key failure reason', async () => {
        const result = await verifyExercise(V1_FIXTURE, 'Strings/Bad.md');
        assert.strictEqual(result.ok, false);
        assert.ok(!result.ok && result.reason.startsWith('Strings/Bad.md: '), JSON.stringify(result));
    });

    // ── Rule 1: legacy `type:` discriminator (D11's hard cut — VSX-122 T1.11) ──

    /** A conforming v2 artifact, but still on the pre-D11 `type:` spelling — no `artifactType:` anywhere. */
    function buildLegacyTypeMd(): string {
        return buildCleanV2Md().replace('artifactType: leetcode', 'type: leetcode');
    }

    test('a bare type: leetcode with no artifactType: fails', async () => {
        const result = await verifyExercise(buildLegacyTypeMd());
        assert.strictEqual(result.ok, false);
    });

    test('the message names the rename', async () => {
        const result = await verifyExercise(buildLegacyTypeMd());
        assert.strictEqual(result.ok, false);
        if (!result.ok) {
            assert.ok(result.reason.startsWith('legacy:'), result.reason);
            assert.ok(result.reason.includes('artifactType'), result.reason);
        }
    });

    // ── SEC: hostile inputs for the type:/artifactType: axis ───────────────

    test('SEC: a __proto__ key does not crash and does not suppress the legacy-type failure', async () => {
        const md = buildLegacyTypeMd().replace('type: leetcode', 'type: leetcode\n__proto__: leetcode');
        const result = await verifyExercise(md);
        assert.strictEqual(result.ok, false);
        if (!result.ok) { assert.ok(result.reason.includes('artifactType'), result.reason); }
    });

    test('SEC: a pathologically long key/value in frontmatter does not hang', async () => {
        const longLine = `${'a'.repeat(50_000)}: ${'b'.repeat(50_000)}`;
        const md = buildLegacyTypeMd().replace('type: leetcode', `type: leetcode\n${longLine}`);
        const start = Date.now();
        const result = await verifyExercise(md);
        assert.ok(Date.now() - start < 1000, 'must not hang on a pathologically long frontmatter line');
        assert.strictEqual(result.ok, false);
    });

    test('SEC: declaring both type: and artifactType: does not fail — artifactType already wins', async () => {
        const md = buildCleanV2Md().replace('artifactType: leetcode', 'artifactType: leetcode\ntype: leetcode');
        const result = await verifyExercise(md);
        assert.strictEqual(result.ok, true, JSON.stringify(result));
    });

    test('a type: value that is not leetcode, with no artifactType:, fails Rule 3, not Rule 1', async () => {
        // Rule 1 (checkLegacyType) still has nothing to say here — `type:`
        // never equals `leetcode`, so it never fires. Rule 3 (T1.15) is what
        // now fails this artifact, for the separate reason that no
        // `artifactType: leetcode` is declared at all.
        const md = buildCleanV2Md().replace('artifactType: leetcode', 'type: notes');
        const result = await verifyExercise(md);
        assert.strictEqual(result.ok, false, JSON.stringify(result));
        if (!result.ok) {
            assert.ok(!result.reason.startsWith('legacy:'), result.reason);
            assert.ok(result.reason.includes('artifactType'), result.reason);
        }
    });

    // ── Rule 2: canonical frontmatter key order (T1.10's `orderViolation`, wired in) ──

    test('a frontmatter key out of canonical order fails, naming the violation', async () => {
        // `title` moved ahead of `artifactType` — canonical order puts artifactType first.
        const md = buildCleanV2Md().replace('artifactType: leetcode\ntitle: Sum', 'title: Sum\nartifactType: leetcode');
        const result = await verifyExercise(md);
        assert.strictEqual(result.ok, false);
        if (!result.ok) {
            assert.ok(result.reason.includes('must come before'), result.reason);
            assert.ok(result.reason.includes('artifactType'), result.reason);
        }
    });

    // ── Rule 3: the discriminator's presence and value (T1.15) ─────────────

    // Spec's own test-first assertion #1: neither key present at all.
    test('an artifact declaring neither type: nor artifactType: fails by name', async () => {
        const md = buildCleanV2Md().replace('artifactType: leetcode\n', '');
        const result = await verifyExercise(md);
        assert.strictEqual(result.ok, false, JSON.stringify(result));
        if (!result.ok) {
            assert.ok(result.reason.startsWith('discriminator:'), result.reason);
            assert.ok(result.reason.includes('required'), result.reason);
        }
    });

    // Spec's own test-first assertion #2: present but wrong value.
    test('artifactType: recipe fails naming the expected value', async () => {
        const md = buildCleanV2Md().replace('artifactType: leetcode', 'artifactType: recipe');
        const result = await verifyExercise(md);
        assert.strictEqual(result.ok, false, JSON.stringify(result));
        if (!result.ok) {
            assert.ok(result.reason.includes("'recipe'"), result.reason);
            assert.ok(result.reason.includes("'leetcode'"), result.reason);
        }
    });

    // ── SEC: hostile inputs for the discriminator's presence/value rule ────

    test('SEC: artifactType: with an empty value fails naming the expected value', async () => {
        const md = buildCleanV2Md().replace('artifactType: leetcode', 'artifactType:');
        const result = await verifyExercise(md);
        assert.strictEqual(result.ok, false, JSON.stringify(result));
        if (!result.ok) { assert.ok(result.reason.includes("expected 'leetcode'"), result.reason); }
    });

    // `splitFrontmatter` must make this a non-issue: an `artifactType: leetcode`
    // line at column 0 inside a fenced code block in the BODY is body content,
    // never frontmatter, so it must not satisfy the rule. Column 0 matters —
    // the check's own regex only matches a key at the start of a line, so this
    // fixture must put the line there too, or a scan-the-whole-document
    // mutation would not be caught by this test.
    test('SEC: artifactType: leetcode inside a body fence does not satisfy the rule', async () => {
        const withoutRealDiscriminator = buildCleanV2Md().replace('artifactType: leetcode\ntitle: Sum', 'title: Sum');
        const md = withoutRealDiscriminator.replace(
            'Problem description.',
            'Problem description.\n\n```\nartifactType: leetcode\n```',
        );
        const result = await verifyExercise(md);
        assert.strictEqual(result.ok, false, JSON.stringify(result));
        if (!result.ok) {
            assert.ok(result.reason.startsWith('discriminator:'), result.reason);
            assert.ok(result.reason.includes('required'), result.reason);
        }
    });

    // Both keys disagreeing: `artifactType` is what every reader trusts, so
    // its (wrong) value is what fails — not the fact that `type:` disagrees.
    test('SEC: type: leetcode and artifactType: recipe disagree — Rule 3 fails on the recipe value', async () => {
        const md = buildCleanV2Md().replace('artifactType: leetcode', 'artifactType: recipe\ntype: leetcode');
        const result = await verifyExercise(md);
        assert.strictEqual(result.ok, false, JSON.stringify(result));
        if (!result.ok) {
            assert.ok(result.reason.includes("'recipe'"), result.reason);
            assert.ok(result.reason.includes("'leetcode'"), result.reason);
        }
    });

    // ── SEC: Rule 3 echoes the raw artifactType value — it must be sanitized ──
    //
    // `checkArtifactType` interpolates the frontmatter scalar straight into
    // its reason string. That reason reaches CLI stdout today and is the
    // documented precedent for a future webview sink, so an artifact must
    // not be able to smuggle ANSI/control bytes or an unbounded length into
    // it (VSX-122 condition C12). Hostile bytes are built with
    // `String.fromCharCode` rather than typed as literal control characters,
    // so the offending byte is explicit and reviewable in the diff.

    const ESC = String.fromCharCode(0x1b);
    const BEL = String.fromCharCode(0x07);
    const BACKSPACE = String.fromCharCode(0x08);

    test('SEC: an ANSI escape sequence in artifactType is stripped from the reason', async () => {
        const hostile = `${ESC}[31mFAKE PASS${ESC}[0m`;
        const md = buildCleanV2Md().replace('artifactType: leetcode', `artifactType: ${hostile}`);
        const result = await verifyExercise(md);
        assert.strictEqual(result.ok, false, JSON.stringify(result));
        if (!result.ok) {
            assert.ok(!result.reason.includes(ESC), JSON.stringify(result.reason));
            assert.ok(result.reason.startsWith('discriminator:'), result.reason);
        }
    });

    test('SEC: a C0 control byte in artifactType is stripped from the reason', async () => {
        const hostile = `evil${BEL}bell${BACKSPACE}backspace`;
        const md = buildCleanV2Md().replace('artifactType: leetcode', `artifactType: ${hostile}`);
        const result = await verifyExercise(md);
        assert.strictEqual(result.ok, false, JSON.stringify(result));
        if (!result.ok) {
            assert.ok(!result.reason.includes(BEL), JSON.stringify(result.reason));
            assert.ok(!result.reason.includes(BACKSPACE), JSON.stringify(result.reason));
            assert.ok(result.reason.includes('evilbellbackspace'), result.reason);
        }
    });

    test('SEC: an over-long artifactType value is truncated in the reason, visibly', async () => {
        const hostile = 'x'.repeat(2000);
        const md = buildCleanV2Md().replace('artifactType: leetcode', `artifactType: ${hostile}`);
        const start = Date.now();
        const result = await verifyExercise(md);
        assert.ok(Date.now() - start < 1000, 'must not hang sanitizing a long value');
        assert.strictEqual(result.ok, false, JSON.stringify(result));
        if (!result.ok) {
            assert.ok(!result.reason.includes(hostile), 'full 2000-char value must not reach the reason');
            assert.ok(result.reason.length < 500, `reason must be bounded, was ${result.reason.length} chars`);
            assert.ok(/truncat/i.test(result.reason), `truncation must be visible: ${result.reason}`);
        }
    });

});
