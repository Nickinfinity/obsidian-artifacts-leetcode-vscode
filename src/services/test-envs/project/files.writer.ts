import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { FileSpec } from '../../../types/leetcode.types.js';

/** Mode for a `role: readonly` file — readable by all, writable by none. */
const READONLY_MODE = 0o444;

/**
 * Resolve an artifact-declared relative path against the run directory,
 * **throwing** unless the result stays inside it.
 *
 * The single containment authority for the `project` type: the `## Files`
 * writer and the `build` check's optional `dir` both go through it, so there is
 * one rule to audit rather than one per call site. The check is done on the
 * *resolved* path, not the raw string — `src/../../escape.ts` contains no
 * leading `..` and would pass a textual test.
 *
 * `..` **inside** a path is fine as long as it lands back inside the root;
 * what is refused is escaping it, an absolute path, an empty path, the root
 * itself, and a NUL byte (which truncates a path inside libc).
 *
 * @param runDir  - Absolute path of the run directory.
 * @param relPath - Artifact-declared path — untrusted.
 * @returns Absolute path, guaranteed to be a strict descendant of `runDir`.
 * @throws Error naming the offending path when containment fails.
 *
 * @example
 * resolveContained('/tmp/run', 'src/a.ts');   // → '/tmp/run/src/a.ts'
 * resolveContained('/tmp/run', '../etc/x');   // throws
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
