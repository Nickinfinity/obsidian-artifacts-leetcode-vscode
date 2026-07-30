import * as assert from 'node:assert';
import {
	extractConfigBlocks,
	legacyFrontmatterKeys,
	splitFrontmatter,
} from '../src/services/leetcode-config-blocks.helpers.js';

/**
 * Unit tests for the v2 config-fence grammar (`ARTIFACT_LEETCODE_FILE_FORMAT.md`
 * §2.5): the ` ```yaml leetcode ` extractor, the D2 body-set-key detector, and
 * the frontmatter/body split they share with the parser.
 */
suite('extractConfigBlocks', () => {

	test('extracts a single fence body', () => {
		assert.strictEqual(extractConfigBlocks('```yaml leetcode\nreturns: int\n```').raw, 'returns: int');
	});

	// ── Marker precision ────────────────────────────────────────────────────

	test('a bare ```yaml fence (no leetcode token) is excluded', () => {
		const result = extractConfigBlocks('```yaml\nreturns: int\n```');
		assert.strictEqual(result.raw, '');
		assert.deepStrictEqual(result.spans, []);
	});

	test('```yaml leetcode path=src/x.yml is a Files entry, not config, and is excluded', () => {
		const result = extractConfigBlocks('```yaml leetcode path=src/x.yml\nreturns: int\n```');
		assert.strictEqual(result.raw, '');
		assert.deepStrictEqual(result.spans, []);
	});

	// ── Malformed input degrades, never throws or half-parses ──────────────

	test('an unterminated fence yields no partial block and exactly one warning', () => {
		const result = extractConfigBlocks('```yaml leetcode\nreturns: int');
		assert.strictEqual(result.raw, '');
		assert.deepStrictEqual(result.spans, []);
		assert.strictEqual(result.warnings.length, 1);
		assert.match(result.warnings[0], /unterminated/);
	});

	test('a closing fence with trailing whitespace still yields its block', () => {
		const result = extractConfigBlocks('```yaml leetcode\nreturns: int\n```  ');
		assert.strictEqual(result.raw, 'returns: int');
		assert.deepStrictEqual(result.warnings, []);
	});

	test('an unterminated non-config fence earlier in the document is warned, hiding config after it', () => {
		// ```python never closes; its own body swallows the "```yaml leetcode"
		// line that follows as its (any-``` toggle) closer, so no config is read
		// and `fenced` is still true when the document ends.
		const body = '```python\n```yaml leetcode\nreturns: int\n```';
		const result = extractConfigBlocks(body);
		assert.strictEqual(result.raw, '');
		assert.strictEqual(result.warnings.length, 1);
		assert.match(result.warnings[0], /unterminated/);
	});

	// ── Nesting / adjacency ──────────────────────────────────────────────────

	test('adjacent config fences do not bleed into one block', () => {
		const body = '```yaml leetcode\na: 1\n```\n```yaml leetcode\nb: 2\n```';
		const result = extractConfigBlocks(body);
		assert.strictEqual(result.raw, 'a: 1\nb: 2');
		assert.strictEqual(result.spans.length, 2);
	});

	test('a config-fence-shaped line inside an unrelated fence is not read as config', () => {
		// The inner "```yaml leetcode" line closes the outer ```python fence
		// (any ``` toggles, matching boundaryOutsideFence) rather than opening
		// a second, nested config block.
		const body = '```python\n```yaml leetcode\nfake: 1\n```\n```';
		const result = extractConfigBlocks(body);
		assert.strictEqual(result.raw, '');
	});

	// ── CRLF ──────────────────────────────────────────────────────────────

	test('CRLF input parses to the same raw content as LF, spans lengthened by the retained \\r bytes', () => {
		const lf = '```yaml leetcode\nreturns: int\n```';
		const crlf = '```yaml leetcode\r\nreturns: int\r\n```';
		const lfResult = extractConfigBlocks(lf);
		const crlfResult = extractConfigBlocks(crlf);
		assert.strictEqual(crlfResult.raw, lfResult.raw);
		// Two retained `\r`s (after the opening and content lines) push the span
		// two bytes past the LF span — expected, since `\r` is part of each
		// line's own text and the span covers the fence's real bytes.
		assert.strictEqual(lfResult.spans[0].end, 33);
		assert.strictEqual(crlfResult.spans[0].end, 35);
	});

	// ── D5: column-0 contract ────────────────────────────────────────────────

	test('a body line indented off column 0 is kept verbatim and warned', () => {
		const result = extractConfigBlocks('```yaml leetcode\n  returns: int\n```');
		assert.strictEqual(result.raw, '  returns: int');
		assert.strictEqual(result.warnings.length, 1);
		assert.match(result.warnings[0], /column 0/);
	});

	// ── D6: asymmetric duplicate-key precedence ─────────────────────────────

	test('a last-wins key duplicated across fences names the key and the winner', () => {
		const body = '```yaml leetcode\nreturns: int\n```\n```yaml leetcode\nreturns: string\n```';
		const result = extractConfigBlocks(body);
		assert.ok(result.warnings.some(w => w.includes("'returns'") && w.includes('last')));
	});

	test('a first-wins key duplicated across fences names the key and the winner', () => {
		const body = '```yaml leetcode\nlibs:\n  python:\n    - a\n```\n```yaml leetcode\nlibs:\n  python:\n    - b\n```';
		const result = extractConfigBlocks(body);
		assert.ok(result.warnings.some(w => w.includes("'libs'") && w.includes('first')));
	});

	test('SEC: a __proto__ key duplicated across fences produces no warning (no prototype-chain read)', () => {
		const body = '```yaml leetcode\n__proto__: 1\n```\n```yaml leetcode\n__proto__: 2\n```';
		const result = extractConfigBlocks(body);
		assert.ok(!result.warnings.some(w => w.includes('__proto__')));
	});

	// ── spans: offsets into the `body` argument, whole fence inclusive ──────

	test('spans cover the whole fence (delimiters included), offset into `body`', () => {
		const body = 'before\n```yaml leetcode\nreturns: int\n```\nafter';
		const result = extractConfigBlocks(body);
		assert.strictEqual(result.spans.length, 1);
		const { start, end } = result.spans[0];
		assert.strictEqual(body.slice(start, end), '```yaml leetcode\nreturns: int\n```');
	});

	// ── Performance: no catastrophic backtracking ───────────────────────────
	// A 1 MB line that never reaches a quantifier (e.g. rejected by
	// `CONFIG_MARKER_RE`'s literal prefix within the first ~20 chars) proves
	// nothing about backtracking. These put a 1 MB payload where a quantifier
	// actually runs across it: `TOP_LEVEL_KEY_RE`'s `\w+` inside a closed
	// fence body.
	//
	// The payload must NOT contain a `:` — that is the whole point, not an
	// oversight. Catastrophic backtracking only manifests on a **failed**
	// match: with a colon present `TOP_LEVEL_KEY_RE` succeeds on its first
	// attempt (`\w+` scans forward, the `:` is already there) and backtracks
	// zero times, so the test would stay green and fast even if someone
	// introduced a nested quantifier. Measured against `/^(\w+\s*)+:/` as a
	// stand-in for that regression: with a colon, flat 0 ms at any length;
	// without one, 19 ms at 20 chars, 284 ms at 24, 1147 ms at 26.

	test('a 1 MB top-level key line inside a closed fence completes in under 100ms', () => {
		const body = '```yaml leetcode\n' + 'a'.repeat(1_000_000) + '\n```';
		const started = Date.now();
		extractConfigBlocks(body);
		assert.ok(Date.now() - started < 100, 'extractConfigBlocks took too long on a 1 MB top-level key line');
	});

});

