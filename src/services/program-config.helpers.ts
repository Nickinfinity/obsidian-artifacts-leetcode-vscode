import * as path from 'node:path';
import type { ProgramChannel, ProgramConfig } from '../types/leetcode.types.js';

/**
 * `program:` config-block grammar (T2.1).
 *
 * `program` is the delivery mechanism for a `program`-type case: a candidate
 * that reads its case from argv, named flags or stdin and writes its answer
 * to `$LEET_OUT` (`ARTIFACT_LEETCODE_FILE_FORMAT.md` §2.5.1,
 * `out-channel.ts`). As of wave 2.D `program` is **implemented** for
 * `leetcodeType: package`: `parseLeetCode` calls this parser, the block lands
 * on `ParsedLeetCode.program`, and `program.runner.ts` executes the suite one
 * process per case. Until then this module had **no caller at all** — the
 * grammar existed and no artifact's block was ever read.
 *
 * Every field is read through a fixed three-name allowlist (`channel`,
 * `entry`, `flags`) via explicit branches, never a dynamic
 * `result[key] = value` — so an artifact declaring `__proto__:` under
 * `program:` is simply an unrecognised field, with nothing for it to reach
 * through.
 *
 * `entry`'s check here is a **shape guard, not a resolution**: it refuses a
 * path that can *never* become a contained one (absolute, a `..` segment, a
 * `node_modules` segment at any depth) so a doomed value is refused by name
 * before it can ever reach an argv array. It is **not** the containment
 * authority — `resolveContained` (`test-envs/project/files.writer.ts`) still
 * owns turning a shape-valid `entry` into a path inside the run directory,
 * at the point of use, exactly as it already does for `## Files` `path=`, a
 * `build` check's `dir:` and a `function` check's `file:`
 * (`ARTIFACT_LEETCODE_FILE_FORMAT.md` §9.1). This module never imports it and
 * never fabricates a synthetic run directory to call it early — belt, not
 * braces.
 */

// The shape lives in `src/types/leetcode.types.ts` — `ParsedLeetCode` carries a
// `program?: ProgramConfig`, and a type there may not import from `services/`.
// Re-exported so every existing consumer keeps importing it from the module
// that parses it.
export type { ProgramChannel, ProgramConfig } from '../types/leetcode.types.js';

const KV_RE = /^(\w+):\s*(.*)$/;
const VALID_CHANNELS: ReadonlySet<string> = new Set(['argv', 'flags', 'stdin']);
const DEFAULT_CHANNEL: ProgramChannel = 'argv';

/** Reserved at every depth — a linked `node_modules` (the shared package cache) can land there. */
const RESERVED_SEGMENT = 'node_modules';

/**
 * Parses the `program:` config block out of merged config text (frontmatter
 * body-set lines plus every ` ```yaml leetcode ` fence body — the same
 * `lines` shape `parseLibDeclarations`/`parseChecks` in
 * `project-parser.helpers.ts` already take).
 *
 * Every step degrades: an unknown or absent `channel` falls back to `argv`,
 * an unsafe `entry` is dropped — each with a warning, since a silent drop is
 * indistinguishable from an artifact that never declared the thing at all.
 *
 * @param lines - Config-text lines.
 * @param warn  - Sink for author-facing problems.
 * @returns Parsed config, or `undefined` when no `program:` block is present.
 *
 * @example
 * parseProgramConfig(['program:', '  channel: stdin'], () => {});
 * // → { channel: 'stdin' }
 */
