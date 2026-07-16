import type { LeetCodeDifficulty, LeetCodeStatus, LeetCodeSummary } from '../types/leetcode.types.js';

/** One `{ fileName, parsed }` pair the picker maps into a `QuickPickItemData`. */
export interface QuickPickEntry {
	/** `.md` file name (basename, e.g. `'two-sum.md'`) relative to the LeetCode dir */
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
	return {
		label: `$(${STATUS_ICON[parsed.status]}) ${parsed.title}`,
		description: `${DIFFICULTY_LABEL[parsed.difficulty]} · ${STATUS_LABEL[parsed.status]}`,
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
