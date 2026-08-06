/**
 * The **leetcode-type axis**: what an artifact *is*.
 *
 * ⚠️ One character from its neighbour, and they are not the same file:
 *
 * - `leetcode-type.ts`  (this file, singular + hyphen) — the **axis**.
 *   `LeetcodeTypeId`, `LEETCODE_TYPES`, `shapeOf`. Answers *what kind of thing
 *   is this exercise — one buffer, one package, several packages?*
 * - `leetcode.types.ts` (plural + dot) — the artifact's **domain types**.
 *   `LeetCodeExercise`, `TestConfig`, `TestTypeId`, and friends.
 *
 * The two axes are declared independently: this one in frontmatter
 * (`leetcodeType`), the other as `test.type` or a check's `kind`. One value
 * used to answer both questions, which is why four test types were reserved
 * and why `service` could be opened but never graded.
 */

/**
 * What an artifact is, on disk.
 *
 * - `function` — one candidate buffer per language, a bare top-level callable
 * - `package`  — one buildable unit in one language (Java package, Python
 *   package, Rust crate, TS/JS package). **One file or many.**
 * - `stack`    — several packages, each with its own language and ecosystem,
 *   running concurrently and wired to each other at boot
 */
export type LeetcodeTypeId = 'function' | 'package' | 'stack';

/**
 * How many trees an artifact materialises when it is solved.
 *
 * This is the single field `isMultiFile` reads: anything that is not a
 * `buffer` is a file tree, which is the question that predicate was always
 * really asking.
 */
export type LeetcodeShape = 'buffer' | 'tree' | 'trees';

/** One entry in the `LEETCODE_TYPES` table. */
export interface LeetcodeType {
	/** Stable id, as written in the `leetcodeType` frontmatter field */
	id: LeetcodeTypeId;
	/** Whether solving materialises one buffer, one tree, or several */
	shape: LeetcodeShape;
	/** One-line description of what the shape means for a solver */
	description: string;
}

/**
 * The leetcode types, and the shape each one has.
 *
 * The **single** authority for the axis. `isMultiFile` reads the `shape`
 * column directly; the `MULTI_FILE_TYPES` set that used to sit beside it is
 * deleted, because a second list of "which types are trees?" is exactly the
 * drift this table exists to prevent.
 *
 * @example
 * LEETCODE_TYPES.find(row => row.id === 'stack')?.shape; // → 'trees'
 */
export const LEETCODE_TYPES = [
	{
		id: 'function',
		shape: 'buffer',
		description: 'One candidate buffer per language — a bare top-level callable.',
	},
	{
		id: 'package',
		shape: 'tree',
		description: 'One buildable unit in one language: a Java package, a Python package, a Rust crate, a TS/JS package. One file or many.',
	},
	{
		id: 'stack',
		shape: 'trees',
		description: 'Several packages, each with its own language and ecosystem, running concurrently and wired to each other at boot.',
	},
] as const satisfies readonly LeetcodeType[];

/** Membership set for `isLeetcodeType`, derived from the table — never re-listed. */
const LEETCODE_TYPE_IDS: ReadonlySet<string> = new Set(LEETCODE_TYPES.map(row => row.id));

/**
 * Is `value` one of the three declared leetcode types?
 *
 * Takes `unknown` deliberately: the caller is reading untrusted frontmatter,
 * where the value may be absent, a number, a map, or `__proto__`. A `Set`
 * membership test — never a property lookup — so no prototype key answers
 * true.
 *
 * @param value - Anything an artifact's `leetcodeType` field parsed to.
 * @returns True only for `function`, `package` or `stack`.
 *
 * @example
 * isLeetcodeType('package');   // → true
 * isLeetcodeType('project');   // → false — a derivation input, never an id
 * isLeetcodeType('__proto__'); // → false
 */
export function isLeetcodeType(value: unknown): value is LeetcodeTypeId {
	return typeof value === 'string' && LEETCODE_TYPE_IDS.has(value);
}

/**
 * The shape of a leetcode type.
 *
 * @param id - A leetcode type id, already narrowed by `isLeetcodeType`.
 * @returns Its shape.
 * @throws When the id is not in the table — unreachable through the type
 *   system, and a loud failure beats a plausible-looking default that would
 *   quietly grade a tree as a buffer.
 *
 * @example
 * shapeOf('stack');    // → 'trees'
 * shapeOf('function'); // → 'buffer'
 */
export function shapeOf(id: LeetcodeTypeId): LeetcodeShape {
	const row = LEETCODE_TYPES.find(entry => entry.id === id);
	if (!row) {
		throw new Error(`unknown leetcode type: ${id}`);
	}
	return row.shape;
}
