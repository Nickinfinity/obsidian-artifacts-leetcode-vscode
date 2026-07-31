import { safeJsonParse } from '../utils/safe-json.js';
import { BODY_SET_KEYS, splitFrontmatter } from './leetcode-config-blocks.helpers.js';
import { boundaryOutsideFence, sectionBounds } from './leetcode-section-bounds.helpers.js';
import { emitYamlCases } from './yaml-cases.helpers.js';

/**
 * The pure half of the v1 → v2 artifact migration: moving execution config out
 * of YAML frontmatter into ` ```yaml leetcode ` body fences.
 *
 * Lives in `services/` rather than in `scripts/` because it is domain logic and
 * the CLI is an adapter — `scripts/migrate-artifact-format.mjs` is a thin shell
 * over these functions, exactly as `verify-exercise.mjs` is over
 * `exercise-verify.helpers.ts`. Nothing here touches a filesystem, so all of it
 * is directly unit-testable.
 */

/**
 * Signature keys go at the tail of the description region; every other body-set
 * key goes before `## Tests`.
 *
 * The split is what keeps `description` byte-identical across the migration: a
 * fence at the tail of the description slice is absorbed by
 * `extractDescription`'s `trim()`, whereas one placed between two prose
 * paragraphs would leave a blank run and change the parsed description. Keys in
 * the second group land after the first heading and so fall outside the
 * description slice entirely.
 */
const SIGNATURE_KEYS: ReadonlySet<string> = new Set(['function', 'functions', 'params', 'returns']);

const TOP_LEVEL_KEY_RE = /^(\w+):/;
const FIRST_HEADING_RE = /^#+ /m;

/**
 * Where the execution-config fence goes, most-preferred first.
 *
 * `## Tests` is the canonical anchor (§2.5: `test`/`practice` sit with the
 * suites they govern), but it is **not guaranteed to exist**. A build-only
 * `project` has no cases at all — `CoderByte/Tests/project/build-check-smoke.md`
 * is exactly that, with only `## Examples`, `## Files` and `# Solutions` — and
 * for a project the spec's own placement table anchors `libs`/`services` on
 * `## Files` anyway. Falling back down this list is what lets a legitimate
 * artifact class migrate instead of being refused.
 */
const EXECUTION_ANCHORS: readonly RegExp[] = [
	/^## Tests\s*$/m,
	/^## Files\s*$/m,
	/^# Setup\s*$/m,
	/^# Solutions\s*$/m,
];
/** The discriminator. Tested here, never via the parser — `applyScalar` ignores `type:`. */
const TYPE_LEETCODE_RE = /^type:\s*leetcode\s*$/m;

/** One top-level frontmatter key and the indented lines belonging to it. */
interface FrontmatterBlock {
	/** The key, or `null` for leading lines that precede any key. */
	key: string | null;
	/** The key's own line plus its continuation lines, verbatim. */
	lines: string[];
}

/**
 * Groups raw frontmatter into top-level blocks.
 *
 * Block termination matches the parser's `scanIndentedBlock`: any line not
 * starting with whitespace ends the block, empty lines included. Lines are kept
 * verbatim (including any `\r`) so a CRLF file round-trips unchanged.
 *
 * @param fmRaw - Raw frontmatter body, without the `---` fences.
 * @returns Blocks in document order; nothing is dropped.
 *
 * @example
 * groupBlocks('title: X\nparams:\n  - name: a');
 * // → [{ key: 'title', lines: ['title: X'] }, { key: 'params', lines: ['params:', '  - name: a'] }]
 */
function groupBlocks(fmRaw: string): FrontmatterBlock[] {
	const out: FrontmatterBlock[] = [];
	for (const line of fmRaw.split('\n')) {
		const bare = line.endsWith('\r') ? line.slice(0, -1) : line;
		const key = TOP_LEVEL_KEY_RE.exec(bare);
		if (key) { out.push({ key: key[1], lines: [line] }); }
		else if (out.length > 0) { out.at(-1)?.lines.push(line); }
		else { out.push({ key: null, lines: [line] }); }
	}
	return out;
}

