import * as path from 'node:path';
import { safeJsonParse } from '../utils/safe-json.js';
import { libEnvVars } from './libs/lib-env.helpers.js';
import { LIB_ECOSYSTEMS } from './libs/lib-ecosystem.js';
import type { PackageSpec } from '../types/leetcode.types.js';

/**
 * `packages:` config-block grammar (T3.1) — a `leetcodeType: stack`'s boot
 * list, replacing the never-parsed `services:` key
 * (`ARTIFACT_LEETCODE_FILE_FORMAT.md` §9.3).
 *
 * Every field is read through a fixed allowlist via explicit `Map.set` /
 * object-literal assignment, never a dynamic `result[key] = value` — so an
 * artifact declaring `__proto__:` under a package entry, or under its nested
 * `exposeAs:` map, is simply an unrecognised field, with nothing for it to
 * reach through.
 *
 * **`dir` is a shape guard here, not containment (mirrors `program-config
 * .helpers.ts`'s `entry`).** It refuses a path that can *never* become a
 * contained one (absolute, a `..` segment, a `node_modules` segment at any
 * depth) so a doomed value is refused by name before it can ever reach an
 * argv array or a spawn `cwd`. `resolveContained`
 * (`test-envs/project/files.writer.ts`) still owns turning a shape-valid
 * `dir` into a path inside the run directory, at the point of use — this
 * module never imports it and never fabricates a synthetic run directory to
 * call it early.
 *
 * **`install` / `start` are argv arrays, never command strings (S5).** Each
 * is read as a single JSON-array-of-strings literal (the same shape a
 * `build` check's `argv:` already uses) — a bare or quoted command string
 * fails `isStringArray` and the whole entry is dropped. `${PORT}` is the
 * **only** substitution admitted anywhere a template appears (an argv
 * element or an `exposeAs` value template); every occurrence is checked
 * per-element so a later refactor could not silently rejoin the array into
 * one string without losing the check.
 *
 * **`exposeAs` names an environment variable of a *child* process, so both
 * the name and the value shape are validated (S9).** The name must match
 * `^[A-Z][A-Z0-9_]*$` and miss a denylist of loader/interpreter variables
 * (`PATH`, `NODE_OPTIONS`, `PYTHONPATH`, `LD_PRELOAD`, `DYLD_*`, …) —
 * **half of which is derived from `libEnvVars`** (`lib-env.helpers.ts`),
 * the one authority for the variables this extension itself sets to point a
 * child at an installed library cache (`NODE_PATH`, `VIRTUAL_ENV`,
 * `CLASSPATH`, `CARGO_TARGET_DIR`), so that seam cannot silently reopen by
 * this list going stale beside it. The value is constrained to
 * `EXPOSE_VALUE_RE` — a loopback URL template, `${PORT}` and nothing else
 * variable — so `exposeAs: API_URL: /tmp/whatever` or a `-javaagent:` flag
 * smuggled in as a "URL" is refused **at parse time**, not merely by the
 * name denylist. The denylist is therefore defence in depth, not the sole
 * barrier: even a future miss in it cannot inject anything a booted child
 * would execute, because the value shape itself admits nothing but a
 * loopback address. What a booted child's `exposeAs` variable is set *to*
 * at runtime is still computed by a later task (T4.1) from the
 * already-assigned port of the dependency being exposed — this module only
 * proves the artifact-declared template could never have been anything
 * else.
 *
 * **A `dependsOn` cycle is the one hard parse *error* this module
 * produces.** Everything else above degrades through `warn` and keeps
 * going — a cycle instead fails the whole block, because a `stack` runner
 * has no order to boot in once packages depend on each other circularly.
 * Signalled through the discriminated `PackagesResult`, never a thrown
 * exception, so a caller narrows on `.ok` exactly like `parseSpec`'s
 * `{ ok, … }` result in `lib-spec.helpers.ts`.
 */

// ── types ──────────────────────────────────────────────────────────────────

