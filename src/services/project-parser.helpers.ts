import type { FileRole, FileSpec, LibSpec, ProjectCheck, TestCase } from '../types/leetcode.types.js';
import { safeJsonParse } from '../utils/safe-json.js';
import { BODY_SET_KEYS, RETAINED_FM_KEYS } from './leetcode-config-blocks.helpers.js';
import { resolveLangId } from './language-map.service.js';
import { validateLibNames } from './lib-spec.helpers.js';
import { ecosystemFor } from './libs/lib-ecosystem.js';
import { sectionBounds } from './leetcode-section-bounds.helpers.js';
import { CASE_SECTIONS, extractCaseFences } from './leetcode-sections.helpers.js';

/**
 * The `project` half of an artifact: its file tree, its dependencies, and the
 * checks that grade it.
 *
 * Lives beside the function grammar rather than inside it —
 * `leetcode-parser.helpers.ts` is already at the size ceiling, and a multi-file
 * exercise is its own concern.
 */
export interface ProjectSections {
	/** `## Files` entries, in document order */
	files: FileSpec[];
	/** `libs:` per-language lists, allowlist-filtered */
	libs: LibSpec;
	/** `checks:` entries with their bound cases */
	checks: ProjectCheck[];
	/** `# Solutions` fences carrying `path=` — reference overlays for `## Files` */
	solutionFiles: FileSpec[];
	/** Author-facing problems that degraded to a default instead of failing */
	warnings: string[];
}

const FILES_RE = /^## Files\s*$/m;
const SOLUTIONS_RE = /^# Solutions\s*$/m;
const HEADING_RE = /^#{1,2} /m;
/** `# Solutions` is a `#`-level section — its `##` language headings stay inside it. */
const TOP_HEADING_RE = /^# /m;
const FENCE_RE = /```([^\n]*)\r?\n([\s\S]*?)```/g;

const VALID_ROLES = new Set<FileRole>(['editable', 'readonly', 'hidden']);
const VALID_KINDS = new Set(['function', 'build', 'dom-assert', 'css-assert']);

/** Fields a `checks:` entry may set. Anything else — `__proto__` included — never lands. */
const CHECK_FIELDS = new Set(['name', 'kind', 'file', 'function', 'argv', 'dir']);

/**
 * Every key the near-miss warning considers legitimate, wherever it appeared.
 *
 * **Both halves are imported**, never re-listed — `leetcode-config-blocks
 * .helpers.ts` owns the format's key partition, and a second copy here is how
 * the two drift. Note neither half contains `files`: `## Files` is a body
 * *section*, and `files:` was never a frontmatter key, though it sat in this
 * list before v2 and made the check treat it as one.
 *
 * Union rather than per-position, because this check answers "is this a typo?"
 * and a typo is a typo in either half. "This key is in the wrong half" is a
 * different question, answered by `legacyFrontmatterKeys` (D4's hard cut) and
 * `warnRetainedKeys` (its mirror).
 */
const KNOWN_KEYS = [...RETAINED_FM_KEYS, ...BODY_SET_KEYS];

/**
 * Parses the `project`-only grammar out of an artifact.
 *
 * Every step degrades: a malformed `checks:` yields no checks, a lib failing the
 * allowlist is dropped, an unknown `role` falls back to `editable` — each with a
 * warning, because a silent drop is indistinguishable from an artifact that
 * never declared the thing at all (spike §5).
 *
 * Paths are **not** resolved or validated here. The parser reports what the file
 * says; containment is asserted by the writer, immediately before it writes —
 * one authority, at the point of use.
 *
 * @param configRaw - The **merged** config text: D2-retained frontmatter plus
 *   every ` ```yaml leetcode ` fence body, exactly what `parseFrontmatter` is
 *   given (D5's single concatenation). `libs:`, `checks:` and `services:` now
 *   live in body fences, so frontmatter alone would find none of them — and
 *   `warnNearMissKeys` would stop seeing frontmatter typos like `titel:`.
 * @param body  - Artifact content after the frontmatter.
 * @returns Files, libs, checks (cases already bound), and any warnings.
 *
 * @example
 * parseProjectArtifact('libs:\n  typescript:\n    - react@^19.0.0', '## Files\n```tsx path=a.tsx\nx\n```');
 * // → { files: [{ path: 'a.tsx', … }], libs: { typescript: ['react@^19.0.0'] }, checks: [], warnings: [] }
 */
