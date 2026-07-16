import * as assert from 'node:assert';
import { estimateBigO } from '../src/services/leetcode-bigo.service.js';

/**
 * Unit tests for the static Big-O heuristic — `estimateBigO`.
 *
 * This is a heuristic over source text, not a real complexity analyser: it
 * counts loop nesting, spots self-recursion, and recognises a handful of
 * well-known library calls (sort). The tests pin down the documented mapping
 * (depth → notation) and the confidence downgrades, across all three
 * supported languages.
 */
suite('leetcode-bigo: estimateBigO', () => {

	// ── no loop → O(1) ───────────────────────────────────────────────────────

	suite('no loop constructs', () => {

		test('java: straight-line arithmetic is O(1), high confidence', () => {
			const code = [
				'public static int f(int a, int b) {',
				'\treturn a + b;',
				'}',
			].join('\n');
			const r = estimateBigO(code, 'java');
			assert.strictEqual(r.notation, 'O(1)');
			assert.strictEqual(r.confidence, 'high');
		});

		test('python: straight-line arithmetic is O(1), high confidence', () => {
			const code = 'def f(a, b):\n\treturn a + b';
			const r = estimateBigO(code, 'python');
			assert.strictEqual(r.notation, 'O(1)');
			assert.strictEqual(r.confidence, 'high');
		});

		test('javascript: straight-line arithmetic is O(1), high confidence', () => {
			const code = 'function f(a, b) {\n\treturn a + b;\n}';
			const r = estimateBigO(code, 'javascript');
			assert.strictEqual(r.notation, 'O(1)');
			assert.strictEqual(r.confidence, 'high');
		});
	});

	// ── single loop → O(n) ───────────────────────────────────────────────────

	suite('single loop', () => {

		test('java: one for loop is O(n)', () => {
			const code = [
				'public static int f(int[] nums) {',
				'\tint sum = 0;',
				'\tfor (int i = 0; i < nums.length; i++) {',
				'\t\tsum += nums[i];',
				'\t}',
				'\treturn sum;',
				'}',
			].join('\n');
			const r = estimateBigO(code, 'java');
			assert.strictEqual(r.notation, 'O(n)');
			assert.strictEqual(r.confidence, 'high');
		});

		test('python: one for loop is O(n)', () => {
			const code = [
				'def f(nums):',
				'\ttotal = 0',
				'\tfor x in nums:',
				'\t\ttotal += x',
				'\treturn total',
			].join('\n');
			const r = estimateBigO(code, 'python');
			assert.strictEqual(r.notation, 'O(n)');
			assert.strictEqual(r.confidence, 'high');
		});

		test('javascript: one while loop is O(n)', () => {
			const code = [
				'function f(nums) {',
				'\tlet i = 0, sum = 0;',
				'\twhile (i < nums.length) {',
				'\t\tsum += nums[i];',
				'\t\ti++;',
				'\t}',
				'\treturn sum;',
				'}',
			].join('\n');
			const r = estimateBigO(code, 'javascript');
			assert.strictEqual(r.notation, 'O(n)');
			assert.strictEqual(r.confidence, 'high');
		});
	});

	// ── two nested → O(n^2) ──────────────────────────────────────────────────

	suite('two nested loops', () => {

		test('java: nested for loops is O(n^2)', () => {
			const code = [
				'public static int f(int[] nums) {',
				'\tint count = 0;',
				'\tfor (int i = 0; i < nums.length; i++) {',
				'\t\tfor (int j = 0; j < nums.length; j++) {',
				'\t\t\tcount++;',
				'\t\t}',
				'\t}',
				'\treturn count;',
				'}',
			].join('\n');
			const r = estimateBigO(code, 'java');
			assert.strictEqual(r.notation, 'O(n^2)');
		});

		test('python: nested for loops is O(n^2)', () => {
			const code = [
				'def f(nums):',
				'\tcount = 0',
				'\tfor i in nums:',
				'\t\tfor j in nums:',
				'\t\t\tcount += 1',
				'\treturn count',
			].join('\n');
			const r = estimateBigO(code, 'python');
			assert.strictEqual(r.notation, 'O(n^2)');
		});

		test('javascript: nested for loops is O(n^2)', () => {
			const code = [
				'function f(nums) {',
				'\tlet count = 0;',
				'\tfor (let i = 0; i < nums.length; i++) {',
				'\t\tfor (let j = 0; j < nums.length; j++) {',
				'\t\t\tcount++;',
				'\t\t}',
				'\t}',
				'\treturn count;',
				'}',
			].join('\n');
			const r = estimateBigO(code, 'javascript');
			assert.strictEqual(r.notation, 'O(n^2)');
		});
	});

	// ── triple nested → O(n^3) ───────────────────────────────────────────────

	suite('triple nested loops', () => {

		test('java: triple nested for loops is O(n^3)', () => {
			const code = [
				'public static int f(int n) {',
				'\tint count = 0;',
				'\tfor (int i = 0; i < n; i++) {',
				'\t\tfor (int j = 0; j < n; j++) {',
				'\t\t\tfor (int k = 0; k < n; k++) {',
				'\t\t\t\tcount++;',
				'\t\t\t}',
				'\t\t}',
				'\t}',
				'\treturn count;',
				'}',
			].join('\n');
			const r = estimateBigO(code, 'java');
			assert.strictEqual(r.notation, 'O(n^3)');
		});

		test('python: triple nested for loops is O(n^3)', () => {
			const code = [
				'def f(n):',
				'\tcount = 0',
				'\tfor i in range(n):',
				'\t\tfor j in range(n):',
				'\t\t\tfor k in range(n):',
				'\t\t\t\tcount += 1',
				'\treturn count',
			].join('\n');
			const r = estimateBigO(code, 'python');
			assert.strictEqual(r.notation, 'O(n^3)');
		});

		test('javascript: triple nested for loops is O(n^3)', () => {
			const code = [
				'function f(n) {',
				'\tlet count = 0;',
				'\tfor (let i = 0; i < n; i++) {',
				'\t\tfor (let j = 0; j < n; j++) {',
				'\t\t\tfor (let k = 0; k < n; k++) {',
				'\t\t\t\tcount++;',
				'\t\t\t}',
				'\t\t}',
				'\t}',
				'\treturn count;',
				'}',
			].join('\n');
			const r = estimateBigO(code, 'javascript');
			assert.strictEqual(r.notation, 'O(n^3)');
		});
	});

	// ── loop + library sort → O(n log n) ─────────────────────────────────────

	suite('loop calling a sort', () => {

		test('java: Arrays.sort alongside a loop dominates to O(n log n)', () => {
			const code = [
				'public static int[] f(int[] nums) {',
				'\tjava.util.Arrays.sort(nums);',
				'\tfor (int i = 0; i < nums.length; i++) {',
				'\t\tnums[i] = nums[i] * 2;',
				'\t}',
				'\treturn nums;',
				'}',
			].join('\n');
			const r = estimateBigO(code, 'java');
			assert.strictEqual(r.notation, 'O(n log n)');
			assert.strictEqual(r.confidence, 'medium');
		});

		test('python: sorted() alongside a loop dominates to O(n log n)', () => {
			const code = [
				'def f(nums):',
				'\tnums = sorted(nums)',
				'\tfor i in range(len(nums)):',
				'\t\tnums[i] *= 2',
				'\treturn nums',
			].join('\n');
			const r = estimateBigO(code, 'python');
			assert.strictEqual(r.notation, 'O(n log n)');
			assert.strictEqual(r.confidence, 'medium');
		});

		test('javascript: .sort() alongside a loop dominates to O(n log n)', () => {
			const code = [
				'function f(nums) {',
				'\tnums.sort((a, b) => a - b);',
				'\tfor (let i = 0; i < nums.length; i++) {',
				'\t\tnums[i] *= 2;',
				'\t}',
				'\treturn nums;',
				'}',
			].join('\n');
			const r = estimateBigO(code, 'javascript');
			assert.strictEqual(r.notation, 'O(n log n)');
			assert.strictEqual(r.confidence, 'medium');
		});

		test('a bare sort call with no explicit loop is still O(n log n)', () => {
			const code = 'def f(nums):\n\treturn sorted(nums)';
			const r = estimateBigO(code, 'python');
			assert.strictEqual(r.notation, 'O(n log n)');
		});
	});

	// ── self-recursion, no memo → O(2^n)?, low confidence ────────────────────

	suite('self-recursion without memoization', () => {

		test('java: naive fib recursion is flagged O(2^n)? at low confidence', () => {
			const code = [
				'public static int fib(int n) {',
				'\tif (n <= 1) { return n; }',
				'\treturn fib(n - 1) + fib(n - 2);',
				'}',
			].join('\n');
			const r = estimateBigO(code, 'java', 'fib');
			assert.strictEqual(r.notation, 'O(2^n)?');
			assert.strictEqual(r.confidence, 'low');
		});

		test('python: naive fib recursion is flagged O(2^n)? at low confidence', () => {
			const code = [
				'def fib(n):',
				'\tif n <= 1:',
				'\t\treturn n',
				'\treturn fib(n - 1) + fib(n - 2)',
			].join('\n');
			const r = estimateBigO(code, 'python', 'fib');
			assert.strictEqual(r.notation, 'O(2^n)?');
			assert.strictEqual(r.confidence, 'low');
		});

		test('javascript: naive fib recursion is flagged O(2^n)? at low confidence', () => {
			const code = [
				'function fib(n) {',
				'\tif (n <= 1) { return n; }',
				'\treturn fib(n - 1) + fib(n - 2);',
				'}',
			].join('\n');
			const r = estimateBigO(code, 'javascript', 'fib');
			assert.strictEqual(r.notation, 'O(2^n)?');
			assert.strictEqual(r.confidence, 'low');
		});

		test('no recursion flag when functionName is not supplied', () => {
			const code = [
				'function fib(n) {',
				'\tif (n <= 1) { return n; }',
				'\treturn fib(n - 1) + fib(n - 2);',
				'}',
			].join('\n');
			const r = estimateBigO(code, 'javascript');
			assert.notStrictEqual(r.notation, 'O(2^n)?');
		});
	});

	// ── for token inside a string/comment is ignored ─────────────────────────

	suite('a for/while token inside a string or comment is not a loop', () => {

		test('java: string literal and line comment mentioning for/while', () => {
			const code = [
				'public static int f(int n) {',
				'\tString s = "for (int i = 0; i < n; i++) {}"; // while (true) {}',
				'\treturn s.length();',
				'}',
			].join('\n');
			const r = estimateBigO(code, 'java');
			assert.strictEqual(r.notation, 'O(1)');
		});

		test('python: string literal and line comment mentioning for/while', () => {
			const code = [
				'def f(n):',
				'\ts = "for i in range(n): pass"  # while True: pass',
				'\treturn len(s)',
			].join('\n');
			const r = estimateBigO(code, 'python');
			assert.strictEqual(r.notation, 'O(1)');
		});

		test('javascript: string literal and block comment mentioning for/while', () => {
			const code = [
				'function f(n) {',
				'\tconst s = "for (let i = 0; i < n; i++) {}"; /* while (true) {} */',
				'\treturn s.length;',
				'}',
			].join('\n');
			const r = estimateBigO(code, 'javascript');
			assert.strictEqual(r.notation, 'O(1)');
		});
	});

	// ── confidence downgrade: early return inside a loop ─────────────────────

	suite('confidence downgrades on an early return inside a loop', () => {

		test('java: linear search returns inside the loop', () => {
			const code = [
				'public static int f(int[] nums, int target) {',
				'\tfor (int i = 0; i < nums.length; i++) {',
				'\t\tif (nums[i] == target) { return i; }',
				'\t}',
				'\treturn -1;',
				'}',
			].join('\n');
			const r = estimateBigO(code, 'java');
			assert.strictEqual(r.notation, 'O(n)');
			assert.strictEqual(r.confidence, 'medium');
		});

		test('python: linear search returns inside the loop', () => {
			const code = [
				'def f(nums, target):',
				'\tfor i, x in enumerate(nums):',
				'\t\tif x == target:',
				'\t\t\treturn i',
				'\treturn -1',
			].join('\n');
			const r = estimateBigO(code, 'python');
			assert.strictEqual(r.notation, 'O(n)');
			assert.strictEqual(r.confidence, 'medium');
		});

		test('javascript: linear search returns inside the loop', () => {
			const code = [
				'function f(nums, target) {',
				'\tfor (let i = 0; i < nums.length; i++) {',
				'\t\tif (nums[i] === target) { return i; }',
				'\t}',
				'\treturn -1;',
				'}',
			].join('\n');
			const r = estimateBigO(code, 'javascript');
			assert.strictEqual(r.notation, 'O(n)');
			assert.strictEqual(r.confidence, 'medium');
		});
	});

	// ── confidence downgrade: library call of unknown cost ───────────────────

	suite('confidence downgrades on a library call of unknown cost', () => {

		test('java: .contains( inside a loop', () => {
			const code = [
				'public static int f(java.util.List<Integer> nums, int target) {',
				'\tint hits = 0;',
				'\tfor (int i = 0; i < nums.size(); i++) {',
				'\t\tif (nums.contains(target)) { hits++; }',
				'\t}',
				'\treturn hits;',
				'}',
			].join('\n');
			const r = estimateBigO(code, 'java');
			assert.strictEqual(r.notation, 'O(n)');
			assert.strictEqual(r.confidence, 'medium');
		});

		test('python: .count( inside a loop', () => {
			const code = [
				'def f(nums, target):',
				'\thits = 0',
				'\tfor x in nums:',
				'\t\thits += nums.count(target)',
				'\treturn hits',
			].join('\n');
			const r = estimateBigO(code, 'python');
			assert.strictEqual(r.notation, 'O(n)');
			assert.strictEqual(r.confidence, 'medium');
		});

		test('javascript: .indexOf( inside a loop', () => {
			const code = [
				'function f(nums, target) {',
				'\tconst result = [];',
				'\tfor (let i = 0; i < nums.length; i++) {',
				'\t\tif (nums.indexOf(target) !== -1) { result.push(i); }',
				'\t}',
				'\treturn result;',
				'}',
			].join('\n');
			const r = estimateBigO(code, 'javascript');
			assert.strictEqual(r.notation, 'O(n)');
			assert.strictEqual(r.confidence, 'medium');
		});
	});

	// ── stacked downgrades ────────────────────────────────────────────────────

	test('two downgrade triggers on a single high-confidence loop reach low, not medium', () => {
		const code = [
			'function f(nums, target) {',
			'\tfor (let i = 0; i < nums.length; i++) {',
			'\t\tif (nums.indexOf(target) !== -1) { return i; }',
			'\t}',
			'\treturn -1;',
			'}',
		].join('\n');
		const r = estimateBigO(code, 'javascript');
		assert.strictEqual(r.notation, 'O(n)');
		assert.strictEqual(r.confidence, 'low');
	});

	// ── unsupported language ──────────────────────────────────────────────────

	test('an unsupported language reports low confidence rather than guessing', () => {
		const code = 'fn f(n: i32) -> i32 { n }';
		const r = estimateBigO(code, 'rust');
		assert.strictEqual(r.confidence, 'low');
		assert.ok(r.reason.length > 0);
	});

	// ── reason is always non-empty and mentions the notation's story ─────────

	test('reason is always a non-empty explanatory string', () => {
		const code = 'function f() { return 1; }';
		const r = estimateBigO(code, 'javascript');
		assert.ok(r.reason.length > 0);
	});
});
