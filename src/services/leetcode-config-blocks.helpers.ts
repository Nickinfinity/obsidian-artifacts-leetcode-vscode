/**
 * Config-fence extraction, plus the two frontmatter-adjacent primitives that
 * share its grammar: the D2 "moved to the body" key list and the
 * frontmatter/body split.
 *
 * Spec: `ARTIFACT_LEETCODE_FILE_FORMAT.md` §2.5. All three read
 * attacker-controlled `.md` text, so `extractConfigBlocks` walks lines
 * one at a time — the same bounded fence-toggle `leetcode-section-bounds
 * .helpers.ts`'s `boundaryOutsideFence` uses — rather than a lazy
 * `[\s\S]*?` regex over the whole body. A hostile multi-megabyte fence (or a
 * fence that never closes) therefore costs one linear pass, never
 * catastrophic backtracking.
 */

/** One config fence's byte range in the `body` string it was extracted from. */
export interface ConfigSpan {
	/** Offset of the fence's opening ` ``` ` line, inclusive. */
	start: number;
	/** Offset just past the fence's closing ` ``` ` line, exclusive. */
	end: number;
}

/** Result of walking every ` ```yaml leetcode ` fence in a document body. */
export interface ConfigBlocksResult {
	/** Every fence body, in document order, joined with `\n`. */
	raw: string;
	/**
	 * One entry per fence, in document order — offsets into the `body`
	 * argument passed to `extractConfigBlocks`, **not** the whole file. The
	 * one caller (W2.0's `extractDescription`) subtracts these ranges from its
	 * slice so a config fence sitting between the description and
	 * `## Examples` never renders as raw YAML prose.
	 */
	spans: ConfigSpan[];
	/** Author-facing problems: an unterminated fence, an off-column-0 line, a duplicated key. */
	warnings: string[];
}

/** ` ```yaml leetcode `, exactly — no `path=` or other trailing token. */
const CONFIG_MARKER_RE = /^yaml\s+leetcode\s*$/;

/** A closing fence: backticks, then only whitespace — trailing spaces/tabs are not "unterminated". */
const CLOSING_FENCE_RE = /^```\s*$/;

/** A column-0 top-level key inside a fence body (or a frontmatter line). */
const TOP_LEVEL_KEY_RE = /^(\w+):/;

/**
 * D6's asymmetric duplicate-key precedence, restated as a lookup: which
 * occurrence wins when the same top-level key is declared in two fences.
 * `parseFrontmatter` overwrites its accumulator on every match (**last**
 * wins) for the scalar/block keys it reads directly; `parseLibs` /
 * `parseChecks` locate their block with `lines.findIndex(…)` and stop at the
 * first hit (**first** wins) for the other three.
 *
 * A `Map`, not a `Record` — the key comes straight off `TOP_LEVEL_KEY_RE`'s
 * `\w+`, which admits `__proto__`/`constructor`/`toString`. A plain-object
 * lookup resolves those through the prototype chain instead of `undefined`,
 * so an artifact declaring `__proto__:` in two fences interpolated
 * `[object Object]` into a user-facing warning. `.get()` has no chain to
 * fall through and types the miss honestly as `… | undefined`.
 */
const DUPLICATE_KEY_WINNER = new Map<string, 'first' | 'last'>([
	['function', 'last'], ['functions', 'last'], ['params', 'last'], ['returns', 'last'],
	['test', 'last'], ['practice', 'last'], ['tags', 'last'],
	['libs', 'first'], ['checks', 'first'], ['services', 'first'],
]);

/**
 * The D2 "moved to the body" key set. The one authority for this list — no
 * other module re-lists these nine names. Exported (not just the
 * `legacyFrontmatterKeys` predicate built on it) because W2.2 needs the
 * *complement*: `KNOWN_FM_KEYS` minus this set is what stays a frontmatter
 * scalar, and only the raw list — not a yes/no check — can drive that split.
 */
export const BODY_SET_KEYS: ReadonlySet<string> = new Set([
	'function', 'functions', 'params', 'returns', 'test', 'practice', 'libs', 'checks', 'services',
]);

/**
 * The D2 keys that **stay** in frontmatter — `LeetCodeSummary` plus the `type`
 * discriminator. The other half of the same partition, so it lives beside
 * `BODY_SET_KEYS` rather than being re-listed by each module that needs it.
 *
 * These must never be declared in a config fence. `parseLeetCode` reads the
 * merged text and `applyScalar` is last-wins, so a fence would win — while
 * `patchFrontmatterField` still *writes* `status:` to frontmatter and
 * `parseFrontmatterOnly` (the picker) still *reads* it there. An artifact with
 * `status:` in a fence therefore submits green, gets `status: solved` written to
 * frontmatter, shows solved in the picker, and shows unsolved on the challenge
 * screen forever. `extractConfigBlocks` warns rather than changing precedence:
 * silently reassigning the winner would be a second, invisible rule.
 */
export const RETAINED_FM_KEYS: ReadonlySet<string> = new Set([
	'type', 'title', 'difficulty', 'status', 'algorithm', 'tags',
]);

/** Drop a trailing `\r` so CRLF input parses identically to LF. */
function stripCr(line: string): string {
	return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/** Lines consumed while reading one config fence's body, and where the read ended up. */
interface ReadFenceResult {
	contentLines: string[];
	nextIndex: number;
	/** Offset just past the closing ` ``` ` line's own characters — excludes its trailing `\n`. */
	spanEnd: number;
	/** Offset to resume scanning from — `spanEnd` plus the separator `split('\n')` consumed. */
	resumeOffset: number;
}

