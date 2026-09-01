import type {
	FileRole, FileSpec, LibSpec, PackageSpec, ProjectCheck, TestCase, TestTypeId,
} from '../types/leetcode.types.js';
import { TEST_TYPES } from '../types/constants.js';
import { parsePackages } from './packages-parser.helpers.js';
import { safeJsonParse } from '../utils/safe-json.js';
import {
	BODY_SET_KEYS,
	extractConfigBlocks,
	RETAINED_FM_KEYS,
	splitFrontmatter,
	withoutBodySetKeys,
} from './leetcode-config-blocks.helpers.js';
import { resolveLangId } from './language-map.service.js';
import { ecosystemFor } from './libs/lib-ecosystem.js';
import { parseSpec } from './libs/lib-spec.helpers.js';
import { sectionBounds } from './leetcode-section-bounds.helpers.js';
import { CASE_SECTIONS, extractCaseFences } from './leetcode-sections.helpers.js';

/**
 * The `project` half of an artifact: its file tree, its dependencies, and the
 * checks that grade it — plus `libs:`, which every test type may declare and
 * which is exported from here because this file owns the list-block grammar it
 * is written in.
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
	/**
	 * `packages:` entries — what an `http` check's `package:` name resolves
	 * against. `[]` when the block is absent **and** when it was refused: a
	 * cap breach or a `dependsOn` cycle is a whole-block error (T3.1), and the
	 * artifact must be left with no packages rather than a truncated list that
	 * grades against a subset nobody declared.
	 */
	packages: PackageSpec[];
	/** `# Solutions` fences carrying `path=` — reference overlays for `## Files` */
	solutionFiles: FileSpec[];
	/** Author-facing problems that degraded to a default instead of failing */
	warnings: string[];
	/**
	 * Check `kind`s the artifact declared that no environment implements yet —
	 * the structured form of the "declares kind '…', which no environment
	 * implements yet — dropped" warning `buildCheck` already emits.
	 *
	 * Exists so a grading path can refuse an artifact **as a whole** (S3, the
	 * false-green vector): `warnings` is prose written for a human, and a
	 * refusal decision must never be built by pattern-matching a UX sentence.
	 * `checks` alone cannot answer this either — a dropped check never joins
	 * it, so by the time a caller only holds `checks` (the survivors), the
	 * fact that something was silently dropped is already gone. Deduplicated,
	 * insertion order.
	 */
	unimplementedKinds: readonly string[];
}

const FILES_RE = /^## Files\s*$/m;
const SOLUTIONS_RE = /^# Solutions\s*$/m;
const HEADING_RE = /^#{1,2} /m;
/** `# Solutions` is a `#`-level section — its `##` language headings stay inside it. */
const TOP_HEADING_RE = /^# /m;
const FENCE_RE = /```([^\n]*)\r?\n([\s\S]*?)```/g;

const VALID_ROLES = new Set<FileRole>(['editable', 'readonly', 'hidden']);

/**
 * The kinds a check may declare — **the `ProjectCheck` discriminants**.
 *
 * `satisfies readonly TestTypeId[]` keeps the DRY tie the merge exists for: a
 * check kind must be a declared member of the one test-type vocabulary, so the
 * hand-kept list that used to sit here — listing `function` meaning something
 * different from the `function` in `TEST_TYPES` — cannot come back.
 *
 * It is deliberately **not** derived from `status === 'implemented'`. That
 * conflates two different questions: *is this id executable by anything?* and
 * *can `runOneCheck` dispatch it?* Deriving from status admitted `kind: call`,
 * which no `case` in `runOneCheck` handles — it fell through to the render
 * branch and was graded as a `dom-assert`.
 *
 * The tie is **one-directional**, deliberately: `satisfies` enforces
 * vocabulary → kind, so removing an id from `TestTypeId` fails the build here
 * and the drifting hand-kept list cannot come back. It does *not* enforce
 * dispatchability — re-adding `call` would still compile. What catches that is
 * the control-flow narrowing at the tail of `buildCheck`, which is why that is
 * written as a guard and not a cast. Adding a fifth `ProjectCheck`
 * discriminant fails the build at `runOneCheck`'s exhaustive switch, not here;
 * a `CHECK_KINDS` left stale merely drops the new kind as *reserved*, which is
 * safe but silent.
 */
