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

/** One browsable directory level — subfolder names and `.md` file names, nothing else. */
export interface DirLevel {
	/** Subfolder names, alphabetical. Symlinked directories are excluded entirely. */
	dirs: string[];
	/** `.md` file names at this level, in `readDirectory` order (the picker sorts them). */
	files: string[];
}

/**
 * Splits one directory listing into the folders and `.md` files the picker shows.
 *
 * Symlinked directories are dropped rather than listed, so the browser can never be
 * navigated outside the validated vault root (path-containment, security-critical).
 * Folders come back alphabetical because the picker renders them above the files.
 *
 * @param entries - One directory's `[name, type]` pairs, as `readDirectory` returns them.
 * @returns Alphabetical subfolder names plus the level's `.md` file names.
 *
 * @example
 * splitDirEntries([['Strings', 2], ['Arrays', 2], ['two-sum.md', 1]]);
 * // → { dirs: ['Arrays', 'Strings'], files: ['two-sum.md'] }
 */
export function splitDirEntries(entries: readonly DirEntry[]): DirLevel {
	const dirs: string[] = [];
	const files: string[] = [];

	for (const [name, type] of entries) {
		if ((type & FILE_TYPE_DIRECTORY) !== 0) {
			if ((type & FILE_TYPE_SYMBOLIC_LINK) === 0) { dirs.push(name); }
		} else if (name.endsWith('.md')) {
			files.push(name);
		}
	}

	dirs.sort((a, b) => a.localeCompare(b));
	return { dirs, files };
}

/**
 * Folder path of a vault-relative path — `''` when it sits at the root.
 *
 * Shared by the picker's "go up one level" step and the item builder's category label.
 *
 * @param relPath - Vault-relative path, e.g. `'function/arrays/two-sum.md'`.
 * @returns Everything before the last `/`, or `''` when there is none.
 *
 * @example
 * parentPath('function/arrays/two-sum.md'); // → 'function/arrays'
 */
export function parentPath(relPath: string): string {
	const slashIndex = relPath.lastIndexOf('/');
	return slashIndex === -1 ? '' : relPath.slice(0, slashIndex);
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
	const category = parentPath(entry.fileName);
	return {
		label: `$(${STATUS_ICON[parsed.status]}) ${parsed.title}`,
		description: category ? `${category} · ${status}` : status,
		detail: buildDetail(parsed),
		fileName: entry.fileName,
	};
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