export function parseProjectArtifact(configRaw: string, body: string): ProjectSections {
	const warnings: string[] = [];
	const warn = (message: string): void => { warnings.push(message); };
	const lines = configRaw.split(/\r?\n/);

	warnNearMissKeys(lines, warn);

	const checks = parseChecks(lines, warn);
	bindCases(checks, body, warn);

	return {
		files: parseFiles(body, FILES_RE, HEADING_RE, warn),
		libs: parseLibs(lines, warn),
		checks,
		// A `# Solutions` fence without `path=` is a plain reference solution for a
		// function-type artifact; only path-bearing ones overlay a project's tree.
		solutionFiles: parseFiles(body, SOLUTIONS_RE, TOP_HEADING_RE, warn),
		warnings,
	};
}

// ── ## Files ──────────────────────────────────────────────────────────────────

/**
 * Reads every fence in `## Files` that carries a `path=` attribute.
 *
 * A fence without `path=` is prose, not a file, and is skipped silently — the
 * section may legitimately contain an illustrative snippet.
 *
 * Shared by `## Files` (the starter tree) and `# Solutions` (reference overlays),
 * which differ only in their heading and where the section ends.
 *
 * @param body       - Artifact content after the frontmatter.
 * @param headingRe  - The section's own heading.
 * @param boundaryRe - Heading level that ends the section.
 * @param warn       - Sink for author-facing problems.
 * @returns One spec per declared file, in document order.
 *
 * @example
 * parseFiles('## Files\n```css path=a.css role=hidden\nbody{}\n```', FILES_RE, HEADING_RE, () => {});
 * // → [{ path: 'a.css', language: 'css', role: 'hidden', content: 'body{}\n' }]
 */
function parseFiles(
	body: string, headingRe: RegExp, boundaryRe: RegExp, warn: (m: string) => void,
): FileSpec[] {
	const bounds = sectionBounds(body, headingRe, boundaryRe);
	if (!bounds) { return []; }

	const section = body.slice(bounds.headingEnd, bounds.bodyEnd);
	const out: FileSpec[] = [];
	const fences = new RegExp(FENCE_RE.source, FENCE_RE.flags);
	for (let m = fences.exec(section); m !== null; m = fences.exec(section)) {
		const info = m[1];
		const path = attr(info, 'path');
		if (!path) { continue; }
		out.push({
			path,
			language: resolveLangId(/^\S*/.exec(info)?.[0] ?? ''),
			role: parseRole(attr(info, 'role'), warn),
			content: m[2],
		});
	}
	return out;
}

/** Read `key=value` (quoted or bare) from a fence info-string. */
function attr(infoString: string, key: string): string | undefined {
	const re = new RegExp(String.raw`${key}=(?:"([^"]*)"|(\S+))`);
	const m = re.exec(infoString);
	if (!m) { return undefined; }
	return m[1] ?? m[2];
}

/** An absent role means `editable`; an unrecognised one is a typo worth naming. */
function parseRole(raw: string | undefined, warn: (m: string) => void): FileRole {
	if (raw === undefined) { return 'editable'; }
	if (VALID_ROLES.has(raw as FileRole)) { return raw as FileRole; }
	warn(`## Files: unknown role '${raw}' — treated as editable`);
	return 'editable';
}

// ── libs: ─────────────────────────────────────────────────────────────────────

/**
 * Parses `libs:` into per-language lists, dropping anything the allowlist
 * refuses **before** it can ever reach an install subprocess.
 *
 * The language key runs through `resolveLangId` and must resolve to a plain
 * identifier, which is also what keeps `__proto__` and friends out of the
 * result object.
 *
 * @param lines - Frontmatter lines.
 * @param warn  - Sink for author-facing problems.
 * @returns Language id → validated specs; `{}` when `libs:` is absent.
 *
 * @example
 * parseLibs(['libs:', '  python: [fastapi@^0.115.0]'], () => {});
 * // → { python: ['fastapi@^0.115.0'] }
 */
function parseLibs(lines: string[], warn: (m: string) => void): LibSpec {
	const start = lines.findIndex(l => /^\s*libs:\s*$/.test(l));
	if (start === -1) { return {}; }

	const libs: LibSpec = {};
	for (const [key, values] of readListMap(lines, start)) {
		const language = resolveLangId(key);
		if (!isSafeKey(language)) { continue; }

		// Reported, not dropped: the entries stay on the parsed artifact so a
		// future installer can use them, but the author is told now rather than
		// discovering that npm served a same-named package from the wrong
		// registry.
		if (ecosystemFor(language) !== 'npm') {
			warn(`libs: '${language}' is not installable — the library installer is npm-only, so these are skipped`);
		}

		const check = validateLibNames(values);
		if (!check.ok) {
			const rejected = check.invalid.map(quoted).join(', ');
			warn(`libs: rejected ${rejected} — not an installable package name`);
		}
		const allowed = values.filter(v => !check.ok ? !check.invalid.includes(v) : true);
		if (allowed.length > 0) { libs[language] = allowed; }
	}
	return libs;
}