/**
 * `parsePackages`'s result — a discriminated union, not an always-present
 * `packages: []` plus a side-channel error, so a caller cannot forget to
 * check `.ok` before reading `.packages`.
 */
export type PackagesResult =
	| { readonly ok: true; readonly packages: readonly PackageSpec[] }
	| { readonly ok: false; readonly error: string };

// ── constants ─────────────────────────────────────────────────────────────

/**
 * Hard cap on `packages:` entries (S7). A `stack` boots every entry
 * concurrently and installs an ecosystem for each, so the cap bounds a
 * single artifact's concurrent-process and concurrent-install footprint.
 * Generous above the worked S3 example's 3-package `dependsOn` chain.
 */
export const MAX_PACKAGES = 8;

/** Reserved at every depth — a linked `node_modules` (the shared package cache) can land there. */
const RESERVED_SEGMENT = 'node_modules';

/** Fields a `packages:` entry may set. `exposeAs` is carved out separately (see `parseEntryLines`). */
const PACKAGE_FIELDS = new Set(['name', 'dir', 'install', 'start', 'ready', 'dependsOn']);

/** `^[A-Z][A-Z0-9_]*$` structurally excludes `__proto__`/`constructor`/`prototype` — none start with an uppercase letter. */
const EXPOSE_NAME_RE = /^[A-Z][A-Z0-9_]*$/;

/**
 * The only value shape an `exposeAs` template may take (SEC2): a loopback
 * URL with `${PORT}` as its sole variable part, and an optional path/query
 * suffix. Anything else — an arbitrary path, a flag, a non-loopback host —
 * is refused here regardless of what the name denylist below does or does
 * not yet know about.
 */
const EXPOSE_VALUE_RE = /^http:\/\/127\.0\.0\.1:\$\{PORT\}(\/\S*)?$/;

/**
 * Variable names *this extension itself* sets to point a child process at
 * an installed library cache — derived from `libEnvVars`, the one
 * authority for that seam (SEC1), rather than re-listed by hand. Covers
 * `NODE_PATH`, `VIRTUAL_ENV`, `CLASSPATH`, `CARGO_TARGET_DIR` today; picks
 * up a new one automatically if `libEnvVars` ever grows another.
 */
const LIB_SEAM_VARS: ReadonlySet<string> = new Set(
	LIB_ECOSYSTEMS.flatMap(eco => Object.keys(libEnvVars(eco, '/dummy').env)),
);

/**
 * Loader/interpreter variables an `exposeAs` name must never be (S9) — the
 * half `libEnvVars` cannot derive, because these are not this extension's
 * own seam but the *runtime's* code-loading knobs. `DYLD_*` (macOS dynamic
 * linker) is a wildcard family, checked separately in
 * `isReservedExposeName`.
 */
const EXPOSE_DENYLIST: ReadonlySet<string> = new Set([
	'PATH', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'NODE_REPL_EXTERNAL_MODULE',
	'PYTHONPATH', 'PYTHONSTARTUP',
	'LD_PRELOAD', 'LD_LIBRARY_PATH', 'LD_AUDIT',
	'JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS',
	'RUSTFLAGS',
]);

/** A `key: value` line, key restricted to plain identifiers. */
const KV_RE = /^(\w+):\s*(.*)$/;

/** A `${…}` placeholder, captured so its content can be checked against `PORT`. */
const PLACEHOLDER_RE = /\$\{([^}]*)\}/g;

// ── entry point ───────────────────────────────────────────────────────────

/**
 * Parses the `packages:` config block out of merged config text (frontmatter
 * body-set lines plus every ` ```yaml leetcode ` fence body — the same
 * `lines` shape `parseLibDeclarations`/`parseChecks`
 * (`project-parser.helpers.ts`) and `parseProgramConfig`
 * (`program-config.helpers.ts`) already take).
 *
 * @param lines - Config-text lines.
 * @param warn  - Sink for author-facing problems that degrade rather than fail the parse.
 * @returns `{ ok: true, packages }`, or `{ ok: false, error }` for the one
 *   hard failure this module produces — a `dependsOn` cycle.
 *
 * @example
 * parsePackages(['packages:', '  - name: api', '    dir: server',
 *   '    install: ["pip", "install"]', '    start: ["uvicorn"]'], () => {});
 * // → { ok: true, packages: [{ name: 'api', dir: 'server', install: [...], start: [...] }] }
 */