/**
 * Consumes lines from `start` until a closing ` ``` ` line (backticks, then
 * only whitespace), or end of input.
 *
 * @param lines      - The document's lines (already split on `\n`).
 * @param start      - Index of the first line *after* the opening fence.
 * @param startOffset - Character offset of `lines[start]` in the original body.
 * @returns The fence's content lines and where the scan continues, or
 *   `undefined` when no closing line was found — the caller must discard
 *   everything read so an unterminated fence yields no partial block.
 */
function readConfigFence(lines: string[], start: number, startOffset: number): ReadFenceResult | undefined {
	const contentLines: string[] = [];
	let offset = startOffset;
	let i = start;
	while (i < lines.length) {
		const line = stripCr(lines[i]);
		if (CLOSING_FENCE_RE.test(line)) {
			const spanEnd = offset + lines[i].length;
			return { contentLines, nextIndex: i + 1, spanEnd, resumeOffset: spanEnd + 1 };
		}
		offset += lines[i].length + 1;
		contentLines.push(line);
		i++;
	}
	return undefined;
}

/**
 * D5: a config fence's top-level keys must start at column 0. The fence's
 * first non-blank line is the only line that *cannot* legitimately be an
 * indented sub-key (nothing precedes it to nest under), so an indent there
 * names the defect without needing a full YAML indent-tracker.
 */
function checkIndentation(contentLines: string[], warnings: string[]): void {
	const first = contentLines.find(l => l.trim() !== '');
	if (first !== undefined && /^\s/.test(first)) {
		warnings.push(`config fence: line not at column 0 (kept verbatim) — '${first}'`);
	}
}

/** Column-0 top-level keys a fence body declares. */
function collectTopLevelKeys(contentLines: string[]): Set<string> {
	const keys = new Set<string>();
	for (const line of contentLines) {
		const m = TOP_LEVEL_KEY_RE.exec(line);
		if (m) { keys.add(m[1]); }
	}
	return keys;
}