/**
 * Reads a `key:` → list block: each nested `key:` maps to its `- item` lines, or
 * to an inline `[a, b]` list.
 *
 * @param lines - Frontmatter lines.
 * @param start - Index of the block's own heading line.
 * @returns Ordered `[key, values]` pairs.
 *
 * @example
 * readListMap(['libs:', '  python:', '    - fastapi'], 0); // → [['python', ['fastapi']]]
 */
function readListMap(lines: string[], start: number): [string, string[]][] {
	const out: [string, string[]][] = [];
	let current: [string, string[]] | null = null;

	for (const line of blockLines(lines, start)) {
		const trimmed = line.trim();
		if (trimmed.startsWith('- ')) {
			current?.[1].push(unquote(trimmed.slice(2)));
			continue;
		}
		const kv = /^([^:]+):(.*)$/.exec(trimmed);
		if (!kv) { continue; }
		current = [kv[1].trim(), inlineList(kv[2])];
		out.push(current);
	}
	return out;
}

/** `[a, b]` → `['a', 'b']`; anything else → `[]` (a list-header line). */
function inlineList(raw: string): string[] {
	const value = raw.trim();
	if (!value.startsWith('[')) { return []; }
	return value.replace(/^\[|\]$/g, '')
		.split(',')
		.map(part => unquote(part.trim()))
		.filter(part => part !== '');
}

// ── checks: ───────────────────────────────────────────────────────────────────

/**
 * Parses the `checks:` list into discriminated `ProjectCheck`s.
 *
 * Only the fields a kind owns are read, from a fixed allowlist — an unexpected
 * field name (`__proto__`) is never used as an assignment target. A check whose
 * kind is unknown, or whose required fields are missing, is dropped with a
 * warning rather than half-built.
 *
 * @param lines - Frontmatter lines.
 * @param warn  - Sink for author-facing problems.
 * @returns Well-formed checks, cases still empty.
 *
 * @example
 * parseChecks(['test:', '  checks:', '    - name: builds', '      kind: build', '      argv: []'], () => {});
 * // → [{ name: 'builds', kind: 'build', argv: [], cases: [] }]
 */
function parseChecks(lines: string[], warn: (m: string) => void): ProjectCheck[] {
	const start = lines.findIndex(l => /^\s*checks:/.test(l));
	if (start === -1) { return []; }

	const header = /^\s*checks:(.*)$/.exec(lines[start]);
	if (header && header[1].trim() !== '') {
		warn(`checks: expected a list, got '${header[1].trim()}' — no checks parsed`);
		return [];
	}

	const out: ProjectCheck[] = [];
	for (const entry of splitListEntries(blockLines(lines, start))) {
		const check = buildCheck(entry, warn);
		if (check) { out.push(check); }
	}
	return out;
}

/** Group a list block's lines into one field map per `- ` entry. */
function splitListEntries(lines: string[]): Map<string, string>[] {
	const entries: Map<string, string>[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		const isNew = trimmed.startsWith('- ');
		const kv = /^([^:]+):(.*)$/.exec(isNew ? trimmed.slice(2) : trimmed);
		if (isNew) { entries.push(new Map()); }
		if (!kv || entries.length === 0) { continue; }

		const field = kv[1].trim();
		if (CHECK_FIELDS.has(field)) { entries.at(-1)?.set(field, kv[2].trim()); }
	}
	return entries;
}

/** Build one check from its field map, or `null` when it cannot be trusted. */
function buildCheck(fields: Map<string, string>, warn: (m: string) => void): ProjectCheck | null {
	const name = unquote(fields.get('name') ?? '');
	const kind = fields.get('kind') ?? '';
	if (!name) { return null; }
	if (!VALID_KINDS.has(kind)) {
		warn(`checks: '${name}' has unknown kind '${kind}' — dropped`);
		return null;
	}

	if (kind === 'build') {
		const argv = safeJsonParse(fields.get('argv') ?? '');
		if (!isStringArray(argv)) {
			warn(`checks: build check '${name}' needs argv as a JSON array of strings — dropped`);
			return null;
		}
		const dir = fields.get('dir');
		return { name, kind, argv, cases: [], publicCount: 0, ...(dir ? { dir: unquote(dir) } : {}) };
	}

	const file = unquote(fields.get('file') ?? '');
	if (!file) {
		warn(`checks: '${name}' needs a file — dropped`);
		return null;
	}
	if (kind === 'function') {
		const fn = unquote(fields.get('function') ?? '');
		if (!fn) {
			warn(`checks: function check '${name}' needs a function — dropped`);
			return null;
		}
		return { name, kind, file, function: fn, cases: [], publicCount: 0 };
	}
	return { name, kind: kind as 'dom-assert' | 'css-assert', file, cases: [], publicCount: 0 };
}