const CHECK_KINDS = ['call', 'build', 'dom-assert', 'css-assert', 'http'] as const satisfies readonly TestTypeId[];

/** Membership form of `CHECK_KINDS`, for the untrusted string a `kind:` line carries. */
const VALID_KINDS: ReadonlySet<string> = new Set<string>(CHECK_KINDS);

/**
 * Check kinds the **format** documents but no environment can execute yet.
 *
 * Derived as *everything the vocabulary declares that `runOneCheck` cannot
 * dispatch*, rather than from a second hardcoded `['http']` that had to
 * remember to say so. The shape ids are excluded because `kind: project` was
 * never meaningful in the first place — it is an artifact shape, not a way to
 * deliver a case, so it stays an **unknown** kind rather than a reserved one.
 *
 * Kept apart from an *unknown* kind so the author is told which of two very
 * different things happened: `kind: htpp` is a typo they can fix, while
 * `kind: http` is a contract this extension has not implemented yet. Calling
 * the second one "unknown" sent authors looking for a spelling mistake in a
 * line that was spelled correctly.
 *
 * Both are still **dropped**: a check nothing can run must not reach the
 * panel's check line, and must never count as a red check for `--starter-red`,
 * which requires a starter to fail *on its merits*. This parse-time drop is
 * unchanged by T1.6 — it stays the hygiene step that keeps `checks` free of
 * anything nothing can dispatch.
 *
 * **T1.16 adds the refusal that inverts the drop, one file over.**
 * `leetcode-run.helpers.ts`'s `projectGradeRefusal` is the authority a
 * grading path consults, by name, before it writes anything: when *any*
 * declared check named a kind that landed here, the whole artifact is
 * ungradeable, not just the checks that survived — grading only the
 * survivors is the false-green vector (S3) this exists to close.
 * `refusalFor` (`compatibility.helpers.ts`) alone cannot see this: once an
 * artifact's `leetcodeType` has passed the `isMultiFile` gate, it always
 * resolves an env for the `'project'` test-type key, so a guard that only
 * consulted `refusalFor` refused nothing — this set, surfaced as
 * `ProjectSections.unimplementedKinds` / `unimplementedCheckKindsFromContent`,
 * is what a grading path must consult instead. Deleting the drop here would
 * leave `kind: http` parsing as a valid kind that nothing implements and
 * nothing refuses.
 */
const RESERVED_KINDS: ReadonlySet<string> = new Set(
	TEST_TYPES
		.map(t => t.id)
		.filter(id => !VALID_KINDS.has(id)),
);

/** Fields a `checks:` entry may set. Anything else — `__proto__` included — never lands. */
const CHECK_FIELDS = new Set(['name', 'kind', 'file', 'function', 'argv', 'dir', 'package']);

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
	const unimplementedKinds: string[] = [];
	const onReservedKind = (kind: string): void => {
		if (!unimplementedKinds.includes(kind)) { unimplementedKinds.push(kind); }
	};
	const lines = configRaw.split(/\r?\n/);

	warnNearMissKeys(lines, warn);

	const checks = parseChecks(lines, warn, onReservedKind);
	bindCases(checks, body, warn);

	const packages = parsePackages(lines, warn);
	if (!packages.ok) { warn(packages.error); }

	return {
		files: parseFiles(body, FILES_RE, HEADING_RE, warn),
		libs: parseLibDeclarations(lines, warn),
		checks,
		packages: packages.ok ? [...packages.packages] : [],
		// A `# Solutions` fence without `path=` is a plain reference solution for a
		// function-type artifact; only path-bearing ones overlay a project's tree.
		solutionFiles: parseFiles(body, SOLUTIONS_RE, TOP_HEADING_RE, warn),
		warnings,
		unimplementedKinds,
	};
}