/**
 * Renders one ` ```yaml leetcode ` fence from a group of blocks.
 *
 * @param picked - Blocks to place in this fence, in document order.
 * @returns The fence text, or `''` when there is nothing to declare — an
 *   artifact that never declared `practice:` must not gain a defaulted one.
 *
 * @example
 * renderFence([{ key: 'returns', lines: ['returns: int'] }]);
 * // → '```yaml leetcode\nreturns: int\n```'
 */
function renderFence(picked: FrontmatterBlock[]): string {
	if (picked.length === 0) { return ''; }
	const body = picked.flatMap(b => b.lines).join('\n').replace(/\s+$/, '');
	return '```yaml leetcode\n' + body + '\n```';
}

/**
 * Moves every D2 body-set key out of frontmatter into config fences at their
 * canonical positions.
 *
 * **Idempotent**: an artifact whose frontmatter declares no body-set key is
 * returned byte-for-byte unchanged, so running this over its own output — or
 * over an already-migrated vault — is a no-op.
 *
 * **Only declared keys get a fence.** Materialising a defaulted `practice:`
 * block into the ~58 artifacts that never had one would be a semantic no-op
 * that a human reviewing the migration diff then has to read line by line.
 *
 * @param md - Full `.md` artifact content.
 * @returns The v2 form, or `md` unchanged when there is nothing to move.
 * @throws {Error} When execution config exists but the artifact has no
 *   `## Tests` heading to anchor it — refusing beats guessing a position in a
 *   file the user cares about.
 *
 * @example
 * migrateArtifact('---\ntype: leetcode\nreturns: int\n---\nProse.\n\n## Tests\n');
 * // → frontmatter keeps `type`; a fence carrying `returns: int` sits before `## Tests`
 */
export function migrateArtifact(md: string): string {
	// Case fences are independent of the frontmatter move, so they convert even
	// for an artifact whose config already lives in a body fence — that is what
	// lets this run over an already-v2 vault and still reformat its test data.
	const withYamlCases = migrateCaseFences(md);

	const { fmRaw, body } = splitFrontmatter(withYamlCases);
	if (fmRaw === '' && !withYamlCases.startsWith('---')) { return withYamlCases; }

	const grouped = groupBlocks(fmRaw);
	const moving = grouped.filter(b => b.key !== null && BODY_SET_KEYS.has(b.key));
	if (moving.length === 0) { return withYamlCases; }

	const retained  = grouped.filter(b => b.key === null || !BODY_SET_KEYS.has(b.key));
	const signature = moving.filter(b => b.key !== null && SIGNATURE_KEYS.has(b.key));
	const execution = moving.filter(b => b.key !== null && !SIGNATURE_KEYS.has(b.key));

	const newFrontmatter = retained.flatMap(b => b.lines).join('\n').replace(/\s+$/, '');

	// **Fence-aware, and that is load-bearing.** `extractDescription` finds its
	// boundary through `boundaryOutsideFence`; a bare `/^#+ /m` here would
	// disagree with it the moment the description contains a fenced block whose
	// first line is a column-0 `#` — a comment in Python, shell, YAML and
	// Dockerfile. The migrator would then treat that comment as the first
	// heading and splice the signature fence *inside the code block*, where the
	// parser never looks: `functionName` silently becomes `''`. Sharing the
	// parser's own authority is what makes the split provably identical.
	const headingAt = boundaryOutsideFence(body, 0, FIRST_HEADING_RE);
	const head = headingAt >= body.length ? body : body.slice(0, headingAt);
	const rest = headingAt >= body.length ? '' : body.slice(headingAt);

	let newBody = head.replace(/\s+$/, '');
	const signatureFence = renderFence(signature);
	if (signatureFence !== '') { newBody += '\n\n' + signatureFence; }

	const tail = placeExecutionFence(rest, renderFence(execution));
	return '---\n' + newFrontmatter + '\n---\n' + newBody + (tail === '' ? '\n' : '\n\n' + tail);
}