export function parseProgramConfig(lines: string[], warn: (m: string) => void): ProgramConfig | undefined {
	const start = lines.findIndex(l => /^\s*program:\s*$/.test(l));
	if (start === -1) { return undefined; }

	let channel: ProgramChannel = DEFAULT_CHANNEL;
	let sawChannel = false;
	let entry: string | undefined;
	const flags: string[] = [];

	for (const raw of blockLines(lines, start)) {
		const trimmed = raw.trim();
		if (trimmed.startsWith('- ')) {
			flags.push(trimmed.slice(2).trim());
			continue;
		}
		const kv = KV_RE.exec(trimmed);
		if (!kv) { continue; }
		const key = kv[1];
		const val = kv[2].trim();

		if (key === 'channel') {
			sawChannel = true;
			channel = parseChannel(val, warn);
		} else if (key === 'entry') {
			entry = parseEntry(val, warn);
		} else if (key === 'flags') {
			flags.push(...parseInlineFlags(val));
		}
		// Any other field name — `__proto__` included — is simply unrecognised:
		// there is no dynamic assignment target for it to reach.
	}

	if (!sawChannel) { warn("program: no 'channel' declared — defaulted to 'argv'"); }

	const config: ProgramConfig = { channel };
	if (entry !== undefined) { config.entry = entry; }
	if (flags.length > 0) { config.flags = flags; }
	return config;
}

/** Validate a `channel:` value, falling back to `argv` for anything outside the vocabulary. */
function parseChannel(val: string, warn: (m: string) => void): ProgramChannel {
	if (VALID_CHANNELS.has(val)) { return val as ProgramChannel; }
	warn(`program: unknown channel '${val}' — defaulted to 'argv'`);
	return DEFAULT_CHANNEL;
}

/** Validate an `entry:` value against the shape guard, dropping it (named) when unsafe. */
function parseEntry(val: string, warn: (m: string) => void): string | undefined {
	const reason = unsafeEntryReason(val);
	if (reason) {
		warn(`program: entry '${val}' rejected — ${reason}`);
		return undefined;
	}
	return val;
}

/**
 * Names the shapes an `entry` can never resolve into a contained path from,
 * so the doomed cases are refused before `entry` ever reaches an argv array.
 * This is **not** containment — it does not resolve or normalise anything,
 * only rejects shapes `resolveContained` would refuse anyway. See the module
 * doc for why the real authority still runs at the point of use.
 *
 * @param entry - Raw `entry:` value, untrusted.
 * @returns A reason string when refused; `undefined` when shape-safe.
 */
function unsafeEntryReason(entry: string): string | undefined {
	if (entry === '') { return 'empty'; }
	if (path.isAbsolute(entry)) { return 'must be relative to the run directory'; }

	const segments = entry.split(/[/\\]/);
	if (segments.includes('..')) { return "must not contain a '..' segment"; }
	// Case-insensitive, NFKC-normalised, same fold `resolveContained` uses —
	// APFS/NTFS treat `NODE_MODULES` as the same directory as `node_modules`,
	// and `.toLowerCase()` alone does not fold every Unicode homoglyph.
	if (segments.some(s => s.normalize('NFKC').toLowerCase() === RESERVED_SEGMENT)) {
		return `'${RESERVED_SEGMENT}' is a reserved path segment`;
	}
	return undefined;
}

/** `flags: [a, b]` → `['a', 'b']`; anything else (a bare `flags:` list header) → `[]`. */
function parseInlineFlags(val: string): string[] {
	if (!val.startsWith('[')) { return []; }
	return val.replace(/^\[|\]$/g, '')
		.split(',')
		.map(part => part.trim().replace(/^['"]|['"]$/g, ''))
		.filter(part => part !== '');
}

/** Lines indented deeper than the block header at `start`, up to the first that is not. */
function blockLines(lines: string[], start: number): string[] {
	const base = indentOf(lines[start]);
	const out: string[] = [];
	for (let i = start + 1; i < lines.length; i++) {
		if (lines[i].trim() === '') { continue; }
		if (indentOf(lines[i]) <= base) { break; }
		out.push(lines[i]);
	}
	return out;
}

/** Count of leading whitespace characters. */
function indentOf(line: string): number {
	return /^\s*/.exec(line)?.[0].length ?? 0;
}
