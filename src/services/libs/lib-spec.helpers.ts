import type {
	CargoLibSpec, LibEcosystem, LibSpecParse, MavenLibSpec, NpmLibSpec, ParsedLibSpec, PipLibSpec,
} from './lib-ecosystem.js';

/**
 * Field patterns, one per grammar position.
 *
 * Every one is **anchored**, opens with an alphanumeric class — so a leading
 * `-` (flag injection) or `.` / `/` (traversal) can never match — and contains
 * a single quantifier over a single character class. No alternation overlaps
 * and nothing nests, which is what keeps a 10 000-character spec linear
 * instead of a backtracking hang (Sonar `S8786`).
 */
const NPM_NAME_RE = /^@?[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;
const NPM_RANGE_RE = /^[a-zA-Z0-9.^~*+-]+$/;
const PIP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PIP_EXTRA_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PIP_PRED_RE = /^(==|>=|<=|~=|!=|<|>)[0-9][A-Za-z0-9.*!-]*$/;
const CARGO_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const CARGO_REQ_RE = /^[\^~<>=]{0,2}[0-9][0-9A-Za-z.*-]*$/;
const CARGO_FEATURE_RE = /^[a-z0-9][a-z0-9_-]*$/;
const MAVEN_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Maven versions that resolve to "whatever is newest today".
 *
 * Refused because a cache key is only meaningful when the specs pin what gets
 * installed: two runs of the same key would otherwise hold different jars.
 */
const MAVEN_FLOATING = new Set(['LATEST', 'RELEASE']);

/** Shorthand for the refusal half of {@link LibSpecParse}. */
function refuse(raw: string, why: string): { readonly ok: false; readonly reason: string } {
	return { ok: false, reason: `'${raw}' ${why}` };
}

/**
 * The guard no leading-character anchor can express.
 *
 * A spec beginning with a valid character can still carry `..` further in
 * (`a/../../etc`), and a spec bearing a separator plus `..` resolves as a
 * local-path install in more than one of these ecosystems. No legitimate
 * package name in any of the four contains `..`, so it is refused wholesale.
 *
 * @param raw - One raw spec.
 * @returns `true` when the spec carries a parent-directory segment.
 */
function hasTraversal(raw: string): boolean {
	return raw.includes('..');
}

/**
 * Parse an npm spec: a scoped or unscoped package name with an optional range.
 *
 * The scope stays part of `name` because that is how npm, the cache's warm
 * probe and `node_modules/<name>` all address the package — splitting it out
 * would mean rejoining it at every use.
 *
 * Only the **last** `@` can open a range: the name pattern admits one more and
 * only at index 0 as a scope marker, so `lastIndexOf` cannot mistake
 * `@types/node` for a versioned name.
 *
 * @param raw - One spec exactly as written in `libs:`.
 * @returns The parsed fields, or the reason it was refused.
 *
 * @example
 * parseNpmSpec('@types/node@^20');
 * // → { ok: true, spec: { ecosystem: 'npm', name: '@types/node', range: '^20' } }
 */
export function parseNpmSpec(raw: string): LibSpecParse<NpmLibSpec> {
	if (hasTraversal(raw)) { return refuse(raw, 'contains a parent-directory segment'); }

	const at = raw.lastIndexOf('@');
	const name = at > 0 ? raw.slice(0, at) : raw;
	const range = at > 0 ? raw.slice(at + 1) : undefined;

	if (!NPM_NAME_RE.test(name)) { return refuse(raw, 'is not a plain package name'); }
	if (range !== undefined && !NPM_RANGE_RE.test(range)) {
		return refuse(raw, 'does not carry a plain version range');
	}
	return { ok: true, spec: range === undefined
		? { ecosystem: 'npm', name }
		: { ecosystem: 'npm', name, range } };
}

/**
 * Split `name[a,b]rest` into its three pieces without a nested quantifier.
 *
 * @param raw - One pip spec, already traversal-checked.
 * @returns The name, the raw extras text (`''` when none) and the remainder.
 */
function splitPipExtras(raw: string): { head: string; extras: string; rest: string } | null {
	const open = raw.indexOf('[');
	if (open === -1) { return { head: raw, extras: '', rest: '' }; }

	const close = raw.indexOf(']', open);
	if (close === -1) { return null; }
	return { head: raw.slice(0, open), extras: raw.slice(open + 1, close), rest: raw.slice(close + 1) };
}

/** First index of a version-predicate operator, or `-1`. */
function predicateStart(text: string): number {
	for (let i = 0; i < text.length; i++) {
		if ('<>=!~'.includes(text[i])) { return i; }
	}
	return -1;
}

/**
 * Parse a pip requirement: a name, optional extras, optional predicates.
 *
 * A **bounded subset** of PEP 508. Environment markers (`;`), direct
 * references (`name @ url`), VCS URLs and `-r file` forms are all refused —
 * each of them fetches from, or reads, a location the artifact chose, and a
 * name-shape allowlist can say nothing about a URL.
 *
 * @param raw - One spec exactly as written in `libs:`.
 * @returns The parsed fields, or the reason it was refused.
 *
 * @example
 * parsePipSpec('requests[socks]==2.32.3');
 * // → { ok: true, spec: { ecosystem: 'pip', name: 'requests',
 * //      extras: ['socks'], predicates: ['==2.32.3'] } }
 */
export function parsePipSpec(raw: string): LibSpecParse<PipLibSpec> {
	if (hasTraversal(raw)) { return refuse(raw, 'contains a parent-directory segment'); }

	const split = splitPipExtras(raw);
	if (!split) { return refuse(raw, 'has an unterminated extras list'); }

	const cut = predicateStart(split.head);
	const name = cut === -1 ? split.head : split.head.slice(0, cut);
	if (!PIP_NAME_RE.test(name)) { return refuse(raw, 'is not a plain requirement name'); }

	const extras = split.extras === '' ? [] : split.extras.split(',');
	if (extras.some(extra => !PIP_EXTRA_RE.test(extra))) {
		return refuse(raw, 'declares an extra that is not a plain identifier');
	}

	// Predicates can sit before the extras (`numpy>=2`) or after them
	// (`requests[socks]==2.32.3`), never both — one side is always empty.
	const predicateText = (cut === -1 ? '' : split.head.slice(cut)) + split.rest;
	const predicates = predicateText === '' ? [] : predicateText.split(',');
	if (predicates.some(pred => !PIP_PRED_RE.test(pred))) {
		return refuse(raw, 'declares a version predicate this grammar does not admit');
	}

	return { ok: true, spec: { ecosystem: 'pip', name, extras, predicates } };
}

/**
 * Parse a cargo dependency: a crate, an optional req, and `+`-joined features.
 *
 * A **bounded subset**: no inline TOML reaches this, so `git =`, `path =`,
 * `registry =` and `default-features = false` are all refused by the field
 * patterns rather than by a blacklist of their spellings.
 *
 * Semver build metadata (`1.0.0+build`) is deliberately **not** supported: `+`
 * is this grammar's feature separator, and one character cannot mean both.
 *
 * @param raw - One spec exactly as written in `libs:`.
 * @returns The parsed fields, or the reason it was refused.
 *
 * @example
 * parseCargoSpec('serde@^1+derive+std');
 * // → { ok: true, spec: { ecosystem: 'cargo', name: 'serde', req: '^1',
 * //      features: ['derive', 'std'] } }
 */
export function parseCargoSpec(raw: string): LibSpecParse<CargoLibSpec> {
	if (hasTraversal(raw)) { return refuse(raw, 'contains a parent-directory segment'); }

	const at = raw.indexOf('@');
	const name = at === -1 ? raw : raw.slice(0, at);
	if (!CARGO_NAME_RE.test(name)) { return refuse(raw, 'is not a plain crate name'); }
	if (at === -1) { return { ok: true, spec: { ecosystem: 'cargo', name, features: [] } }; }

	const [req, ...features] = raw.slice(at + 1).split('+');
	if (!CARGO_REQ_RE.test(req)) { return refuse(raw, 'does not carry a plain version requirement'); }
	if (features.some(feature => !CARGO_FEATURE_RE.test(feature))) {
		return refuse(raw, 'declares a feature that is not a plain identifier');
	}

	return { ok: true, spec: { ecosystem: 'cargo', name, req, features } };
}

/**
 * Parse a maven coordinate: `groupId:artifactId:version[:packaging[:classifier]]`.
 *
 * Every segment must be a plain identifier, which is what keeps `<`, `>`, `"`
 * and a repository URL out of the generated `pom.xml` — the renderer escapes
 * as well, but a validated segment gives it nothing to escape.
 *
 * @param raw - One spec exactly as written in `libs:`.
 * @returns The parsed fields, or the reason it was refused.
 *
 * @example
 * parseMavenSpec('com.google.guava:guava:33.3.1');
 * // → { ok: true, spec: { ecosystem: 'maven', groupId: 'com.google.guava',
 * //      artifactId: 'guava', version: '33.3.1' } }
 */
export function parseMavenSpec(raw: string): LibSpecParse<MavenLibSpec> {
	if (hasTraversal(raw)) { return refuse(raw, 'contains a parent-directory segment'); }

	const parts = raw.split(':');
	if (parts.length < 3 || parts.length > 5) {
		return refuse(raw, 'is not a groupId:artifactId:version coordinate');
	}
	if (parts.some(part => !MAVEN_SEGMENT_RE.test(part))) {
		return refuse(raw, 'has a coordinate segment that is not a plain identifier');
	}

	const [groupId, artifactId, version, packaging, classifier] = parts;
	if (MAVEN_FLOATING.has(version)) {
		return refuse(raw, 'pins no version — LATEST and RELEASE are not reproducible');
	}

	const spec: MavenLibSpec = { ecosystem: 'maven', groupId, artifactId, version };
	return { ok: true, spec: {
		...spec,
		...(packaging === undefined ? {} : { packaging }),
		...(classifier === undefined ? {} : { classifier }),
	} };
}

/** One parser per ecosystem — the absence of a fifth entry *is* the scope. */
const PARSERS: Record<LibEcosystem, (raw: string) => LibSpecParse> = {
	npm: parseNpmSpec,
	pip: parsePipSpec,
	cargo: parseCargoSpec,
	maven: parseMavenSpec,
};

/**
 * Validate and parse one raw spec against its ecosystem's grammar.
 *
 * The single door between artifact text and four package managers: nothing
 * downstream re-validates, and nothing downstream may accept a string this
 * refused.
 *
 * @param ecosystem - Registry the spec is written for.
 * @param raw       - One spec exactly as written in `libs:`.
 * @returns The parsed fields, or the reason it was refused.
 *
 * @example
 * parseSpec('cargo', 'serde@^1+derive');
 * // → { ok: true, spec: { ecosystem: 'cargo', name: 'serde', … } }
 * parseSpec('pip', '-r requirements.txt');
 * // → { ok: false, reason: "'-r requirements.txt' is not a plain requirement name" }
 */
export function parseSpec(ecosystem: LibEcosystem, raw: string): LibSpecParse {
	return PARSERS[ecosystem](raw);
}

/**
 * Result of validating a list of npm names against the allowlist.
 *
 * Discriminated on `ok` so a caller can narrow without an extra null check:
 * `ok: true` carries nothing else to check, `ok: false` carries exactly the
 * rejected entries so a warning can name them.
 */
export type LibNameValidation =
	| { readonly ok: true }
	| { readonly ok: false; readonly invalid: readonly string[] };

/**
 * Validates a list of npm library names before they reach an install
 * subprocess.
 *
 * A thin list-shaped wrapper over {@link parseNpmSpec} — the grammar lives
 * there, so the parser and this validator can never disagree about what an
 * installable name is.
 *
 * @param names - Raw library names as written in `libs:`.
 * @returns `{ ok: true }` when every name matches the allowlist, otherwise
 *   `{ ok: false, invalid }` naming every entry that did not.
 *
 * @example
 * validateLibNames(['lodash', '@types/node@^20']); // → { ok: true }
 * validateLibNames(['lodash@4', '--target=/etc']);
 * // → { ok: false, invalid: ['--target=/etc'] }
 */
export function validateLibNames(names: readonly string[]): LibNameValidation {
	const invalid = names.filter(name => !parseNpmSpec(name).ok);
	return invalid.length === 0 ? { ok: true } : { ok: false, invalid };
}

/**
 * The bare package name of an npm spec, with any `@version` range removed.
 *
 * The result names a directory inside a cache's `node_modules`, so callers must
 * have passed it through {@link validateLibNames} first — that is what keeps a
 * `..` segment out of the join.
 *
 * @param spec - One library spec as written in `libs:`.
 * @returns The package name alone.
 *
 * @example
 * packageNameOf('react@^19.0.0');   // → 'react'
 * packageNameOf('@types/node@^20'); // → '@types/node'
 * packageNameOf('@types/node');     // → '@types/node'
 */
export function packageNameOf(spec: string): string {
	const at = spec.lastIndexOf('@');
	return at > 0 ? spec.slice(0, at) : spec;
}

/** Re-exported so a caller can name the union without a second import. */
export type { ParsedLibSpec };