export function parsePackages(lines: string[], warn: (m: string) => void): PackagesResult {
	const start = lines.findIndex(l => /^\s*packages:/.test(l));
	if (start === -1) { return { ok: true, packages: [] }; }

	const header = /^\s*packages:(.*)$/.exec(lines[start]);
	if (header && header[1].trim() !== '') {
		warn(`packages: expected a list, got '${header[1].trim()}' — no packages parsed`);
		return { ok: true, packages: [] };
	}

	const groups = splitPackageEntries(blockLines(lines, start));
	if (groups.length > MAX_PACKAGES) {
		// A truncate-and-warn here would silently drop a `dependsOn` target
		// (S7's "N processes" bound is not the only thing at stake — finding 4
		// measured a dangling edge from a dropped-but-referenced package
		// reported as a clean parse). Refuse the whole block instead, exactly
		// as a `dependsOn` cycle does.
		return {
			ok: false,
			error: `packages: ${groups.length} entries declared, more than the ${MAX_PACKAGES}-entry cap (S7)`,
		};
	}

	const packages: PackageSpec[] = [];
	for (const group of groups) {
		const pkg = buildPackage(group, warn);
		if (pkg) { packages.push(pkg); }
	}

	const duplicate = findDuplicateName(packages);
	if (duplicate) {
		return { ok: false, error: `packages: duplicate name '${duplicate}' — every package name must be unique` };
	}

	const cycle = findCycle(packages);
	if (cycle) {
		return { ok: false, error: `packages: dependsOn cycle detected: ${cycle.join(' → ')}` };
	}
	return { ok: true, packages };
}

// ── entry building ────────────────────────────────────────────────────────

/** Build one package from its raw lines, or `null` when a required field cannot be trusted. */
function buildPackage(group: readonly string[], warn: (m: string) => void): PackageSpec | null {
	const { fields, exposeAs } = parseEntryLines(group, warn);

	const name = unquote(fields.get('name') ?? '');
	if (!name) { warn("packages: entry missing 'name' — dropped"); return null; }

	const dir = unquote(fields.get('dir') ?? '');
	const dirReason = unsafeDirReason(dir);
	if (dirReason) { warn(`packages: '${name}' dir '${dir}' rejected — ${dirReason}`); return null; }

	const install = parseArgv(fields.get('install'), name, 'install', warn);
	if (!install) { return null; }
	const start = parseArgv(fields.get('start'), name, 'start', warn);
	if (!start) { return null; }

	const readyRaw = fields.get('ready');
	const dependsOn = parseInlineNames(fields.get('dependsOn') ?? '');

	return {
		name, dir, install, start,
		...(readyRaw !== undefined ? { ready: unquote(readyRaw) } : {}),
		...(dependsOn.length > 0 ? { dependsOn } : {}),
		...(Object.keys(exposeAs).length > 0 ? { exposeAs } : {}),
	};
}

/** Read an `install:` / `start:` value as a JSON array of strings, refusing any other shape (S5). */
function parseArgv(
	raw: string | undefined, name: string, field: string, warn: (m: string) => void,
): string[] | null {
	if (raw === undefined) {
		warn(`packages: '${name}' needs ${field} — dropped`);
		return null;
	}
	const parsed = safeJsonParse(raw);
	if (!isStringArray(parsed)) {
		warn(`packages: '${name}' ${field} must be a JSON array of strings, not a command string — dropped`);
		return null;
	}
	if (parsed.length === 0) {
		warn(`packages: '${name}' ${field} must not be an empty argv — dropped`);
		return null;
	}
	const badElement = parsed.find(el => !hasOnlyPortPlaceholder(el));
	if (badElement !== undefined) {
		warn(`packages: '${name}' ${field} element '${badElement}' uses a substitution other than \${PORT} — dropped`);
		return null;
	}
	return parsed;
}

