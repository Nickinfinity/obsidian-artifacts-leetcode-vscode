import { LEET_SENTINEL } from '../../../types/constants.js';
import { escapeRe } from '../../../utils/regex.helpers.js';
import { jsonToLiteral } from '../../leetcode-codegen.service.js';
import { functionNameFor } from '../../leetcode-parser.service.js';
import type { EnvContext } from '../env.types.js';
import { makeFunctionEnv } from './make-function-env.js';

/** A top-level `def <fn>(` — column 0, so `import sol; sol.<fn>` resolves. */
function topLevelDefRe(fn: string): RegExp {
	return new RegExp(String.raw`^def ${escapeRe(fn)}\s*\(`, 'm');
}

/**
 * `function × python` — the candidate is imported as a module.
 *
 * The solver's code is written **verbatim** as `sol.py`; a generated
 * `runner.py` loads it with `importlib` and calls `sol.<fn>(...)`. Importing
 * runs the module's top-level code once, but a `if __name__ == "__main__":`
 * guard keeps the solver's own entry point from firing — the module name is
 * `sol`, not `__main__`.
 *
 * `json.dumps(v, sort_keys=True, separators=(',', ':'))` is already exactly the
 * canonical form `canonicalJson` produces, so no custom serialiser is needed.
 * Each emitted line is flushed: Python block-buffers a piped stdout, and a
 * timeout-kill would otherwise discard the lines already produced.
 */
export const pythonFunctionEnv = makeFunctionEnv({
	language: 'python',
	candidateFile: 'sol.py',
	runnerFile: 'runner.py',
	run: 'python3 runner.py',
	candidateContent: ctx => `${ctx.code}\n`,
	buildRunner: runnerSource,

	/** Reject a candidate with no top-level `def <fn>` for the runner to import. */
	validate(ctx: EnvContext): string | null {
		const fn = functionNameFor(ctx.parsed, ctx.langId);
		if (!topLevelDefRe(fn).test(ctx.code)) {
			return `Python setup must define a top-level function \`def ${fn}(…)\` — not nested inside a class.`;
		}
		return null;
	},
});

/**
 * Build the generated `runner.py` — imports `sol` and drives the suite.
 *
 * @param ctx - Parsed artifact and the suite.
 * @returns Complete Python source for the runner.
 *
 * @example
 * runnerSource({ parsed, cases, … });
 */
function runnerSource(ctx: EnvContext): string {
	const { parsed, cases, langId } = ctx;
	const fn = functionNameFor(parsed, langId);
	const argRows = cases.map(c => {
		const args = parsed.params.map(p => jsonToLiteral(c.input[p.name], 'python'));
		return `    [${args.join(', ')}],`;
	});

	return [
		'import json as __json_mod',
		'import sys as __sys',
		'import time as __time',
		'import os as __os',
		'import importlib.util as __ilu',
		'',
		'__here = __os.path.dirname(__os.path.abspath(__file__))',
		'__spec = __ilu.spec_from_file_location("sol", __os.path.join(__here, "sol.py"))',
		'__mod = __ilu.module_from_spec(__spec)',
		'__spec.loader.exec_module(__mod)',
		`__fn = getattr(__mod, ${JSON.stringify(fn)})`,
		'',
		'__cases = [',
		...argRows,
		']',
		'',
		'def __canon(v):',
		"    return __json_mod.dumps(v, sort_keys=True, separators=(',', ':'))",
		'',
		'def __emit(obj):',
		`    __sys.stdout.write(${JSON.stringify(LEET_SENTINEL)} + __json_mod.dumps(obj) + "\\n")`,
		'    __sys.stdout.flush()',
		'',
		'for __i, __a in enumerate(__cases):',
		'    __t0 = __time.time()',
		'    try:',
		'        __r = __fn(*__a)',
		'        __emit({"index": __i, "actual": __canon(__r), "ms": int((__time.time() - __t0) * 1000)})',
		'    except Exception as __e:',
		'        __emit({"index": __i, "error": str(__e), "ms": int((__time.time() - __t0) * 1000)})',
		'',
	].join('\n');
}
