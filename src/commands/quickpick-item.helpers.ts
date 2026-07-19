import type { LeetCodeDifficulty, LeetCodeStatus, LeetCodeSummary } from '../types/leetcode.types.js';

/**
 * Numeric bits from `vscode.FileType` (`Directory = 2`, `SymbolicLink = 64`), duplicated
 * here so this module stays `vscode`-free and unit-testable — `vscode` stays at the edges
 * per CLAUDE.md. `FileType` is a bitmask: a symlinked directory reports as
 * `Directory | SymbolicLink` (`66`), never a bare `Directory` — callers must test with `&`,
 * never `===`.
 */
export const FILE_TYPE_DIRECTORY = 2;
export const FILE_TYPE_SYMBOLIC_LINK = 64;

/** One `[name, type]` pair as returned by `vscode.workspace.fs.readDirectory`. */
export type DirEntry = readonly [name: string, type: number];

/**
 * Lists one directory's entries by its path relative to the walk root (`''` for the root
 * itself). The only I/O seam `collectMdFilePaths` uses — production wraps
 * `vscode.workspace.fs.readDirectory`, tests supply a fixed in-memory table.
 */
export type DirReader = (relPath: string) => PromiseLike<readonly DirEntry[]>;

/**
 * Recursively walks a directory tree via `readDir`, collecting every `.md` file's path
 * relative to the walk root.
 *
 * Symlinked directories are never descended into — `readDir` is simply never called for
 * one — so a symlink planted under `LeetCode/` cannot walk the recursion outside the
 * validated vault root (path-containment, security-critical). A flat, single-level vault
 * (no subfolders) walks exactly as it did before this function existed.
 *
 * @param readDir  - Lists one directory's entries by relative path.
 * @param basePath - Path already descended, relative to the walk root (`''` at the top).
 * @returns Vault-relative `.md` paths, e.g. `['two-sum.md', 'function/arrays/three-sum.md']`.
 *
 * @example
 * await collectMdFilePaths(readDir); // flat vault → ['two-sum.md']
 */
export async function collectMdFilePaths(readDir: DirReader, basePath = ''): Promise<string[]> {
	const entries = await readDir(basePath);
	const mdFiles: string[] = [];
	const subdirs: string[] = [];

	for (const [name, type] of entries) {
		const relPath = basePath ? `${basePath}/${name}` : name;
		if ((type & FILE_TYPE_DIRECTORY) !== 0) {
			if ((type & FILE_TYPE_SYMBOLIC_LINK) === 0) { subdirs.push(relPath); }
		} else if (name.endsWith('.md')) {
			mdFiles.push(relPath);
		}
	}

	const nested = await Promise.all(subdirs.map(sub => collectMdFilePaths(readDir, sub)));
	return [...mdFiles, ...nested.flat()];
}

/** One `{ fileName, parsed }` pair the picker maps into a `QuickPickItemData`. */
export interface QuickPickEntry {
	/**
	 * Vault-relative path to the `.md` file, e.g. `'two-sum.md'` or
	 * `'function/arrays/two-sum.md'`. The segment before the last `/` (if any) becomes the
	 * description's category label.
	 */
	fileName: string;
	/** Frontmatter summary — from either the full parse or `parseFrontmatterOnly` */
	parsed: LeetCodeSummary;
}

/** Plain, `vscode`-free shape mapping 1:1 onto a `vscode.QuickPickItem` plus its source file. */
export interface QuickPickItemData {
	/** `$(icon) Title` — icon reflects solve status */
	label: string;
	/** Inline, right of the label — `"Difficulty · Status"` */
	description: string;
	/** Second line — `"algorithm · #tag #tag"`, empty string when neither is present */
	detail: string;
	/** Source `.md` file name, carried through so the picker can resolve back to a URI */
	fileName: string;
}

const STATUS_ICON: Record<LeetCodeStatus, string> = {
	unsolved: 'circle-large-outline',
	attempted: 'warning',
	solved: 'check',
};

const STATUS_LABEL: Record<LeetCodeStatus, string> = {
	unsolved: 'Unsolved',
	attempted: 'Attempted',
	solved: 'Solved',
};

const STATUS_ORDER: Record<LeetCodeStatus, number> = {
	unsolved: 0,
	attempted: 1,
	solved: 2,
};

const DIFFICULTY_LABEL: Record<LeetCodeDifficulty, string> = {
	easy: 'Easy',
	medium: 'Medium',
	hard: 'Hard',
};

const DIFFICULTY_ORDER: Record<LeetCodeDifficulty, number> = {
	easy: 0,
	medium: 1,
	hard: 2,
};

/**
 * Maps parsed exercise summaries to sorted `QuickPickItemData` for the
 * exercise picker — richer than a bare filename label so the solver can see
 * difficulty, solve status, algorithm, and tags before opening a file.
 *
 * Sort order: unsolved exercises first (then attempted, then solved), and
 * within the same status, easy before medium before hard; ties break
 * alphabetically by title.
 *
 * @param entries - `{ fileName, parsed }` pairs, one per `.md` file.
 * @returns Sorted `QuickPickItemData[]`, ready for `vscode.window.showQuickPick`.
 *
 * @example
 * buildQuickPickItems([{ fileName: 'two-sum.md', parsed: { title: 'Two Sum', difficulty: 'easy', status: 'unsolved', tags: [] } }]);
 * // → [{ label: '$(circle-large-outline) Two Sum', description: 'Easy · Unsolved', detail: '', fileName: 'two-sum.md' }]
 */
export function buildQuickPickItems(entries: QuickPickEntry[]): QuickPickItemData[] {
	return [...entries]
		.sort((a, b) => compareEntries(a.parsed, b.parsed))
		.map(buildQuickPickItem);
}

/** Build a single `QuickPickItemData` from one `{ fileName, parsed }` pair. */
function buildQuickPickItem(entry: QuickPickEntry): QuickPickItemData {
	const { parsed } = entry;
	const status = `${DIFFICULTY_LABEL[parsed.difficulty]} · ${STATUS_LABEL[parsed.status]}`;
	const category = categoryOf(entry.fileName);
	return {
		label: `$(${STATUS_ICON[parsed.status]}) ${parsed.title}`,
		description: category ? `${category} · ${status}` : status,
		detail: buildDetail(parsed),
		fileName: entry.fileName,
	};
}

/** Folder path of a vault-relative `.md` path — `''` for a root-level file (flat vault). */
function categoryOf(fileName: string): string {
	const slashIndex = fileName.lastIndexOf('/');
	return slashIndex === -1 ? '' : fileName.slice(0, slashIndex);
}

/** Build the detail line — `"algorithm · #tag #tag"`, omitting whichever half is absent. */
function buildDetail(parsed: LeetCodeSummary): string {
	const parts: string[] = [];
	if (parsed.algorithm) { parts.push(parsed.algorithm); }
	if (parsed.tags.length > 0) { parts.push(parsed.tags.map(t => `#${t}`).join(' ')); }
	return parts.join(' · ');
}

/** Comparator implementing the unsolved-first, then-by-difficulty, then-alphabetical sort. */
function compareEntries(a: LeetCodeSummary, b: LeetCodeSummary): number {
	const statusDelta = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
	if (statusDelta !== 0) { return statusDelta; }

	const difficultyDelta = DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty];
	if (difficultyDelta !== 0) { return difficultyDelta; }

	return a.title.localeCompare(b.title);
}