/**
 * Splices the execution-config fence in before the first anchor heading present.
 *
 * Tries `EXECUTION_ANCHORS` in order and falls back to appending at the end of
 * the body. Appending is safe rather than a compromise: the parser is
 * order-independent, so placement is a readability convention, and every anchor
 * is after the first heading — hence outside the description slice — so no
 * choice here can change `parsed.description`.
 *
 * @param rest  - Body from the first heading onwards (`''` when there is none).
 * @param fence - Rendered fence, or `''` when there is no execution config.
 * @returns `rest` with the fence spliced in, or unchanged when there is none.
 *
 * @example
 * placeExecutionFence('## Tests\n[]', '```yaml leetcode\ntest:\n```');
 * // → '```yaml leetcode\ntest:\n```\n\n## Tests\n[]'
 */
function placeExecutionFence(rest: string, fence: string): string {
	if (fence === '') { return rest; }
	for (const anchor of EXECUTION_ANCHORS) {
		// Fence-aware for the same reason the description boundary is: a
		// `## Tests` line inside a ```markdown block is documentation, not the
		// section, and splicing the fence there would bury it in a code block.
		const at = boundaryOutsideFence(rest, 0, anchor);
		if (at < rest.length) { return rest.slice(0, at) + fence + '\n\n' + rest.slice(at); }
	}
	if (rest === '') { return fence + '\n'; }
	return rest.replace(/\s*$/, '') + '\n\n' + fence + '\n';
}

