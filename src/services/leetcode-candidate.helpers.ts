import { SOLUTION_MARKER } from '../types/constants.js';
import type { ParsedLeetCode } from '../types/leetcode.types.js';
import { injectSolution, mapType } from './leetcode-codegen.service.js';

/**
 * Normalise a candidate's source into something a test environment can embed.
 *
 * An env emits its own driver and calls `parsed.functionName` directly, so the
 * candidate must be a bare declaration of that function — never a program with
 * its own `main`, and never a stdin reader. Three shapes arrive here:
 *
 * 1. **Carries `<<SOLUTION>>`** — a Layer-3 override wrapper. The marker is
 *    stripped and the rest used as-is.
 * 2. **Declares the function** — the normal path: a `# Setup` stub the solver
 *    filled in, or a stored `# Solutions` block. Used verbatim.
 * 3. **A bare body** (`return a + b;`) — wrapped in a minimal declaration.
 *
 * Case 3 deliberately does **not** call `generateBoilerplate()`: that template
 * reads arguments from stdin, and an env driver supplies them as literals, so
 * the generated program would block on a stdin that never arrives.
 *
 * @param parsed - Parsed artifact — supplies the function name and signature.
 * @param langId - Canonical `languageId`.
 * @param code   - Candidate source in one of the three shapes above.
 * @returns Source declaring `parsed.functionName` and nothing else.
 *
 * @example
 * buildExecutable(parsed, 'javascript', 'return a + b;');
 * // → 'function add(a, b) {\n\treturn a + b;\n}'
 */
export function buildExecutable(parsed: ParsedLeetCode, langId: string, code: string): string {
	if (code.includes(SOLUTION_MARKER)) { return injectSolution(code, ''); }
	if (declaresFunction(code, parsed.functionName)) { return code; }
	return wrapBareBody(parsed, langId, code);
}

/**
 * Whether `code` already declares `functionName`.
 *
 * A call site (`twoSum(nums, 9)`) also matches, but a bare body containing a
 * recursive self-call is already a declaration's worth of code — wrapping it
 * would be wrong anyway, so the false positive is benign.
 *
 * @param code         - Candidate source.
 * @param functionName - Name the artifact expects.
 * @returns True when the name appears in call/declaration position.
 *
 * @example
 * declaresFunction('function twoSum(a) {}', 'twoSum'); // → true
 */
export function declaresFunction(code: string, functionName: string): boolean {
	if (!functionName) { return false; }
	return new RegExp(String.raw`\b${escapeRe(functionName)}\s*\(`).test(code);
}

/** Escape a string for literal use inside a RegExp. */
export function escapeRe(literal: string): string {
	return literal.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * Wrap a bare function body in a minimal declaration for `langId`.
 *
 * @param parsed - Parsed artifact — function name, params, return type.
 * @param langId - Canonical `languageId`.
 * @param body   - The bare body, e.g. `return a + b;`.
 * @returns A declaration of `parsed.functionName`, or the body unchanged for a
 *   language with no known declaration syntax.
 *
 * @example
 * wrapBareBody(parsed, 'python', 'return a + b');
 * // → 'def add(a, b):\n\treturn a + b'
 */
function wrapBareBody(parsed: ParsedLeetCode, langId: string, body: string): string {
	const names = parsed.params.map(p => p.name).join(', ');

	if (langId === 'python') {
		const indented = body.split('\n').map(l => `\t${l}`).join('\n');
		return `def ${parsed.functionName}(${names}):\n${indented}`;
	}
	if (langId === 'javascript') {
		return `function ${parsed.functionName}(${names}) {\n\t${body}\n}`;
	}
	if (langId === 'java') {
		const ret    = mapType(parsed.returns, 'java');
		const params = parsed.params.map(p => `${mapType(p.type, 'java')} ${p.name}`).join(', ');
		return `\tpublic static ${ret} ${parsed.functionName}(${params}) {\n\t\t${body}\n\t}`;
	}
	return body;
}
