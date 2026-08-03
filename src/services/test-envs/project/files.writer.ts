import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { FileSpec } from '../../../types/leetcode.types.js';

/** Mode for a `role: readonly` file — readable by all, writable by none. */
const READONLY_MODE = 0o444;

/**
 * Segment reserved at **every** depth because a linked `node_modules` (T1's
 * shared package cache) can land there — see {@link resolveContained}. A
 * `stack` artifact links a tree per sub-package (`client/node_modules`,
 * `server/node_modules`), not only at the run root, so the reservation is
 * not limited to the first segment.
 */
const RESERVED_SEGMENT = 'node_modules';

/**
 * Resolve an artifact-declared relative path against the run directory,
 * **throwing** unless the result stays inside it.
 *
 * The single containment authority for the `project` type: the `## Files`
 * writer, the `build` check's optional `dir`, and the `function` check's
 * `file` all go through it, so there is one rule to audit rather than one per
 * call site. The check is done on the *resolved* path, not the raw string —
 * `src/../../escape.ts` contains no leading `..` and would pass a textual test.
 *
 * `..` **inside** a path is fine as long as it lands back inside the root;
 * what is refused is escaping it, an absolute path, an empty path, the root
 * itself, a NUL byte (which truncates a path inside libc), and — once a run
 * directory can hold a `node_modules` populated with symlinks into a *shared*
 * package cache — any path with a `node_modules` **segment at any depth**, not
 * only at the root. A `stack` artifact links a tree per sub-package
 * (`client/node_modules`, `server/node_modules`), so a declared
 * `path=client/node_modules/react/index.js` (or a `build` check's
 * `dir: server/node_modules/react`) would write *through* that deeper link
 * into the cache and contaminate every other exercise sharing it just as
 * surely as a root-level `node_modules/x` would. The check is per
 * normalised segment, never a substring, so `my_node_modules/x` and
 * `client/my_node_modules/x` are unaffected. The comparison is
 * case-insensitive — `NODE_MODULES` names the same directory as
 * `node_modules` on the case-insensitive filesystems this extension actually
 * ships on (APFS, NTFS), so refusing only the lowercase spelling would be a
 * bypassable guard. The trade-off is deliberate and symmetric with the
 * root-only version it replaces: on a case-sensitive filesystem (Linux) a
 * directory genuinely named `NODE_MODULES` at any depth is over-refused —
 * accepted, since a guard whose safety depends on which machine graded the
 * artifact is worse than a uniform one. `normalize('NFKC')` folding a
 * fullwidth `ｎode_modules` to ASCII is the same over-refusal, same trade.
 * Win32 also strips trailing dots/spaces from a path component
 * (`node_modules./x` reaches `node_modules` there) — confirmed *not* to fold
 * on APFS and not worth guarding: the shared-cache symlink this check
 * protects needs `fs.symlink`, which needs elevation or Developer Mode on
 * Windows, and this repo's run paths are POSIX-only regardless.
 *
 * @param runDir  - Absolute path of the run directory.
 * @param relPath - Artifact-declared path — untrusted.
 * @returns Absolute path, guaranteed to be a strict descendant of `runDir`.
 * @throws Error naming the offending path when containment fails.
 *
 * @example
 * resolveContained('/tmp/run', 'src/a.ts');          // → '/tmp/run/src/a.ts'
 * resolveContained('/tmp/run', '../etc/x');          // throws
 * resolveContained('/tmp/run', 'node_modules/x');    // throws — reserved
 */
export function resolveContained(runDir: string, relPath: string): string {
	if (relPath === '' || relPath.includes('\0')) {
		throw new Error(`unsafe path ${JSON.stringify(relPath)}: empty or contains a NUL byte`);
	}
	if (path.isAbsolute(relPath)) {
		throw new Error(`unsafe path '${relPath}': must be relative to the run directory`);
	}

	const root = path.resolve(runDir);
	const full = path.resolve(root, relPath);
	const rel = path.relative(root, full);
	if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
		throw new Error(`unsafe path '${relPath}': escapes the run directory`);
	}
	// Case-insensitively, on **every** segment — not only the first: a `stack`
	// artifact links a tree per sub-package, so a linked `node_modules` can sit
	// at any depth (`client/node_modules`), not just at the run root. APFS
	// (macOS) and NTFS (Windows) treat `NODE_MODULES` and `node_modules` as the
	// same directory on disk, so a case-sensitive compare here would let
	// `path=client/NODE_MODULES/x` walk straight past the guard and through the
	// real (case-insensitive) symlink underneath. `.toLowerCase()` alone is not
	// enough: APFS folds U+017F (`ſ`, LATIN SMALL LETTER LONG S) to `s`, but
	// `'ſ'.toLowerCase()` leaves it unchanged — `node_moduleſ` would then name
	// the real `node_modules` directory on disk while sailing past a bare
	// lowercase compare. `normalize('NFKC')` first folds `ſ` to `s` (and a
	// fullwidth `ｎode_modules` to ASCII) before the case fold runs.
	if (rel.split(path.sep).some((segment) => segment.normalize('NFKC').toLowerCase() === RESERVED_SEGMENT)) {
		throw new Error(
			`unsafe path '${relPath}': '${RESERVED_SEGMENT}' is reserved — it is a symlink into the shared package cache and a write through it would leak into every other exercise`,
		);
	}
	return full;
}

/**
 * Materialise an artifact's `## Files` tree inside the run directory.
 *
 * **Every path is validated before any file is written.** A tree with one bad
 * path writes nothing at all — a partially-written tree would leave the run
 * directory in a state the caller never declared, and (worse) would mean a
 * traversal attempt still got to place the files listed before it.
 *
 * `role` maps to file mode: `readonly` lands without write permission, so the
 * editor refuses edits without needing a per-editor setting that VS Code does
 * not have. `hidden` is about *opening*, not permissions — it is written
 * exactly like an editable file and simply never opened as a tab.
 *
 * @param runDir - Absolute path of the run directory (already created).
 * @param files  - Declared files, in document order.
 * @throws Error when any path escapes the run directory or is declared twice.
 *
 * @example
 * await writeProjectFiles('/tmp/run', [{ path: 'src/a.ts', language: 'typescript', role: 'editable', content: 'x' }]);
 */
export async function writeProjectFiles(runDir: string, files: FileSpec[]): Promise<void> {
	const planned = new Map<string, FileSpec>();
	for (const file of files) {
		const target = resolveContained(runDir, file.path);
		if (planned.has(target)) {
			throw new Error(`duplicate path '${file.path}': two files declare the same location`);
		}
		planned.set(target, file);
	}

	for (const [target, file] of planned) {
		await fs.mkdir(path.dirname(target), { recursive: true });
		await fs.writeFile(target, file.content, 'utf-8');
		// chmod after the write — a 0o444 file cannot be written to on a re-run.
		// ponytail: POSIX mode; Windows maps this to the read-only attribute only
		// partially. Swap for a per-editor readonly API if VS Code ever grows one.
		if (file.role === 'readonly') { await fs.chmod(target, READONLY_MODE); }
	}
}