/** The two sections whose ` ```json ` fences hold case data. */
const CASE_SECTION_RES: readonly RegExp[] = [/^## Tests\s*$/m, /^## Final Tests\s*$/m];
/** A `##`-level section ends at the next `#` or `##` heading. */
const CASE_BOUNDARY_RE = /^#{1,2} /m;

/**
 * Rewrites the ` ```json ` case fences of `## Tests` / `## Final Tests` as
 * ` ```yaml ` fences carrying the same cases.
 *
 * **Scoped to those two sections, deliberately.** `## Files` declares real files
 * with fences like ` ```json path=package.json role=hidden `, and a `# Solutions`
 * overlay does the same — converting one of those would corrupt a project's tree
 * rather than reformat its test data. Section bounds come from `sectionBounds`,
 * so a `## Tests` line inside a fenced block is not mistaken for the heading.
 *
 * A fence whose body is not a JSON array is left exactly as it is: this
 * function reformats data it fully understands and declines everything else.
 *
 * @param md - Full artifact text.
 * @returns The text with case fences converted; unchanged where nothing applied.
 *
 * @example
 * migrateCaseFences('## Tests\n```json\n[{"input":{"x":1},"expected":2}]\n```');
 * // → '## Tests\n```yaml\n- input:\n    x: 1\n  expected: 2\n```'
 */
export function migrateCaseFences(md: string): string {
	// Sections are rewritten last-first so an earlier rewrite cannot shift the
	// offsets of a later one.
	const spans = CASE_SECTION_RES
		.map(re => sectionBounds(md, re, CASE_BOUNDARY_RE))
		.filter((b): b is NonNullable<typeof b> => b !== null)
		.sort((a, b) => b.headingEnd - a.headingEnd);

	let out = md;
	for (const span of spans) {
		const section = out.slice(span.headingEnd, span.bodyEnd);
		out = out.slice(0, span.headingEnd) + convertFences(section) + out.slice(span.bodyEnd);
	}
	return out;
}

/** Replace every well-formed ` ```json ` case fence in one section body. */
function convertFences(section: string): string {
	const fences = /```json([^\n]*)\r?\n([\s\S]*?)```/g;
	return section.replace(fences, (whole, info: string, body: string) => {
		const parsed: unknown = safeJsonParse(body);
		if (!Array.isArray(parsed)) { return whole; }
		return '```yaml' + info + '\n' + emitYamlCases(parsed) + '\n```';
	});
}

/**
 * Whether this text is a LeetCode exercise, by its own frontmatter test.
 *
 * Deliberately not asked of the parser: `applyScalar` ignores `type:` entirely,
 * so `parseLeetCode` cannot answer it. A vault holds ordinary notes —
 * `CoderByte/Tests/README.md` is the live file this exists for — and one of
 * them must not be rewritten as if it were an exercise.
 *
 * @param md - Full `.md` content.
 * @returns `true` when frontmatter carries `type: leetcode`.
 *
 * @example
 * isLeetCodeArtifact('---\ntype: leetcode\n---\n'); // → true
 * isLeetCodeArtifact('---\ntitle: Notes\n---\n');   // → false
 */
export function isLeetCodeArtifact(md: string): boolean {
	if (!md.startsWith('---')) { return false; }
	return TYPE_LEETCODE_RE.test(splitFrontmatter(md).fmRaw);
}

/**
 * Minimal line-based unified diff, for the dry-run report a human reads before
 * approving a vault rewrite.
 *
 * Deliberately not a general LCS diff: this transform only ever lifts a
 * contiguous run of frontmatter lines into one or two fences, so trimming the
 * common prefix and suffix shows exactly the changed region and nothing else.
 * A real diff algorithm here would be more code for an identical result.
 *
 * @param before - Original text.
 * @param after  - Migrated text.
 * @param label  - Path shown in the `---` / `+++` header.
 * @returns Unified-diff text, or `''` when the two are identical.
 *
 * @example
 * unifiedDiff('a\nb', 'a\nc', 'f.md'); // → '--- f.md\n+++ f.md\n@@ -2 +2 @@\n-b\n+c'
 */
export function unifiedDiff(before: string, after: string, label: string): string {
	if (before === after) { return ''; }
	const a = before.split('\n');
	const b = after.split('\n');

	let head = 0;
	while (head < a.length && head < b.length && a[head] === b[head]) { head++; }
	let tail = 0;
	while (
		tail < a.length - head && tail < b.length - head
		&& a[a.length - 1 - tail] === b[b.length - 1 - tail]
	) { tail++; }

	const lines = [`--- ${label}`, `+++ ${label}`, `@@ -${head + 1} +${head + 1} @@`];
	for (const line of a.slice(head, a.length - tail)) { lines.push('-' + line); }
	for (const line of b.slice(head, b.length - tail)) { lines.push('+' + line); }
	return lines.join('\n');
}

/** Parsed command line for the migration CLI. */
export interface MigrateArgs {
	/** Directory or file to migrate. */
	target: string;
	/** `true` only for an exact `--write`; a dry run otherwise. */
	write: boolean;
}

/**
 * Parses the CLI's argv, refusing anything unrecognised.
 *
 * An unknown flag is an **error, never ignored**: silently dropping `--wrte` is
 * how a user believes they ran a dry run over their vault. Dry run is the
 * default, so any parse that does not explicitly see `--write` cannot write.
 *
 * @param argv - `process.argv.slice(2)`.
 * @returns The parsed target and write flag.
 * @throws {Error} On a missing target, a second target, or an unknown flag.
 *
 * @example
 * parseMigrateArgs(['/vault']);            // → { target: '/vault', write: false }
 * parseMigrateArgs(['/vault', '--write']); // → { target: '/vault', write: true }
 */
export function parseMigrateArgs(argv: string[]): MigrateArgs {
	let target: string | undefined;
	let write = false;
	for (const arg of argv) {
		if (arg === '--write') { write = true; continue; }
		if (arg.startsWith('-')) { throw new Error(`unknown flag: ${arg}`); }
		if (target !== undefined) { throw new Error(`unexpected second target: ${arg}`); }
		target = arg;
	}
	if (target === undefined) {
		throw new Error('usage: migrate-artifact-format.mjs <dir|file> [--write]');
	}
	return { target, write };
}

/**
 * Whether `relativePath` — the result of `path.relative(root, candidate)` —
 * stays inside the root.
 *
 * Compares on a separator boundary rather than by string prefix, so a sibling
 * directory named `/vault-evil` cannot pass a check against `/vault`. Kept pure
 * (path arithmetic only) so the containment rule is unit-testable without a
 * filesystem; the CLI supplies the `path.relative` call.
 *
 * @param relativePath - `path.relative(root, candidate)`.
 * @param sep - Platform separator, injected so the rule is testable either way.
 * @returns `true` when the candidate is contained.
 *
 * @example
 * isContained('topic/a.md', '/'); // → true
 * isContained('../evil.md', '/'); // → false
 */
export function isContained(relativePath: string, sep: string): boolean {
	if (relativePath === '') { return true; }
	return relativePath !== '..' && !relativePath.startsWith('..' + sep);
}