suite('legacyFrontmatterKeys', () => {

	test('returns [] for clean frontmatter', () => {
		assert.deepStrictEqual(legacyFrontmatterKeys('type: leetcode\ntitle: Two Sum\n'), []);
	});

	test('finds a body-set key left in frontmatter', () => {
		assert.deepStrictEqual(legacyFrontmatterKeys('title: X\nfunction: twoSum\n'), ['function']);
	});

	test('finds several body-set keys, in document order, deduplicated', () => {
		const fm = 'libs:\n  python:\n    - a\ntest:\n  type: function\nlibs:\n  rust:\n    - b\n';
		assert.deepStrictEqual(legacyFrontmatterKeys(fm), ['libs', 'test']);
	});

	test('ignores an indented line even if it names a body-set key', () => {
		assert.deepStrictEqual(legacyFrontmatterKeys('title: X\n  function: nested\n'), []);
	});

});

suite('splitFrontmatter', () => {

	test('splits a well-formed file', () => {
		assert.deepStrictEqual(
			splitFrontmatter('---\ntitle: X\n---\nBody text'),
			{ fmRaw: 'title: X', body: 'Body text' },
		);
	});

	test('treats the whole input as body when no frontmatter block opens it', () => {
		assert.deepStrictEqual(
			splitFrontmatter('No frontmatter here'),
			{ fmRaw: '', body: 'No frontmatter here' },
		);
	});

	test('CRLF frontmatter fences parse identically to LF', () => {
		assert.deepStrictEqual(
			splitFrontmatter('---\r\ntitle: X\r\n---\r\nBody'),
			{ fmRaw: 'title: X', body: 'Body' },
		);
	});

	// A 1 MB unterminated block forces `FRONTMATTER_RE`'s lazy `[\s\S]*?` to
	// scan to end of input looking for a closing `---` that never comes — the
	// one lazy quantifier in this module, and the case that actually stresses it.
	test('a 1 MB unterminated frontmatter block completes in under 100ms', () => {
		const started = Date.now();
		splitFrontmatter('---\n' + 'a'.repeat(1_000_000));
		assert.ok(Date.now() - started < 100, 'splitFrontmatter took too long on a 1 MB unterminated block');
	});

});
