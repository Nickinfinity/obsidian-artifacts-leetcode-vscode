import * as assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Subprocess tests for `scripts/verify-exercise.mjs` — the CLI process
 * boundary, not the compiled helpers it imports. Two things can only be
 * proven by actually spawning the script: that a sink named by file/line in
 * the independent review of `16453e7` is genuinely wrapped in a sanitizer at
 * its *print* site (SEC-2, SEC-3), and that `--starter-red`'s INCONCLUSIVE
 * classification runs on raw, unsanitized failure text end to end through the
 * real CLI process — not just through `classifyStarterFailure` called
 * directly on a string, which `starter-red.helpers.test.ts` already covers
 * and which cannot see whether the CLI itself ever wires a sanitizer in ahead
 * of classification (Finding 5).
 *
 * Fixtures are written to a fresh `fs.mkdtemp` directory per test and deleted
 * on teardown — `CLAUDE.md` forbids a `.md` exercise artifact anywhere in
 * this repository, checked in or scratch.
 *
 * Hostile bytes are built at runtime via `String.fromCharCode`, never typed
 * as `\uXXXX` text, per the tool-pipeline hazard that silently decodes bare
 * 4-hex escapes into real control bytes.
 */
suite('verify-exercise CLI — process-boundary sinks', () => {

    const repoRoot = path.join(__dirname, '..', '..');
    const cli = path.join(repoRoot, 'scripts', 'verify-exercise.mjs');

    let tmpDir: string;

    setup(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-cli-'));
    });

    teardown(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    /** Write `content` into the run's temp dir and return its absolute path. */
    function write(name: string, content: string): string {
        const file = path.join(tmpDir, name);
        fs.writeFileSync(file, content, 'utf-8');
        return file;
    }

    /** Run the CLI with `args` and return its exit status plus merged output. */
    function run(...args: string[]): { status: number | null; out: string } {
        const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf-8' });
        return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
    }

    /** A `program`-suite `package` artifact whose one `## Files` entry is `candidateSource`. */
    function programSuiteMd(candidateSource: string): string {
        return [
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
            '  - name: n',
            '    type: int',
            '```',
            '',
            '## Files',
            '',
            '```javascript path=main.js role=editable',
            candidateSource,
            '```',
            '',
            '## Tests',
            '```json',
            '[{"input": {"n": 1}, "expected": 1}]',
            '```',
        ].join('\n');
    }

    /**
     * A `package` artifact with a single `call` check named `checkName`, over
     * a niladic `probe()` export whose body is `candidateSource`. The lone,
     * bare `## Tests` fence binds to it automatically (`bindCases`'s
     * single-check fallback) — no `check=` attribute needed, which matters
     * here since `checkName` itself carries the hostile bytes under test.
     */
    function callCheckMd(checkName: string, candidateSource: string): string {
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
            'checks:',
            `  - name: ${checkName}`,
            '    kind: call',
            '    file: src/probe.js',
            '    function: probe',
            '```',
            '',
            '## Tests',
            '',
            '```json',
            '[{"input": {}, "expected": 0}]',
            '```',
            '',
            '## Files',
            '',
            '```javascript path=src/probe.js role=editable',
            'export function probe() {',
            candidateSource,
            '}',
            '```',
        ].join('\n');
    }

    // ── SEC-1: the WARN print site's embedded-newline forgery (independent ───
    // review of 8d4f908, default sweep path, no flag needed) ─────────────────
    //
    // `sanitizeChildOutput` deliberately preserves `\n` and was the sanitizer
    // wrapping this exact line — the file's only print site with no
    // `firstLines` bound on top. An artifact whose warning text carries a
    // real embedded newline (here, `packages:`'s `badElement`,
    // `packages-parser.helpers.ts:257`, interpolating a JSON array element
    // verbatim) could split one WARN line into several, one of which reads
    // byte-identical to this CLI's own `OK   <path>` verdict at column 0 — a
    // sweep log could then show a forged pass for a name that never verified.
    //
    // The newline is injected via JSON-escape TEXT (`\n`, two ASCII
    // characters) inside the `start:` argv's JSON-array-literal element —
    // `safeJsonParse` decodes it into a real newline only once the artifact
    // is parsed. This test never types a raw control byte or a `\uXXXX`
    // escape into its own source, per the tool-pipeline hazard.

    test('SEC-1: an embedded newline in a packages: warning cannot forge a standalone verdict-shaped line', () => {
        const forged = 'OK   /vault/fake-passed.md';
        const badElementText = `\${X}\\n${forged}\\n`;

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
            'packages:',
            '  - name: api',
            '    dir: api',
            '    install: ["npm", "install"]',
            `    start: ["node", "server.js", "${badElementText}"]`,
            '```',
            '',
            '## Files',
            '',
            '```javascript path=api/server.js role=editable',
            '// stub',
            '```',
        ].join('\n');

        const { out } = run(write('sec1.md', md));
        const lines = out.split('\n');

        assert.ok(
            !lines.includes(forged),
            `newline forged a standalone verdict-shaped line: ${JSON.stringify(out)}`,
        );
        assert.ok(out.includes('WARN'), out);
        assert.ok(out.includes('uses a substitution other than'), out);
        // Sanity: the raw (pre-parse) fixture text really carries the
        // newline-delimited forged line — otherwise this pin would pass
        // vacuously regardless of whether the sanitizer stripped anything.
        assert.ok(badElementText.includes(`\\n${forged}\\n`));
    });

    // ── Finding 4: the MISMATCH line's cap must not swallow `recomputed=` ────
    //
    // The pre-fix `sanitizeUntrustedText` (200-char cap) truncated this
    // composed, three-value line away before `recomputed=` ever appeared —
    // measured on an ordinary 45-element int array. `sanitizeChildOutput`'s
    // 4000-char cap is what `--expecteds` actually needs.

    test('Finding 4: the MISMATCH line prints the recomputed value even for a wide array', () => {
        const wideArray = Array.from({ length: 45 }, (_, i) => i * 7);
        const md = [
            '---',
            'type: leetcode',
            'title: Widget',
            'difficulty: easy',
            '---',
            '',
            'Desc.',
            '',
            '```yaml leetcode',
            'function: identity',
            'params:',
            '  - name: a',
            '    type: string',
            'returns: string',
            '```',
            '',
            '## Tests',
            '```json',
            '[{"input": {"a": "x"}, "expected": "unused"}]',
            '```',
        ].join('\n');
        const mdPath = write('wide-mismatch.md', md);
        const expectedsPath = write('recomputed.json', JSON.stringify([wideArray]));

        const { status, out } = run(mdPath, '--expecteds', expectedsPath);

        assert.strictEqual(status, 1, out);
        assert.ok(out.includes('MISMATCH'), out);
        assert.ok(
            out.includes(`recomputed=${JSON.stringify(wideArray)}`),
            `recomputed= value was truncated away: ${JSON.stringify(out)}`,
        );
    });

    // ── Finding 2: --starter-red's check-path INCONCLUSIVE classification ────
    // must read the RAW detail, past the 4000-char display cap (site B) ──────
    //
    // `8d4f908` claimed the M1 mutation (splicing a sanitizer in ahead of
    // `allInfrastructure`/`infrastructureCount`) fails "at both classifier
    // sites." Measured: mutating site B alone
    // (`const details = red.map(o => o.detail);`) left the suite green —
    // nothing drove the CHECK path (only the PROGRAM path, site A, had a
    // fixture). A `call` check's thrown-error `detail` carries no cap of its
    // own before this line, so the same padding shape as the existing
    // program-path pin works here.

    test('Finding 2: a check-path infrastructure marker beyond the 4000-char display cap still yields INCONCLUSIVE (exit 3)', function () {
        this.timeout(30_000);

        const padding = 'x'.repeat(4500);
        const candidate = `throw new Error(${JSON.stringify(`${padding}\nCannot find module 'jsdom'`)});`;

        const { status, out } = run('--starter-red', write('check-infra.md', callCheckMd('probe', candidate)));

        assert.ok(out.length > 4000, `fixture must actually push a raw detail past the display cap: ${out.length} chars`);
        assert.strictEqual(status, 3, out);
        assert.ok(out.includes('INCONCLUSIVE'), out);
    });

    // ── Finding 3 (S03/S04): the --starter-red program-path print sites ──────
    // (`:270` INCONCLUSIVE detail, `:278` RED case detail) ────────────────────
    //
    // "Five of six sites now have fixtures" undercounted: these two, plus
    // S05-S08 below, were never swept at all. Both program-path fixtures
    // crash before touching `$LEET_OUT`, matching the shape the existing
    // Finding-5 pin already exercises for length — these instead carry ESC
    // and RLO, which reach `outcome.message`/`r.error` raw (a crashed child's
    // own stderr, never `canonicalJson`-encoded), so the probe is not vacuous.

    test('S03: an INCONCLUSIVE program-path case detail is sanitized', () => {
        const esc = String.fromCharCode(0x1b);
        const rlo = String.fromCharCode(0x202e);
        const candidate = [
            `process.stderr.write(${JSON.stringify(`${esc}Cannot find module 'jsdom'${rlo}`)});`,
            'process.exit(1);',
        ].join('\n');

        const { status, out } = run('--starter-red', write('s03.md', programSuiteMd(candidate)));

        assert.ok(!out.includes(esc), `ESC byte leaked: ${JSON.stringify(out)}`);
        assert.ok(!out.includes(rlo), `RLO code point leaked: ${JSON.stringify(out)}`);
        assert.strictEqual(status, 3, out);
        assert.ok(out.includes('INCONCLUSIVE') && out.includes("Cannot find module 'jsdom'"), out);
    });

    test('S04: a RED program-path case detail is sanitized', () => {
        const esc = String.fromCharCode(0x1b);
        const rlo = String.fromCharCode(0x202e);
        const candidate = [
            `process.stderr.write(${JSON.stringify(`${esc}assertion mismatch: expected 3, got 0${rlo}`)});`,
            'process.exit(1);',
        ].join('\n');

        const { status, out } = run('--starter-red', write('s04.md', programSuiteMd(candidate)));

        assert.ok(!out.includes(esc), `ESC byte leaked: ${JSON.stringify(out)}`);
        assert.ok(!out.includes(rlo), `RLO code point leaked: ${JSON.stringify(out)}`);
        assert.strictEqual(status, 0, out);
        assert.ok(out.includes('RED') && out.includes('assertion mismatch'), out);
    });

    // ── Finding 3 (S05-S08): the --starter-red check-path print sites ────────
    // (`:310` INCONCLUSIVE name/detail, `:318` RED name/detail) ──────────────
    //
    // Each fixture carries hostile bytes in BOTH the declared check `name`
    // (sanitized with `sanitizeUntrustedText`) and the thrown-error `detail`
    // (sanitized with `sanitizeChildOutput`) so that removing either call
    // independently fails a distinct assertion below. Neither value is
    // `canonicalJson`-encoded on this path (a thrown error's `.message`, and
    // the artifact-declared `name`, both reach the print site raw), so ESC is
    // not a vacuous probe here.

    test('S05/S06: an INCONCLUSIVE check-path name and detail are both sanitized', () => {
        const esc = String.fromCharCode(0x1b);
        const rlo = String.fromCharCode(0x202e);
        const hostileName = `${esc}[31mprobe${rlo}`;
        const candidate = `throw new Error(${JSON.stringify(`${esc}Cannot find module 'jsdom'${rlo}`)});`;

        const { status, out } = run('--starter-red', write('s05.md', callCheckMd(hostileName, candidate)));

        assert.ok(!out.includes(esc), `ESC byte leaked: ${JSON.stringify(out)}`);
        assert.ok(!out.includes(rlo), `RLO code point leaked: ${JSON.stringify(out)}`);
        assert.strictEqual(status, 3, out);
        assert.ok(out.includes('INCONCLUSIVE'), out);
        assert.ok(out.includes('[31mprobe:'), `check name not sanitized in place: ${JSON.stringify(out)}`);
        assert.ok(out.includes("Cannot find module 'jsdom'"), `check detail not sanitized in place: ${JSON.stringify(out)}`);
    });

    test('S07/S08: a RED check-path name and detail are both sanitized', () => {
        const esc = String.fromCharCode(0x1b);
        const rlo = String.fromCharCode(0x202e);
        const hostileName = `${esc}[31mprobe${rlo}`;
        const candidate = `throw new Error(${JSON.stringify(`${esc}assertion mismatch: expected 3, got 0${rlo}`)});`;

        const { status, out } = run('--starter-red', write('s07.md', callCheckMd(hostileName, candidate)));

        assert.ok(!out.includes(esc), `ESC byte leaked: ${JSON.stringify(out)}`);
        assert.ok(!out.includes(rlo), `RLO code point leaked: ${JSON.stringify(out)}`);
        assert.strictEqual(status, 0, out);
        assert.ok(out.includes('RED'), out);
        assert.ok(out.includes('[31mprobe:'), `check name not sanitized in place: ${JSON.stringify(out)}`);
        assert.ok(out.includes('assertion mismatch'), `check detail not sanitized in place: ${JSON.stringify(out)}`);
    });

    // ── SEC-2: the parse-warning print site (default sweep path, no flag) ────

    test('SEC-2: a hostile check name in a dropped-check warning is sanitized at the WARN print site', () => {
        const esc = String.fromCharCode(0x1b);
        const rlo = String.fromCharCode(0x202e);
        const hostileName = `${esc}[31mWARNHOSTILE${rlo}`;

        // An `http` check with no `package:` is dropped at parse time with a
        // warning naming it — `project-parser.helpers.ts`'s exact reproduction
        // from the independent review (line 499).
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
            '    kind: http',
            '```',
            '',
            '## Files',
            '',
            '```javascript path=index.js role=editable',
            'module.exports = {};',
            '```',
        ].join('\n');

        const { out } = run(write('warn.md', md));

        assert.ok(!out.includes(esc), `ESC byte leaked into CLI output: ${JSON.stringify(out)}`);
        assert.ok(!out.includes(rlo), `RLO code point leaked into CLI output: ${JSON.stringify(out)}`);
        assert.ok(
            out.includes("WARN") && out.includes("needs a package — dropped"),
            `expected the sanitized WARN line, got: ${JSON.stringify(out)}`,
        );
        assert.ok(
            out.includes("checks: http check '[31mWARNHOSTILE' needs a package — dropped"),
            `expected the exact sanitized warning text, got: ${JSON.stringify(out)}`,
        );
    });

    // ── SEC-3: the --expecteds MISMATCH print site — bidi survives JSON.stringify ──

    test('SEC-3: a hostile bidi code point inside a mismatched expected value is sanitized in the MISMATCH line', () => {
        const rlo = String.fromCharCode(0x202e);

        const md = [
            '---',
            'type: leetcode',
            'title: Widget',
            'difficulty: easy',
            '---',
            '',
            'Desc.',
            '',
            '```yaml leetcode',
            'function: identity',
            'params:',
            '  - name: a',
            '    type: string',
            'returns: string',
            '```',
            '',
            '## Tests',
            '```json',
            `[{"input": {"a": "x"}, "expected": "${rlo}hostile"}]`,
            '```',
        ].join('\n');
        const mdPath = write('mismatch.md', md);
        // JSON.stringify escapes the ASCII control range (an ESC byte comes
        // through backslash-escaped) but passes a bidi-control code point
        // like RLO through raw -- the residual sink a C0/C1-only regex at
        // this print site never covered.
        const expectedsPath = write('recomputed.json', JSON.stringify(['different']));

        const { status, out } = run(mdPath, '--expecteds', expectedsPath);

        assert.strictEqual(status, 1, out);
        assert.ok(!out.includes(rlo), `RLO code point leaked into MISMATCH line: ${JSON.stringify(out)}`);
        assert.ok(out.includes('MISMATCH'), out);
        assert.ok(
            out.includes('[0] input={"a":"x"} artifact="hostile" recomputed="different"'),
            `expected the sanitized MISMATCH detail line, got: ${JSON.stringify(out)}`,
        );
    });

    // ── Finding 5: the --starter-red classifier must see raw failure text ────
    //
    // The commit message on 16453e7 claims "a test pins that the classifier
    // still sees raw text" — it does not: `starter-red.helpers.test.ts`
    // exercises `classifyStarterFailure`/`allInfrastructure` directly on
    // strings, never through this CLI. If a display sanitizer were ever
    // spliced in ahead of classification (mutant M1: moving `sanitizeChildOutput`
    // to before `allInfrastructure`/`infrastructureCount` at either of the two
    // call sites in `scripts/verify-exercise.mjs`), a failure detail whose
    // infrastructure marker sits beyond the 4000-char display cap would be
    // truncated before classification ever sees it — flipping a broken
    // toolchain (INCONCLUSIVE, exit 3) into a false RED (exit 0) that
    // certifies the artifact as shipping unsolved when nothing actually ran.
    //
    // This drives a real `program`-suite artifact whose starter writes over
    // 4000 characters of stderr padding before an infrastructure marker
    // (`Cannot find module 'jsdom'`) and exits non-zero, never touching
    // `$LEET_OUT` — the exact one-case-suite shape `program.runner.ts`'s
    // `spawn()` produces for a real, uncapped child stderr.

    test('Finding 5: an infrastructure marker beyond the 4000-char display cap still yields INCONCLUSIVE (exit 3)', function () {
        this.timeout(30_000);

        const padding = 'x'.repeat(4500);
        // The starter itself writes the hostile, over-cap stderr and exits
        // non-zero without ever touching `$LEET_OUT` — `program.runner.ts`'s
        // `spawn()` hands this back as the case's `error` verbatim, uncapped
        // (`out-channel.ts`'s `MAX_LEET_OUT_BYTES` bounds the graded *answer*
        // file, never a crashed program's own stderr).
        const candidate = [
            `process.stderr.write(${JSON.stringify(`${padding}\nCannot find module 'jsdom'`)});`,
            'process.exit(1);',
        ].join('\n');

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
            '  - name: n',
            '    type: int',
            '```',
            '',
            '## Files',
            '',
            '```javascript path=main.js role=editable',
            candidate,
            '```',
            '',
            '## Tests',
            '```json',
            '[{"input": {"n": 1}, "expected": 1}]',
            '```',
        ].join('\n');

        const { status, out } = run('--starter-red', write('program-infra.md', md));

        assert.ok(out.length > 4000, `fixture must actually push a raw detail past the display cap: ${out.length} chars`);
        assert.strictEqual(status, 3, out);
        assert.ok(out.includes('INCONCLUSIVE'), out);
    });

    // ── Residual: the default-mode FAIL line has no line-count bound ─────────
    //
    // `sanitizeChildOutput` deliberately preserves `\n` (a `build` check's
    // stderr is multi-line by nature), and every `--starter-red` print site
    // bounds line count on top of that with `firstLines(…, 3)` — but the plain
    // `die(\`FAIL ${result.reason}\`)` at the bottom of this file (the default,
    // no-flag harness-verify mode every vault-sweep artifact goes through) had
    // no such bound: up to `MAX_CHILD_OUTPUT_LEN` (4000) characters of
    // newline-separated text from a check's own stderr could inject
    // arbitrary-looking lines into a sweep's terminal log — including lines
    // shaped exactly like this CLI's own `OK   <path>` verdict. The line count
    // is bounded at this print site too, the same 3-line convention as every
    // other print site in this file.

    test('the default-mode FAIL line bounds an artifact-injected multi-line detail to a few lines', () => {
        const injectedLines = Array.from({ length: 12 }, (_, i) => `OK   /fake/injected-${i}.md`).join('\n');
        const childScript = 'process.stderr.write(process.argv[1]); process.exit(1);';
        const argv = JSON.stringify([process.execPath, '-e', childScript, injectedLines]);

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
            '  - name: probe',
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

        const { status, out } = run(write('injected-fail.md', md));

        assert.strictEqual(status, 1, out);
        assert.ok(out.includes('FAIL'), out);
        // The injected lines must not all survive verbatim — a sweep log must
        // never carry a fabricated `OK   /fake/injected-11.md` line an operator
        // could mistake for this CLI's own verdict on a real file.
        assert.ok(!out.includes('injected-11.md'), `unbounded FAIL line leaked every injected line: ${JSON.stringify(out)}`);
        assert.ok(/more line\(s\) suppressed/.test(out), out);
    });
});