/** `dependsOn: [api, cache]` → `['api', 'cache']`; anything else (absent, malformed) → `[]`. */
function parseInlineNames(raw: string): string[] {
	const value = raw.trim();
	if (!value.startsWith('[')) { return []; }
	return value.replace(/^\[|\]$/g, '')
		.split(',')
		.map(part => unquote(part.trim()))
		.filter(part => part !== '');
}

// ── dir: shape guard, not containment ────────────────────────────────────

/**
 * Names the shapes a `dir` can never resolve into a contained path from, so
 * the doomed cases are refused before `dir` ever reaches a spawn `cwd`. Not
 * containment — see the module doc for why the real authority still runs at
 * the point of use.
 */
function unsafeDirReason(dir: string): string | undefined {
	if (dir === '') { return 'empty'; }
	if (path.isAbsolute(dir)) { return 'must be relative to the run directory'; }

	const segments = dir.split(/[/\\]/);
	if (segments.includes('..')) { return "must not contain a '..' segment"; }
	if (segments.some(s => s.normalize('NFKC').toLowerCase() === RESERVED_SEGMENT)) {
		return `'${RESERVED_SEGMENT}' is a reserved path segment`;
	}
	return undefined;
}

// ── exposeAs: variable name is validated (S9) ────────────────────────────

/** Read one `NAME: "value"` line of an `exposeAs:` block, dropping it by name when unsafe. */
function readExposeEntry(line: string, warn: (m: string) => void, out: Record<string, string>): void {
	const kv = KV_RE.exec(line.trim());
	if (!kv) { return; }
	const key = kv[1];
	const value = unquote(kv[2].trim());

	if (!EXPOSE_NAME_RE.test(key)) {
		warn(`packages: exposeAs name '${key}' must match ^[A-Z][A-Z0-9_]*$ — dropped`);
		return;
	}
	if (isReservedExposeName(key)) {
		warn(`packages: exposeAs '${key}' is a reserved loader/interpreter variable name — dropped`);
		return;
	}
	if (!EXPOSE_VALUE_RE.test(value)) {
		warn(`packages: exposeAs '${key}' value '${value}' must be a loopback URL template (SEC2) — dropped`);
		return;
	}
	out[key] = value;
}

/** `DYLD_*` is a wildcard family (macOS dynamic-linker variables); everything else is an exact match. */
function isReservedExposeName(name: string): boolean {
	return EXPOSE_DENYLIST.has(name) || LIB_SEAM_VARS.has(name) || name.startsWith('DYLD_');
}

/** `true` when every `${…}` in `value` (if any) is exactly `${PORT}` — the only admitted substitution. */
function hasOnlyPortPlaceholder(value: string): boolean {
	const re = new RegExp(PLACEHOLDER_RE.source, PLACEHOLDER_RE.flags);
	for (let m = re.exec(value); m !== null; m = re.exec(value)) {
		if (m[1] !== 'PORT') { return false; }
	}
	return true;
}

// ── name uniqueness (the graph is name-keyed) ─────────────────────────────

/**
 * The first name declared by two or more entries, or `null` when every name
 * is unique.
 *
 * Checked **before** `findCycle` builds its `Map<name, dependsOn>` — that
 * map silently keeps only the last entry sharing a name, so a duplicate
 * would make cycle detection read one package's edges for both of them
 * (finding 6). A `Map` insertion-ordered by first occurrence is enough to
 * report the name that repeats.
 */
function findDuplicateName(packages: readonly PackageSpec[]): string | null {
	const seen = new Set<string>();
	for (const pkg of packages) {
		if (seen.has(pkg.name)) { return pkg.name; }
		seen.add(pkg.name);
	}
	return null;
}

// ── dependsOn: cycle detection (the one hard parse error) ────────────────

/**
 * Depth-first cycle search over the `dependsOn` graph.
 *
 * A dependency naming an unknown package is not itself a cycle — it is a
 * dead end for this walk, since it has no outgoing edges of its own — so no
 * separate "unknown reference" handling is needed here.
 *
 * @param packages - Already-built entries.
 * @returns The cycle, name by name (repeated name last); `null` when none.
 */
