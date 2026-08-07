import { CANONICAL_FRONTMATTER_ORDER, extractConfigBlocks, splitFrontmatter } from './leetcode-config-blocks.helpers.js';
import { resolveLeetcodeType } from './leetcode-type.helpers.js';

/**
 * The one-time v2 → **two-axis** transform (plan T1.13): `type:` becomes
 * `artifactType:`, a derived `leetcodeType:` is inserted second, the retained
 * frontmatter keys are put in canonical order, and a check-graded `test:`
 * block loses the legacy `type:` line that would otherwise contradict the new
 * axis (D14).
 *
 * Kept apart from `artifact-migrator.helpers.ts` — that file owns the *v1 → v2*
 * transform, is a completed one-time job at 367 lines, and folding a second
 * migration into it would push it past the size limit while mixing two
 * unrelated one-shot histories in one place.
 *
 * **Everything here is line-scoped, and that is the whole design.** The
 * transform never re-emits YAML and never reflows: it rewrites individual
 * lines and leaves every other byte — prose, `## Files`, `# Solutions`, fence
 * contents, unknown frontmatter keys, and each line's own ending — exactly as
 * it found them. A previous migration in this repo corrupted a vault file by
 * normalising CRLF, so line endings are carried per line rather than assumed.
 */

/**
 * `CANONICAL_FRONTMATTER_ORDER` widened to `readonly string[]`.
 *
 * The exported constant is a literal tuple, so its `includes`/`indexOf` accept
 * only the seven literal members — and the keys here come off untrusted
 * frontmatter text, which is every other string in the world. Widening once,
 * here, keeps the order itself in its single authority instead of copying it.
 */
const ORDER: readonly string[] = CANONICAL_FRONTMATTER_ORDER;

/** A top-level frontmatter key and the lines belonging to it (its value, and any continuation). */
interface FmBlock {
	/** The key, or `null` for leading content that belongs to no key. */
	key: string | null;
	/** Line indices into the split parts array, in order. */
	lines: number[];
}

/**
 * Splits text into alternating content lines and their exact line endings.
 *
 * `String.split(/(\r?\n)/)` keeps the separators, so index `2n` is a line and
 * index `2n+1` is that line's ending — which is how a mixed-ending file
 * survives a rewrite that only touches some of its lines.
 *
 * @param text - Any text.
 * @returns The alternating parts array.
 *
 * @example
 * splitKeepingEols('a\r\nb\n'); // → ['a', '\r\n', 'b', '\n', '']
 */
function splitKeepingEols(text: string): string[] {
	return text.split(/(\r?\n)/);
}

/** Matches a column-0 `key:` line — the same anchored, single-quantifier shape used elsewhere. */
const TOP_LEVEL_KEY_RE = /^(\w+):/;

/**
 * Groups frontmatter lines under their owning top-level key.
 *
 * A `tags:` block list or a nested `params:` map spans several lines, so a
 * reorder that moved key lines alone would tear values away from their keys.
 *
 * @param parts - Output of `splitKeepingEols` over the frontmatter body.
 * @returns One block per top-level key, in document order.
 *
 * @example
 * frontmatterBlocks(splitKeepingEols('tags:\n  - a\ntitle: X')).length; // → 2
 */
function frontmatterBlocks(parts: string[]): FmBlock[] {
	const blocks: FmBlock[] = [];
	for (let i = 0; i < parts.length; i += 2) {
		const match = TOP_LEVEL_KEY_RE.exec(parts[i]);
		if (match) {
			blocks.push({ key: match[1], lines: [i] });
		} else if (blocks.length > 0) {
			blocks[blocks.length - 1].lines.push(i);
		} else {
			blocks.push({ key: null, lines: [i] });
		}
	}
	return blocks;
}

/**
 * Reorders the **canonical** frontmatter keys into `CANONICAL_FRONTMATTER_ORDER`
 * while leaving every unknown key exactly where the author put it.
 *
 * Unknown keys hold their original slots and the canonical blocks fill the
 * remaining slots in order, so a vault note carrying a custom field keeps it in
 * place — the order rule governs the seven keys the format defines, nothing else.
 *
 * @param blocks - Blocks in document order.
 * @returns The same blocks, canonical ones reordered among their own slots.
 *
 * @example
 * // ['title', 'artifactType'] → ['artifactType', 'title']
 */