/**
 * A config fence declaring a frontmatter-retained key — the mirror of
 * `legacyFrontmatterKeys`, and the reason `RETAINED_FM_KEYS` is exported.
 *
 * The two halves of the format each have a home; this names the wrong-way
 * violation, exactly as the D4 hard cut names the other way. Warn only: the
 * fence still wins, because `applyScalar` is last-wins and quietly inverting
 * that for six keys would be a second rule nobody could see.
 *
 * @param blockKeys - Per-fence top-level key sets, in document order.
 * @param warnings  - Sink, appended in place.
 *
 * @example
 * warnRetainedKeys([new Set(['status'])], out);
 * // out: ["config fence: 'status:' belongs in frontmatter — …"]
 */
function warnRetainedKeys(blockKeys: Set<string>[], warnings: string[]): void {
	const seen = new Set<string>();
	for (const keys of blockKeys) {
		for (const key of keys) {
			if (!RETAINED_FM_KEYS.has(key) || seen.has(key)) { continue; }
			seen.add(key);
			warnings.push(`config fence: '${key}:' belongs in frontmatter — the fence wins here, but the picker and the status writer read frontmatter, so the two will disagree`);
		}
	}
}

/** D6: the same top-level key declared in two-or-more fences — name it and say which occurrence wins. */
function warnDuplicateKeys(blockKeys: Set<string>[], warnings: string[]): void {
	const blockCount = new Map<string, number>();
	for (const keys of blockKeys) {
		for (const key of keys) { blockCount.set(key, (blockCount.get(key) ?? 0) + 1); }
	}
	for (const [key, count] of blockCount) {
		const winner = DUPLICATE_KEY_WINNER.get(key);
		if (count < 2 || !winner) { continue; }
		warnings.push(`config: '${key}' is declared in ${count} fences — the ${winner} occurrence wins`);
	}
}

/**
 * Walks a document body for every ` ```yaml leetcode ` config fence.
 *
 * A single linear pass over `body`'s lines, mirroring
 * `boundaryOutsideFence`'s fence-toggle: any *other* fence (a `## Files`
 * entry, a Setup/Solution code block, a bare ` ``` `) is skipped as one
 * opaque region, so a fence-shaped line **inside** it can never be mistaken
 * for a second config marker — nesting cannot bleed, and two adjacent config
 * fences cannot merge into one. An unterminated fence contributes no block,
 * only a warning: a truncated document must never read as a valid, partial
 * one.
 *
 * @param body - Content to scan (the post-frontmatter body, or any substring
 *   of it — offsets in the result are relative to *this* argument, not the
 *   whole file).
 * @returns Every fence body joined in document order, their spans, and any
 *   warnings.
 *
 * @example
 * extractConfigBlocks('```yaml leetcode\nreturns: int\n```');
 * // → { raw: 'returns: int', spans: [{ start: 0, end: 33 }], warnings: [] }
 */
export function extractConfigBlocks(body: string): ConfigBlocksResult {
	const lines = body.split('\n');
	const warnings: string[] = [];
	const blocks: string[] = [];
	const spans: ConfigSpan[] = [];
	const blockKeys: Set<string>[] = [];

	let offset = 0;
	let fenced = false;
	let i = 0;
	while (i < lines.length) {
		const line = stripCr(lines[i]);

		if (!fenced && line.startsWith('```') && CONFIG_MARKER_RE.test(line.slice(3))) {
			const opened = readConfigFence(lines, i + 1, offset + lines[i].length + 1);
			if (!opened) {
				warnings.push('config fence: unterminated ```yaml leetcode — no config read from it');
				break;
			}
			spans.push({ start: offset, end: opened.spanEnd });
			checkIndentation(opened.contentLines, warnings);
			blockKeys.push(collectTopLevelKeys(opened.contentLines));
			blocks.push(opened.contentLines.join('\n'));
			i = opened.nextIndex;
			offset = opened.resumeOffset;
			continue;
		}

		if (line.startsWith('```')) { fenced = !fenced; }
		offset += lines[i].length + 1;
		i++;
	}

	// A non-config fence (Setup/Solution/`## Files`/a bare ```) that never
	// closes swallows every line after it into "still inside a fence", which
	// silently hides any real config marker further down — the same failure
	// mode as an unterminated config fence, just from the other direction.
	if (fenced) {
		warnings.push('config: an unterminated ``` fence earlier in the document may hide config fences after it');
	}

	warnRetainedKeys(blockKeys, warnings);
	warnDuplicateKeys(blockKeys, warnings);
	return { raw: blocks.join('\n'), spans, warnings };
}