function findCycle(packages: readonly PackageSpec[]): string[] | null {
	const dependsOn = new Map(packages.map(p => [p.name, p.dependsOn ?? []]));
	const state = new Map<string, 'visiting' | 'done'>();
	const chain: string[] = [];

	const visit = (name: string): string[] | null => {
		if (state.get(name) === 'done') { return null; }
		if (state.get(name) === 'visiting') { return [...chain.slice(chain.indexOf(name)), name]; }

		state.set(name, 'visiting');
		chain.push(name);
		for (const dep of dependsOn.get(name) ?? []) {
			const found = visit(dep);
			if (found) { return found; }
		}
		chain.pop();
		state.set(name, 'done');
		return null;
	};

	for (const name of dependsOn.keys()) {
		const found = visit(name);
		if (found) { return found; }
	}
	return null;
}

// ── entry-line grouping ───────────────────────────────────────────────────

/** Groups a `packages:` block's lines into one raw-line array per `- ` entry, at the block's own dash indent. */
function splitPackageEntries(lines: readonly string[]): string[][] {
	const dashLines = lines.filter(l => l.trim().startsWith('- '));
	if (dashLines.length === 0) { return []; }
	const entryIndent = Math.min(...dashLines.map(indentOf));

	const groups: string[][] = [];
	for (const line of lines) {
		if (indentOf(line) === entryIndent && line.trim().startsWith('- ')) {
			groups.push([line]);
		} else if (groups.length > 0) {
			groups.at(-1)?.push(line);
		}
	}
	return groups;
}

/**
 * Splits one entry's raw lines into flat top-level fields and the nested
 * `exposeAs:` map, if declared.
 *
 * `exposeAs` is the only field whose value spans further-indented lines;
 * every other field is a single `key: value` line, so it is carved out
 * first and the remaining lines are read as a flat map exactly like
 * `checks:`'s field parser (`project-parser.helpers.ts`).
 *
 * @param group - One entry's raw lines; the first still carries its `- `.
 * @param warn  - Sink for author-facing problems.
 * @returns The entry's flat fields, plus its validated `exposeAs` map.
 */
function parseEntryLines(
	group: readonly string[], warn: (m: string) => void,
): { fields: Map<string, string>; exposeAs: Record<string, string> } {
	const [first, ...rest] = group;
	// Replaces the dash, not the indent before it — stripping both would zero
	// out the first line's effective column, so a `- exposeAs:` first field
	// (unusual, but not refused elsewhere) computed `headerIndent = 0` and
	// swallowed every sibling field as "nested" (finding 7).
	const flat = [first.replace(/^(\s*)-\s/, '$1  '), ...rest];
	const exposeAs: Record<string, string> = {};
	const kept: string[] = [];

	for (let i = 0; i < flat.length; i++) {
		const header = /^(\s*)exposeAs:\s*$/.exec(flat[i]);
		if (!header) { kept.push(flat[i]); continue; }
		const headerIndent = header[1].length;
		while (i + 1 < flat.length && indentOf(flat[i + 1]) > headerIndent) {
			i++;
			readExposeEntry(flat[i], warn, exposeAs);
		}
	}

	const fields = new Map<string, string>();
	for (const line of kept) {
		const kv = KV_RE.exec(line.trim());
		if (kv && PACKAGE_FIELDS.has(kv[1])) { fields.set(kv[1], kv[2].trim()); }
	}
	return { fields, exposeAs };
}

// ── shared line helpers (own copy — see report: not exported by project-parser.helpers.ts) ──

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

/** Strip one layer of matching quotes, if present. */
function unquote(value: string): string {
	const m = /^"(.*)"$|^'(.*)'$/.exec(value.trim());
	return m ? m[1] ?? m[2] : value.trim();
}

/** Narrow an unknown parse result to `string[]`. */
function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(v => typeof v === 'string');
}
