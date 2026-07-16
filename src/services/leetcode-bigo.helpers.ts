import { escapeRe } from './leetcode-candidate.helpers.js';

/**
 * Result of scanning a candidate's source for loop constructs.
 *
 * `maxDepth` is the deepest nesting of loop bodies found anywhere in the
 * source (0 when no loop was found at all). `hasEarlyReturn` is true when a
 * `return` or `break` token appears lexically inside a loop body — a signal
 * that the static worst-case count may never actually be reached.
 */
export interface LoopScanResult {
	/** Deepest loop nesting found, 0 when the source has no loop */
	maxDepth: number;
	/** True when a `return`/`break` sits inside at least one loop body */
	hasEarlyReturn: boolean;
}

/** Sort calls recognised per language — a known, well-understood n log n cost. */
const SORT_PATTERNS: Record<string, RegExp[]> = {
	java: [/\bArrays\.sort\s*\(/, /\bCollections\.sort\s*\(/],
	python: [/\bsorted\s*\(/, /\.sort\s*\(/],
	javascript: [/\.sort\s*\(/],
};

/**
 * Library calls recognised per language whose real cost is not O(1) but is
 * easy to miss from a pure loop count — a linear membership check hiding
 * inside what looks like a single pass, for instance.
 *
 * This list is deliberately small and non-exhaustive: it exists to lower
 * confidence on the handful of calls that most often fool a loop-count
 * heuristic, not to model every standard-library method.
 */
const UNKNOWN_COST_PATTERNS: Record<string, RegExp[]> = {
	java: [
		/\.contains\s*\(/, /\.indexOf\s*\(/, /\.replace\s*\(/,
		/String\.join\s*\(/, /Collections\.max\s*\(/, /Collections\.min\s*\(/,
	],
	python: [/\.index\s*\(/, /\.count\s*\(/, /\.join\s*\(/, /\bre\.\w+\s*\(/],
	javascript: [/\.indexOf\s*\(/, /\.includes\s*\(/, /\.join\s*\(/, /\.splice\s*\(/, /\.replace\s*\(/],
};

/** Loose indicator that a recursive solution carries some memoization structure. */
const MEMO_RE = /\b(memo|cache|dp)\b/i;

// ── Comment / string stripping ──────────────────────────────────────────────

/**
 * Strips `//` / `/* *\/` comments and `"…"` / `'…'` / `` `…` `` string
 * literals from Java or JavaScript source, replacing their contents with
 * spaces (newlines preserved) so a `for`/`while` token written inside one is
 * never mistaken for a real loop.
 *
 * A char-by-char scan rather than a single regex: nesting and escapes inside
 * strings (`"\""`) make a one-shot regex unreliable, and this mirrors the
 * line-scanning discipline `stripImportsAndPackage` uses for the same reason
 * — simple state, one pass, no backtracking surprises.
 *
 * @param code - Raw Java or JavaScript candidate source.
 * @returns The same source with comments and string bodies blanked out.
 *
 * @example
 * stripCLikeComments('int x = 1; // for (;;) {}');
 * // → 'int x = 1;                '
 */
export function stripCLikeComments(code: string): string {
	const out: string[] = [];
	let i = 0;
	const n = code.length;

	while (i < n) {
		const ch = code[i];
		const next = code[i + 1];

		if (ch === '/' && next === '/') { i = consumeLineComment(code, i, out); continue; }
		if (ch === '/' && next === '*') { i = consumeBlockComment(code, i, out); continue; }
		if (ch === '"' || ch === '\'' || ch === '`') { i = consumeCLikeString(code, i, ch, out); continue; }

		out.push(ch);
		i++;
	}
	return out.join('');
}

/** Consume a `//` comment up to (not including) the next newline. */
function consumeLineComment(code: string, start: number, out: string[]): number {
	let i = start;
	while (i < code.length && code[i] !== '\n') { out.push(' '); i++; }
	return i;
}

/** Consume a `/* … *\/` comment, preserving embedded newlines. */
function consumeBlockComment(code: string, start: number, out: string[]): number {
	let i = start;
	out.push(' ', ' ');
	i += 2;
	while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) {
		out.push(code[i] === '\n' ? '\n' : ' ');
		i++;
	}
	if (i < code.length) { out.push(' ', ' '); i += 2; }
	return i;
}

/** Consume a quoted string/char/template literal, respecting `\`-escapes. */
function consumeCLikeString(code: string, start: number, quote: string, out: string[]): number {
	let i = start;
	out.push(' ');
	i++;
	while (i < code.length && code[i] !== quote) {
		if (code[i] === '\\' && i + 1 < code.length) { out.push(' ', ' '); i += 2; continue; }
		out.push(code[i] === '\n' ? '\n' : ' ');
		i++;
	}
	if (i < code.length) { out.push(' '); i++; }
	return i;
}

/**
 * Strips `#` comments and `'…'` / `"…"` / triple-quoted string literals from
 * Python source, replacing their contents with spaces (newlines preserved)
 * so a `for`/`while` written inside a string or comment is never counted as
 * a loop.
 *
 * @param code - Raw Python candidate source.
 * @returns The same source with comments and string bodies blanked out.
 *
 * @example
 * stripPythonComments('x = 1  # for i in range(n): pass');
 * // → 'x = 1                             '
 */
export function stripPythonComments(code: string): string {
	const out: string[] = [];
	let i = 0;
	const n = code.length;

	while (i < n) {
		const ch = code[i];
		if (ch === '#') { i = consumeLineComment(code, i, out); continue; }
		if (ch === '"' || ch === '\'') { i = consumePythonString(code, i, ch, out); continue; }
		out.push(ch);
		i++;
	}
	return out.join('');
}

/** Consume a Python string literal — triple-quoted (multi-line) or single-line. */
function consumePythonString(code: string, start: number, quote: string, out: string[]): number {
	const isTriple = code[start + 1] === quote && code[start + 2] === quote;
	if (isTriple) { return consumeTriplePythonString(code, start, quote, out); }

	let i = start;
	out.push(' ');
	i++;
	while (i < code.length && code[i] !== quote && code[i] !== '\n') {
		if (code[i] === '\\' && i + 1 < code.length) { out.push(' ', ' '); i += 2; continue; }
		out.push(' ');
		i++;
	}
	if (i < code.length && code[i] === quote) { out.push(' '); i++; }
	return i;
}

/** Consume a `'''…'''` / `"""…"""` string, preserving embedded newlines. */
function consumeTriplePythonString(code: string, start: number, quote: string, out: string[]): number {
	let i = start;
	out.push(' ', ' ', ' ');
	i += 3;
	while (i < code.length && !(code[i] === quote && code[i + 1] === quote && code[i + 2] === quote)) {
		out.push(code[i] === '\n' ? '\n' : ' ');
		i++;
	}
	if (i < code.length) { out.push(' ', ' ', ' '); i += 3; }
	return i;
}

// ── Loop nesting — brace-delimited languages (Java, JavaScript) ────────────

/**
 * Scans brace-delimited (Java/JavaScript) source, already stripped of
 * comments and strings, for loop nesting depth and early exits.
 *
 * Tracks a stack of `{ … }` blocks, tagging each as a loop body when it is
 * opened by a `for( … )`, `while( … )`, or `do { … } while( … )` header —
 * `if`/function/class braces push a non-loop marker so they nest around a
 * loop without inflating its depth. `return`/`break` tokens are flagged only
 * while at least one loop body is currently open.
 *
 * @param code - Comment/string-stripped Java or JavaScript source.
 * @returns Deepest loop nesting and whether an early exit was found.
 *
 * @example
 * scanBraceLoops('for (int i = 0; i < n; i++) { for (int j = 0; j < n; j++) {} }');
 * // → { maxDepth: 2, hasEarlyReturn: false }
 */
export function scanBraceLoops(code: string): LoopScanResult {
	const stack: boolean[] = [];
	let depth = 0;
	let max = 0;
	let hasEarlyReturn = false;

	for (let i = 0; i < code.length; i++) {
		const ch = code[i];
		if (depth > 0 && (matchesWordAt(code, i, 'return') || matchesWordAt(code, i, 'break'))) {
			hasEarlyReturn = true;
		}
		if (ch === '{') {
			const isLoop = isLoopBrace(code, i);
			stack.push(isLoop);
			if (isLoop) { depth++; if (depth > max) { max = depth; } }
		} else if (ch === '}') {
			if (stack.pop()) { depth--; }
		}
	}
	return { maxDepth: max, hasEarlyReturn };
}

/** True when the character at `i` starts a whole-word match of `word`. */
function matchesWordAt(code: string, i: number, word: string): boolean {
	if (code.slice(i, i + word.length) !== word) { return false; }
	const before = code[i - 1];
	const after = code[i + word.length];
	return !isWordChar(before) && !isWordChar(after);
}

/** True for identifier characters — used to enforce word boundaries manually. */
function isWordChar(c: string | undefined): boolean {
	return !!c && /[A-Za-z0-9_$]/.test(c);
}

/**
 * Whether the `{` at `bracePos` opens a loop body — a `for( … )`/`while( … )`
 * header immediately precedes it, or it is the `{` of a `do { … }`.
 */
function isLoopBrace(code: string, bracePos: number): boolean {
	let j = bracePos - 1;
	while (j >= 0 && /\s/.test(code[j])) { j--; }

	if (code[j] === ')') { return headerWordBeforeParen(code, j) !== null; }

	let wordEnd = j;
	while (j >= 0 && /[A-Za-z_]/.test(code[j])) { j--; }
	return code.slice(j + 1, wordEnd + 1) === 'do';
}

/** Find the `for`/`while` word immediately before the `(` matching the `)` at `closeParenIdx`. */
function headerWordBeforeParen(code: string, closeParenIdx: number): string | null {
	let depth = 1;
	let k = closeParenIdx - 1;
	while (k >= 0 && depth > 0) {
		if (code[k] === ')') { depth++; }
		else if (code[k] === '(') { depth--; }
		k--;
	}
	if (depth !== 0) { return null; }

	let n = k;
	while (n >= 0 && /\s/.test(code[n])) { n--; }
	const wordEnd = n;
	while (n >= 0 && /[A-Za-z_]/.test(code[n])) { n--; }
	const word = code.slice(n + 1, wordEnd + 1);
	return word === 'for' || word === 'while' ? word : null;
}

// ── Loop nesting — indentation-delimited language (Python) ─────────────────

/** One open indentation block on the Python scan stack. */
interface PyBlock { indent: number; loop: boolean }

/**
 * Scans Python source, already stripped of comments and strings, for loop
 * nesting depth and early exits.
 *
 * Python has no braces, so nesting is tracked by indentation: each `for … :`
 * / `while … :` header opens a block at its own indent level, and any line
 * dedenting to or past that level closes it. Comprehension `for` clauses
 * (`[x for x in xs]`) are counted separately per line, since they are a
 * single inline expression rather than an indented block.
 *
 * @param code - Comment/string-stripped Python source.
 * @returns Deepest loop nesting and whether an early exit was found.
 *
 * @example
 * scanPythonLoops('for i in xs:\n\tfor j in xs:\n\t\tpass');
 * // → { maxDepth: 2, hasEarlyReturn: false }
 */
export function scanPythonLoops(code: string): LoopScanResult {
	const lines = code.split('\n');
	const stack: PyBlock[] = [];
	let depth = 0;
	let max = 0;
	let hasEarlyReturn = false;

	for (const raw of lines) {
		const trimmed = raw.trim();
		if (trimmed === '') { continue; }
		const indent = raw.length - raw.trimStart().length;

		while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
			const popped = stack.pop();
			if (popped?.loop) { depth--; }
		}

		if (depth > 0 && /^(return|break)\b/.test(trimmed)) { hasEarlyReturn = true; }

		if (/^(for|while)\b.*:\s*$/.test(trimmed)) {
			stack.push({ indent, loop: true });
			depth++;
			if (depth > max) { max = depth; }
		} else if (trimmed.endsWith(':')) {
			stack.push({ indent, loop: false });
		}
	}

	const comprehensionMax = maxComprehensionDepth(lines);
	return { maxDepth: Math.max(max, comprehensionMax), hasEarlyReturn };
}

/**
 * Deepest count of inline comprehension `for` clauses found on any single
 * line — `[x for x in xs for y in ys]` counts as 2. Statement-level loop
 * headers (already handled by the indentation stack) are skipped here.
 */
function maxComprehensionDepth(lines: string[]): number {
	let max = 0;
	for (const raw of lines) {
		const trimmed = raw.trim();
		if (trimmed.startsWith('for ') || trimmed.startsWith('while ')) { continue; }

		const re = /\bfor\s+\S+\s+in\s+/g;
		let count = 0;
		while (re.exec(trimmed) !== null) { count++; }
		if (count > max) { max = count; }
	}
	return max;
}

// ── Library call recognition ────────────────────────────────────────────────

/**
 * Whether `code` calls a recognised library sort for `lang`.
 *
 * @param code - Comment/string-stripped candidate source.
 * @param lang - `'java'` | `'python'` | `'javascript'`.
 * @returns True when a known sort call was found.
 *
 * @example
 * hasSortCall('Arrays.sort(nums);', 'java'); // → true
 */
export function hasSortCall(code: string, lang: string): boolean {
	return (SORT_PATTERNS[lang] ?? []).some(re => re.test(code));
}

/**
 * Whether `code` calls one of the small set of library functions whose cost
 * is easy to mistake for O(1) from a loop count alone.
 *
 * @param code - Comment/string-stripped candidate source.
 * @param lang - `'java'` | `'python'` | `'javascript'`.
 * @returns True when a recognised unknown-cost call was found.
 *
 * @example
 * hasUnknownCostCall('nums.indexOf(x);', 'javascript'); // → true
 */
export function hasUnknownCostCall(code: string, lang: string): boolean {
	return (UNKNOWN_COST_PATTERNS[lang] ?? []).some(re => re.test(code));
}

/**
 * Loose textual check for a memoization structure (`memo`, `cache`, `dp`)
 * anywhere in the source.
 *
 * @param code - Comment/string-stripped candidate source.
 * @returns True when a memoization-flavoured identifier appears.
 *
 * @example
 * hasMemoIndicator('const memo = new Map();'); // → true
 */
export function hasMemoIndicator(code: string): boolean {
	return MEMO_RE.test(code);
}

/**
 * Whether `code` calls `functionName` on itself — the declaration plus at
 * least one call in call/declaration position (`name(`).
 *
 * Reuses the same call/declaration pattern as `declaresFunction` — a
 * function that mentions its own name at least twice has both declared and
 * invoked itself.
 *
 * @param code         - Comment/string-stripped candidate source.
 * @param functionName - The candidate's own function name.
 * @returns True when `functionName` is self-referential.
 *
 * @example
 * isSelfRecursive('function fib(n){ return fib(n-1); }', 'fib'); // → true
 */
export function isSelfRecursive(code: string, functionName: string): boolean {
	if (!functionName) { return false; }
	const re = new RegExp(String.raw`\b${escapeRe(functionName)}\s*\(`, 'g');
	let count = 0;
	while (re.exec(code) !== null) {
		count++;
		if (count >= 2) { return true; }
	}
	return false;
}