/**
 * The D2 body-set keys (`function`, `functions`, `params`, `returns`,
 * `test`, `practice`, `libs`, `checks`, `services`) found at column 0 in raw
 * frontmatter text. The one authority for "the body set" — no other module
 * re-lists these nine names.
 *
 * @param fmRaw - Raw frontmatter body (no `---` fences).
 * @returns Found keys, in document order; `[]` when clean.
 *
 * @example
 * legacyFrontmatterKeys('title: X\nfunction: twoSum\n'); // → ['function']
 */
export function legacyFrontmatterKeys(fmRaw: string): string[] {
	const found = new Set<string>();
	for (const line of fmRaw.split(/\r?\n/)) {
		const m = TOP_LEVEL_KEY_RE.exec(line);
		if (m && BODY_SET_KEYS.has(m[1])) { found.add(m[1]); }
	}
	return [...found];
}

/**
 * Raw frontmatter text with every D2 body-set key **removed** — the key's own
 * line plus its indented continuation lines.
 *
 * D4 is a hard cut: an execution-config key left in frontmatter is *ignored*,
 * not read. Warning about it while still parsing it would be precisely the dual
 * read D4 forbids, so the text handed to `parseFrontmatter` must not contain it.
 * `legacyFrontmatterKeys` names them for the warning; this removes them for the
 * parse. Both live here because both are the body-set list's business.
 *
 * A continuation line is one starting with whitespace, the same rule
 * `scanIndentedBlock` uses in `leetcode-parser.helpers.ts` — so `params:` takes
 * its `- name:`/`type:` lines with it, and the next column-0 key ends the block.
 *
 * @param fmRaw - Raw frontmatter body (no `---` fences).
 * @returns The same text with body-set blocks dropped; unchanged when clean.
 *
 * @example
 * withoutBodySetKeys('title: X\nparams:\n  - name: a\n    type: int\nstatus: unsolved');
 * // → 'title: X\nstatus: unsolved'
 */
export function withoutBodySetKeys(fmRaw: string): string {
	const kept: string[] = [];
	let dropping = false;
	for (const line of fmRaw.split('\n')) {
		const key = TOP_LEVEL_KEY_RE.exec(stripCr(line));
		if (key) { dropping = BODY_SET_KEYS.has(key[1]); }
		else if (dropping && !/^\s/.test(stripCr(line))) { dropping = false; }
		if (!dropping) { kept.push(line); }
	}
	return kept.join('\n');
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Splits a full `.md` artifact into its raw frontmatter text and the body
 * that follows. The one authority for this split — `parseLeetCode` and
 * `verifyExercise` both call it rather than each carrying their own copy of
 * `FRONTMATTER_RE`; a second copy is how a config key could hide from the D4
 * hard-cut check.
 *
 * @param content - Full UTF-8 `.md` file content.
 * @returns `fmRaw` (no `---` fences) and `body` (everything after); `fmRaw`
 *   is `''` and `body` is the whole input when no frontmatter block opens it.
 *
 * @example
 * splitFrontmatter('---\ntitle: X\n---\nBody'); // → { fmRaw: 'title: X', body: 'Body' }
 */
export function splitFrontmatter(content: string): { fmRaw: string; body: string } {
	const match = FRONTMATTER_RE.exec(content);
	return {
		fmRaw: match ? match[1] : '',
		body: match ? content.slice(match[0].length) : content,
	};
}
