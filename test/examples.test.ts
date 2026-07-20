import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseLeetCode } from '../src/services/leetcode-parser.service.js';
import { TEST_TYPES } from '../src/types/constants.js';
import type { ParsedLeetCode } from '../src/types/leetcode.types.js';

/**
 * Guards `examples/leetcode/**\/*.md` — the shipped, human-facing example
 * artifacts a vault owner copies into their own `LeetCode/` folder for the
 * F5 manual pass. This is **not** a `test/fixtures/` directory this test
 * owns; CLAUDE.md's "fixtures inline, no test/fixtures/" rule is about
 * fixtures a test defines and controls itself. This test *reads* a real
 * deliverable that ships in the repo — deploying it into a vault is a
 * separate, human step this test does not perform.
 *
 * Walks the tree recursively so a new example dropped anywhere under
 * `examples/leetcode/` is guarded automatically, with no per-file
 * registration here.
 */

const EXAMPLES_ROOT = path.join(__dirname, '..', '..', 'examples', 'leetcode');
const KNOWN_TEST_TYPES = new Set(TEST_TYPES.map(t => t.id));

/**
 * Recursively collects every parseable `.md` artifact under `dir`,
 * depth-first — `README.md` is taxonomy documentation, not an artifact, so
 * it is excluded rather than fed to the leetcode parser.
 *
 * @param dir - Directory to walk; missing directories yield `[]`.
 * @returns Absolute paths of every example artifact found.
 *
 * @example
 * collectMarkdownFiles('/repo/examples/leetcode'); // → ['/repo/examples/leetcode/function/arrays/two-sum.md', …]
 */
function collectMarkdownFiles(dir: string): string[] {
	if (!fs.existsSync(dir)) { return []; }
	const out: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) { out.push(...collectMarkdownFiles(full)); }
		else if (entry.name.endsWith('.md') && entry.name !== 'README.md') { out.push(full); }
	}
	return out;
}

/**
 * Structural defects a shipped example must never carry — the parser itself
 * never throws or reports warnings (malformed input silently degrades to a
 * default), so this is this test's own definition of "parsed clean".
 *
 * @param parsed - Full parse of one example artifact.
 * @returns One message per defect found; `[]` when clean.
 *
 * @example
 * collectWarnings(parseLeetCode('---\ntype: leetcode\n---\n'));
 * // → ['empty title', 'empty function name']
 */
function collectWarnings(parsed: ParsedLeetCode): string[] {
	const warnings: string[] = [];
	if (parsed.title === '') { warnings.push('empty title'); }
	if (parsed.functionName === '') { warnings.push('empty function name'); }
	return warnings;
}

suite('examples/leetcode fixtures', () => {
	const files = collectMarkdownFiles(EXAMPLES_ROOT);

	test('finds at least one example artifact', () => {
		assert.ok(files.length > 0, `no .md files found under ${EXAMPLES_ROOT}`);
	});

	for (const file of files) {
		const rel = path.relative(EXAMPLES_ROOT, file);

		test(`${rel} parses with zero warnings, a non-empty public suite, and a known test.type`, () => {
			const parsed = parseLeetCode(fs.readFileSync(file, 'utf-8'));

			assert.deepStrictEqual(collectWarnings(parsed), [], `${rel}: parse warnings`);
			assert.ok(parsed.tests.length > 0, `${rel}: empty public test suite`);
			assert.ok(KNOWN_TEST_TYPES.has(parsed.test.type), `${rel}: unknown test.type "${parsed.test.type}"`);

			if (parsed.test.type === 'function') {
				assert.ok(parsed.params.length > 0, `${rel}: function example with no params`);
				assert.notStrictEqual(parsed.returns, '', `${rel}: function example with no returns type`);
			}
		});
	}
});