function reorderCanonical(blocks: FmBlock[]): FmBlock[] {
	const slots: number[] = [];
	const canonical: FmBlock[] = [];
	blocks.forEach((block, index) => {
		if (block.key !== null && ORDER.includes(block.key)) {
			slots.push(index);
			canonical.push(block);
		}
	});

	canonical.sort((a, b) =>
		ORDER.indexOf(a.key ?? '') - ORDER.indexOf(b.key ?? ''));

	const out = [...blocks];
	slots.forEach((slot, i) => { out[slot] = canonical[i]; });
	return out;
}

/**
 * Is this trailing part an empty slot or a bare line ending?
 *
 * @param part - The last element of the assembled parts array.
 * @returns True when it may be dropped from the end of a frontmatter body.
 *
 * @example
 * isTrailingBlank('\r\n'); // → true
 */
function isTrailingBlank(part: string | undefined): boolean {
	return part === '' || (part !== undefined && /^\r?\n$/.test(part));
}

/**
 * Rewrites the frontmatter body: renames the discriminator, inserts the
 * derived leetcode type, and applies the canonical order.
 *
 * @param fmRaw        - Raw frontmatter body, no `---` fences.
 * @param leetcodeType - The already-resolved leetcode type to declare.
 * @returns The rewritten frontmatter body.
 *
 * @example
 * migrateFrontmatter('type: leetcode\ntitle: X', 'function');
 * // → 'artifactType: leetcode\nleetcodeType: function\ntitle: X'
 */
function migrateFrontmatter(fmRaw: string, leetcodeType: string): string {
	const parts = splitKeepingEols(fmRaw);
	let blocks = frontmatterBlocks(parts);

	// 1. `type:` → `artifactType:`, value and trailing content untouched.
	for (const block of blocks) {
		if (block.key === 'type') {
			const i = block.lines[0];
			parts[i] = parts[i].replace(TOP_LEVEL_KEY_RE, 'artifactType:');
			block.key = 'artifactType';
		}
	}

	// 2. Insert `leetcodeType:` when absent, reusing an existing line's ending.
	//
	// `parts` alternates line / ending, so a new line may only be appended at an
	// **even** index. `fmRaw` never ends with a newline (`splitFrontmatter`
	// strips it), which leaves `parts` odd-length — appending blind put the new
	// key at an odd index, where it read as another line's *ending* and got
	// concatenated into its neighbour. Give the current last line an ending
	// first, then append.
	if (!blocks.some(b => b.key === 'leetcodeType')) {
		const eol = parts.find((p, i) => i % 2 === 1 && p !== '') ?? '\n';
		if (parts.length % 2 === 1) { parts.push(eol); }
		parts.push(`leetcodeType: ${leetcodeType}`, eol);
		blocks.push({ key: 'leetcodeType', lines: [parts.length - 2] });
	}

	// 3. Canonical order.
	blocks = reorderCanonical(blocks);

	const out: string[] = [];
	for (const block of blocks) {
		for (const i of block.lines) { out.push(parts[i], parts[i + 1] ?? ''); }
	}
	// A frontmatter body never carries its own trailing newline — `splitFrontmatter`
	// strips it, and the `---` delimiter supplies it. Reordering can move a block
	// that *did* end a line into the middle, so the trailing ending is dropped
	// here rather than assumed absent; leaving it produces a blank line before
	// the closing `---`.
	while (out.length > 0 && isTrailingBlank(out.at(-1))) { out.pop(); }
	return out.join('');
}

/**
 * Drops the legacy `type:` line from a check-graded `test:` block and renames
 * a `services:` block to `packages:` — the only two body edits (D14, §D).
 *
 * A `test:` block declaring `checks:` must not also declare `type:`: after the
 * axis split neither `project` nor `service` is a test-type id, and an artifact
 * carrying both a `leetcodeType` and a legacy `test.type` is a named verifier
 * failure. Migrating frontmatter alone would therefore write every check-graded
 * artifact into a guaranteed-fail state.
 *
 * @param fence - The text of one ` ```yaml leetcode ` fence, opener and closer included.
 * @returns The fence with those lines rewritten, every other byte untouched.
 *
 * @example
 * migrateConfigFence('```yaml leetcode\ntest:\n  type: project\n  checks:\n```');
 * // → the same fence without the `  type: project` line
 */
