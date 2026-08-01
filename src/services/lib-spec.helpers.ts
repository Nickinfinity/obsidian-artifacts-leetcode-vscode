/**
 * Allowlist regex for a single library spec: a scoped or unscoped npm-style
 * package name with an optional `@version` range.
 *
 * `^@?[a-zA-Z0-9]` forces the first character to be `@` (scope) or
 * alphanumeric — a leading `-` (flag injection, e.g. `--target=/etc`) or a
 * leading `.`/`/` (traversal, e.g. `../../etc/passwd`, `/etc/passwd`) can
 * never match. The body allows `._/-` (scope separator, dotted/dashed
 * names); a version range after a bare `@` allows `.^~*+-` (semver
 * operators).
 *
 * Linear — no nested quantifiers, no overlapping alternation — safe against
 * ReDoS (Sonar `S8786`). Built once at module scope, not per call.
 *
 * The character class admits `.` and `/` (dotted/scoped names), so the anchor
 * alone stops only a *leading* `..`/`/`. Embedded traversal (`a/../../etc`) is
 * caught separately — see {@link validateLibNames} — because a spec bearing
 * `/` and `..` resolves as a local-path install in pip/npm.
 */
const LIB_SPEC_RE = /^@?[a-zA-Z0-9][a-zA-Z0-9._/-]*(@[a-zA-Z0-9.^~*+-]+)?$/;

/**
 * Whether a name passes the allowlist: it matches the npm-style pattern **and**
 * contains no `..` segment anywhere. A legitimate npm/pip/cargo name never
 * contains `..`, so rejecting it wholesale closes the embedded-traversal hole
 * the leading anchor cannot — defence in depth ahead of T12's `execFile`.
 *
 * @param name - One raw library name.
 * @returns `true` when the name is a safe, installable spec.
 */
function isAllowedLibName(name: string): boolean {
	return LIB_SPEC_RE.test(name) && !name.includes('..');
}

/**
 * Result of validating a list of library names against the allowlist.
 *
 * Discriminated on `ok` so a caller can narrow without an extra null check:
 * `ok: true` carries nothing else to check, `ok: false` carries exactly the
 * rejected entries so a warning can name them.
 */
export type LibNameValidation =
	| { readonly ok: true }
	| { readonly ok: false; readonly invalid: readonly string[] };

/**
 * Validates a list of library names against the npm-style allowlist before
 * they can reach a downstream `execFile` install (T12).
 *
 * This is the trust boundary between untrusted `.md` frontmatter and a
 * subprocess call: every entry must be a bare scoped/unscoped package name
 * with an optional `@version`, so shell-flag-shaped (`--target=/etc`),
 * path-traversal-shaped (`../../etc/passwd`), and empty entries are all
 * rejected here rather than reaching argv construction.
 *
 * @param names - Raw library names as written in `.md` frontmatter.
 * @returns `{ ok: true }` when every name matches the allowlist, otherwise
 *   `{ ok: false, invalid }` naming every entry that did not.
 *
 * @example
 * validateLibNames(['lodash', '@types/node@^20']); // → { ok: true }
 * validateLibNames(['lodash@4', '--target=/etc']);
 * // → { ok: false, invalid: ['--target=/etc'] }
 */
export function validateLibNames(names: readonly string[]): LibNameValidation {
	const invalid = names.filter(name => !isAllowedLibName(name));
	return invalid.length === 0 ? { ok: true } : { ok: false, invalid };
}

/**
 * The bare package name of a lib spec, with any `@version` range removed.
 *
 * Only the **last** `@` can open a version range: the allowlist admits at most
 * one more, and only at index 0 as a scope marker, so `lastIndexOf` cannot
 * mistake `@types/node` (no range) for a versioned name.
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