/**
 * Re-derives `ProjectSections.unimplementedKinds` from a whole `.md` file's
 * raw content — for a caller that holds only the source text, or only a
 * `ParsedLeetCode` plus that same text, and never the intermediate
 * `ProjectSections`.
 *
 * `leetcode-parser.service.ts`'s `parseLeetCode` runs the identical three
 * calls internally to build the `configRaw` / `body` pair `parseProjectArtifact`
 * needs, but does not surface `unimplementedKinds` on `ParsedLeetCode` — so a
 * run handler or the CLI, which see only the parsed result, cannot tell which
 * kinds were silently dropped from `checks`. This re-parses from source
 * rather than trusting a second, unwired field, and rather than pattern
 * matching the free-form warning text (see `ProjectSections.unimplementedKinds`).
 *
 * @param content - Full UTF-8 `.md` artifact text.
 * @returns Deduplicated, unimplemented check kinds the artifact declared;
 *   `[]` for an artifact with none (including a `function`-shaped one, whose
 *   `checks:` — if it declared any at all — is graded by nothing anyway).
 *
 * @example
 * unimplementedCheckKindsFromContent(md); // → ['http']
 */
export function unimplementedCheckKindsFromContent(content: string): readonly string[] {
	const { fmRaw, body } = splitFrontmatter(content);
	const config = extractConfigBlocks(body);
	const configRaw = withoutBodySetKeys(fmRaw) + '\n' + config.raw;
	return parseProjectArtifact(configRaw, body).unimplementedKinds;
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
 * Parses `libs:` into per-language lists, dropping anything its ecosystem's
 * grammar refuses **before** it can ever reach an install subprocess.
 *
 * Exported because **every** test type may declare `libs:` — a `function`
 * exercise can want numpy exactly as a `project` can. It lives here rather than
 * in a module of its own because the list-block reader it needs is this file's,
 * and one authority beats a second copy of the grammar.
 *
 * Each language is validated against **its own** registry's grammar: a maven
 * coordinate is not an npm name, and one shared pattern would refuse the
 * correct spelling for three registries out of four.
 *
 * The language key runs through `resolveLangId` and must resolve to a plain
 * identifier, which is also what keeps `__proto__` and friends out of the
 * result object.
 *
 * @param lines - Config-text lines (frontmatter plus body fences).
 * @param warn  - Sink for author-facing problems.
 * @returns Language id → validated specs; `{}` when `libs:` is absent.
 *
 * @example
 * parseLibDeclarations(['libs:', '  python: [fastapi@^0.115.0]'], () => {});
 * // → { python: ['fastapi@^0.115.0'] }
 */
export function parseLibDeclarations(lines: string[], warn: (m: string) => void): LibSpec {
	const start = lines.findIndex(l => /^\s*libs:\s*$/.test(l));
	if (start === -1) { return {}; }

	const libs: LibSpec = {};
	for (const [key, values] of readListMap(lines, start)) {
		const language = resolveLangId(key);
		if (!isSafeKey(language)) { continue; }

		const ecosystem = ecosystemFor(language);
		if (!ecosystem) {
			warn(`libs: '${language}' has no package registry here — these are skipped`);
			continue;
		}

		const accepted = values.filter(value => parseSpec(ecosystem, value).ok);
		const refused = values.filter(value => !parseSpec(ecosystem, value).ok);
		if (refused.length > 0) {
			warn(`libs: rejected ${refused.map(quoted).join(', ')} — not an installable ${ecosystem} spec`);
		}
		if (accepted.length > 0) { libs[language] = accepted; }
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
	return splitOutsideQuotes(value.replace(/^\[|\]$/g, ''))
		.map(part => unquote(part.trim()))
		.filter(part => part !== '');
}

/**
 * Split on commas that are **not** inside a quoted run.
 *
 * A plain `split(',')` is right until a value legitimately contains one, and
 * exactly one kind does: a pip requirement's version range. `numpy>=2,<3` is
 * the idiomatic way to bound a dependency, and splitting it produced
 * `numpy>=2` plus a `<3` that failed validation — so the artifact installed an
 * *unbounded* numpy while warning about something else. Quoting is the YAML
 * answer to that, and it has to actually work.
 *
 * @param body - The inside of an inline list, brackets already stripped.
 * @returns One raw part per top-level comma, quotes still attached.
 *
 * @example
 * splitOutsideQuotes('a, b');            // → ['a', ' b']
 * splitOutsideQuotes('"numpy>=2,<3", b'); // → ['"numpy>=2,<3"', ' b']
 */
function splitOutsideQuotes(body: string): string[] {
	const parts: string[] = [];
	let current = '';
	let quote: string | null = null;

	for (const char of body) {
		if (quote !== null) {
			if (char === quote) { quote = null; }
		} else if (char === '"' || char === "'") {
			quote = char;
		} else if (char === ',') {
			parts.push(current);
			current = '';
			continue;
		}
		current += char;
	}
	parts.push(current);
	return parts;
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
 * @param lines        - Frontmatter lines.
 * @param warn         - Sink for author-facing problems.
 * @param onReservedKind - Sink for each `kind:` dropped because it is a
 *   documented-but-unimplemented reserved id (never for a plain typo).
 * @returns Well-formed checks, cases still empty.
 *
 * @example
 * parseChecks(['test:', '  checks:', '    - name: builds', '      kind: build', '      argv: []'], () => {}, () => {});
 * // → [{ name: 'builds', kind: 'build', argv: [], cases: [] }]
 */
function parseChecks(
	lines: string[], warn: (m: string) => void, onReservedKind: (kind: string) => void,
): ProjectCheck[] {
	const start = lines.findIndex(l => /^\s*checks:/.test(l));
	if (start === -1) { return []; }

	const header = /^\s*checks:(.*)$/.exec(lines[start]);
	if (header && header[1].trim() !== '') {
		warn(`checks: expected a list, got '${header[1].trim()}' — no checks parsed`);
		return [];
	}

	const out: ProjectCheck[] = [];
	for (const entry of splitListEntries(blockLines(lines, start))) {
		const check = buildCheck(entry, warn, onReservedKind);
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
function buildCheck(
	fields: Map<string, string>, warn: (m: string) => void, onReservedKind: (kind: string) => void,
): ProjectCheck | null {
	const name = unquote(fields.get('name') ?? '');
	const kind = fields.get('kind') ?? '';
	if (!name) { return null; }
	if (RESERVED_KINDS.has(kind)) {
		warn(`checks: '${name}' declares kind '${kind}', which no environment implements yet — dropped`);
		onReservedKind(kind);
		return null;
	}
	if (!VALID_KINDS.has(kind)) {
		warn(`checks: '${name}' has unknown kind '${kind}' — dropped`);
		return null;
	}

	// The only kind that names a **process** rather than a file: an `http`
	// check boots the `packages:` entry it names and sends requests at it, so
	// it needs no `file:` and the `file` requirement below must not run for it.
	if (kind === 'http') {
		const pkg = unquote(fields.get('package') ?? '');
		if (!pkg) {
			warn(`checks: http check '${name}' needs a package — dropped`);
			return null;
		}
		return { name, kind, package: pkg, cases: [], publicCount: 0 };
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
	if (kind === 'call') {
		const fn = unquote(fields.get('function') ?? '');
		if (!fn) {
			warn(`checks: call check '${name}' needs a function — dropped`);
			return null;
		}
		return { name, kind, file, function: fn, cases: [], publicCount: 0 };
	}
	// Narrowed by control flow, never asserted: the `kind as 'dom-assert' |
	// 'css-assert'` this replaces was sound only while `VALID_KINDS` held
	// exactly the four discriminants, and silently mislabelled anything a
	// widened set let through. Unreachable today — and that is the point of
	// writing it as a guard rather than a cast.
	if (kind !== 'dom-assert' && kind !== 'css-assert') {
		warn(`checks: '${name}' has unknown kind '${kind}' — dropped`);
		return null;
	}
	// Optional (T4.8, VSX-228): which booted `packages:` entry the mounted
	// component's `fetch` may reach. Whether the name is one this artifact
	// actually declares is not this parser's question — it has not parsed
	// `packages:` yet at this point, and would still know nothing of which
	// packages actually booted. That is `apiPortForRenderCheck`'s job, at
	// grading time, exactly as an `http` check's own `package:` is resolved
	// against `parsed.packages` in `runPackageHttpCheck`, not here.
	const pkg = unquote(fields.get('package') ?? '');
	return { name, kind, file, cases: [], publicCount: 0, ...(pkg ? { package: pkg } : {}) };
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
 * warnNearMissKeys(['packagse:'], m => console.log(m));
 * // logs: unknown config key 'packagse' — did you mean 'packages'?
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