function migrateConfigFence(fence: string): string {
	const parts = splitKeepingEols(fence);
	const drop = new Set<number>();

	for (let i = 0; i < parts.length; i += 2) {
		if (/^services:/.test(parts[i])) {
			parts[i] = parts[i].replace(/^services:/, 'packages:');
			continue;
		}
		if (!/^test:/.test(parts[i])) { continue; }

		// Children of `test:` run until the next column-0 key.
		const children: number[] = [];
		for (let j = i + 2; j < parts.length; j += 2) {
			if (TOP_LEVEL_KEY_RE.test(parts[j]) || parts[j].startsWith('```')) { break; }
			children.push(j);
		}
		if (!children.some(j => /^\s+checks:/.test(parts[j]))) { continue; }
		for (const j of children) {
			if (/^\s+type:/.test(parts[j])) { drop.add(j); }
		}
	}

	if (drop.size === 0) { return fence; }
	const out: string[] = [];
	for (let i = 0; i < parts.length; i += 2) {
		if (drop.has(i)) { continue; }
		out.push(parts[i], parts[i + 1] ?? '');
	}
	return out.join('');
}

/** Reads the raw `test.type` scalar from a config fence, pre-fallback (plan C3). */
function rawTestTypeOf(configText: string): string | undefined {
	const lines = configText.split(/\r?\n/);
	let inTest = false;
	for (const line of lines) {
		if (/^test:/.test(line)) { inTest = true; continue; }
		if (inTest && TOP_LEVEL_KEY_RE.test(line)) { inTest = false; }
		if (!inTest) { continue; }
		const match = /^\s+type:\s*(\S+)/.exec(line);
		if (match) { return match[1]; }
	}
	return undefined;
}

/** Reads a top-level frontmatter scalar, or `undefined`. */
function fmScalar(fmRaw: string, key: string): string | undefined {
	for (const line of fmRaw.split(/\r?\n/)) {
		const match = TOP_LEVEL_KEY_RE.exec(line);
		if (match && match[1] === key) { return line.slice(match[0].length).trim() || undefined; }
	}
	return undefined;
}

/**
 * Migrates one artifact to the two-axis format.
 *
 * Idempotent: an already-migrated artifact declares `artifactType:` and
 * `leetcodeType:` in canonical order and has no `type:` line left inside a
 * check-graded `test:` block, so every rewrite finds nothing to do and the
 * function returns its input unchanged.
 *
 * @param md - Full `.md` artifact text (untrusted).
 * @returns The migrated text, or `md` unchanged when it has no frontmatter.
 *
 * @example
 * migrateExerciseAxes('---\ntype: leetcode\ntitle: X\n---\n\nBody.\n');
 * // → '---\nartifactType: leetcode\nleetcodeType: function\ntitle: X\n---\n\nBody.\n'
 */
export function migrateExerciseAxes(md: string): string {
	const { fmRaw, body } = splitFrontmatter(md);
	if (fmRaw === '') { return md; }

	const config = extractConfigBlocks(body);
	const rawTestType = rawTestTypeOf(config.raw) ?? rawTestTypeOf(fmRaw);
	const { leetcodeType } = resolveLeetcodeType(fmScalar(fmRaw, 'leetcodeType'), rawTestType);

	// Fence spans are taken from the one authority that finds them, then edited
	// back-to-front so an earlier edit cannot shift a later span's offsets.
	let newBody = body;
	for (const span of [...config.spans].sort((a, b) => b.start - a.start)) {
		const fence = newBody.slice(span.start, span.end);
		newBody = newBody.slice(0, span.start) + migrateConfigFence(fence) + newBody.slice(span.end);
	}

	const fmBlock = md.slice(0, md.length - body.length);
	const newFm = migrateFrontmatter(fmRaw, leetcodeType);
	return fmBlock.replace(fmRaw, () => newFm) + newBody;
}