// ── case → check binding ──────────────────────────────────────────────────────

/**
 * Attaches each ` ```json check=<name> ` fence's cases to the check it names.
 *
 * A bare fence binds to the sole check when there is exactly one — the common
 * single-check project — and warns otherwise, since guessing would silently
 * grade the wrong thing. Public fences bind before final ones, so a check's
 * `cases` keep the public-then-final order the runner expects and `publicCount`
 * describes the boundary.
 *
 * @param checks - Checks to bind into (mutated in place).
 * @param body   - Artifact content after the frontmatter.
 * @param warn   - Sink for author-facing problems.
 *
 * @example
 * bindCases(checks, '## Tests\n```json check=api\n[]\n```', () => {});
 */
function bindCases(checks: ProjectCheck[], body: string, warn: (m: string) => void): void {
	if (checks.length === 0) { return; }

	const fences = [
		...extractCaseFences(body, CASE_SECTIONS.tests).map(f => ({ ...f, public: true })),
		...extractCaseFences(body, CASE_SECTIONS.final).map(f => ({ ...f, public: false })),
	];

	for (const fence of fences) {
		const name = fence.check ?? (checks.length === 1 ? checks[0].name : undefined);
		if (name === undefined) {
			warn('## Tests: a json fence names no check, and this project has several — cases ignored');
			continue;
		}
		const target = checks.find(c => c.name === name);
		if (!target) {
			warn(`## Tests: fence binds to unknown check '${name}' — cases ignored`);
			continue;
		}
		target.cases.push(...fence.cases as TestCase[]);
		// Public fences are bound first, so the public cases are always the
		// leading slice and one counter is enough to describe the split.
		if (fence.public) { target.publicCount += fence.cases.length; }
	}
}

// ── unknown-key warning (spike §5) ────────────────────────────────────────────

/**
 * Warns when a top-level frontmatter key is one edit or two away from a key the
 * format knows — `servcies:` reads exactly like `services:` and is otherwise
 * dropped without a trace.
 *
 * Only near-misses warn: a genuinely custom key (`source:`) is the author's
 * business and stays silent.
 *
 * @param lines - Frontmatter lines.
 * @param warn  - Sink for author-facing problems.
 *
 * @example
 * warnNearMissKeys(['servcies:'], m => console.log(m));
 * // logs: unknown config key 'servcies' — did you mean 'services'?
 */
function warnNearMissKeys(lines: string[], warn: (m: string) => void): void {
	for (const line of lines) {
		const kv = /^(\w+):/.exec(line);
		if (!kv || KNOWN_KEYS.includes(kv[1])) { continue; }

		const near = KNOWN_KEYS.find(known => editDistance(kv[1], known) <= 2);
		// "config key", not "frontmatter key": this now reads the *merged* text,
		// so the offending line may have come from either half of the file.
		if (near) { warn(`unknown config key '${kv[1]}' — did you mean '${near}'?`); }
	}
}

/** Levenshtein distance, iterative single-row — enough for short key names. */
function editDistance(a: string, b: string): number {
	let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		for (let j = 1; j <= b.length; j++) {
			const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
			current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, substitution);
		}
		previous = current;
	}
	return previous[b.length];
}

// ── shared line helpers ───────────────────────────────────────────────────────

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

/** Wrap a value in single quotes for a warning message. */
function quoted(value: string): string {
	return `'${value}'`;
}

/** Strip one layer of matching quotes, if present. */
function unquote(value: string): string {
	const m = /^"(.*)"$|^'(.*)'$/.exec(value.trim());
	return m ? m[1] ?? m[2] : value.trim();
}

/** Keys that would reach through an object's prototype are never used as targets. */
function isSafeKey(key: string): boolean {
	return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

/** Narrow an unknown parse result to `string[]`. */
function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(v => typeof v === 'string');
}
