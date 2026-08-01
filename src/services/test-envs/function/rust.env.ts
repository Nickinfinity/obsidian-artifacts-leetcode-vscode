import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { LEET_SENTINEL } from '../../../types/constants.js';
import { escapeRe } from '../../../utils/regex.helpers.js';
import { renderCargoToml } from '../../libs/cargo.installer.js';
import { parseCargoSpec } from '../../libs/lib-spec.helpers.js';
import type { CargoLibSpec } from '../../libs/lib-ecosystem.js';
import { jsonToLiteral } from '../../leetcode-codegen.service.js';
import { functionNameFor } from '../../leetcode-parser.service.js';
import type { EmittedProgram, EnvContext } from '../env.types.js';
import { makeFunctionEnv } from './make-function-env.js';

/** A top-level `fn <name>(`, optionally already `pub` — what a bare Rust fn (never an `impl` method) matches. */
function topLevelFnRe(fn: string): RegExp {
	return new RegExp(String.raw`^(?:pub\s+)?fn\s+${escapeRe(fn)}\s*\(`, 'm');
}

/**
 * Every line-start `fn <name>`, global rather than first-match-only — a decoy
 * `fn <name>` sitting at column 0 inside a comment (harmless to `rustc`, which
 * ignores comments) must not steal a single non-global replace and leave the
 * *real* top-level definition private.
 */
function leadingFnRe(fn: string): RegExp {
	return new RegExp(String.raw`^fn\s+${escapeRe(fn)}\b`, 'gm');
}

/**
 * A legal Rust identifier — what `functionNameFor` must return before it is
 * safe to splice straight into `solution::<fn>(...)` in the generated,
 * executed `runner.rs`.
 *
 * Today an illegal name is caught indirectly: `topLevelFnRe` requires the
 * candidate to literally contain `fn <name>(`, so a name with `(`, `;`, or a
 * space breaks both compilation units and never runs. That's an implicit,
 * fragile invariant — a future change to the candidate model that drops the
 * literal-match requirement would turn a hostile `functions:` override into
 * live code execution inside the generated driver, and this repo has no
 * taint analysis to catch that later. Reject it directly instead of relying
 * on the compile break as the guarantee.
 */
const RUST_IDENT_RE = /^[A-Za-z_]\w*$/;

/**
 * `function × rust` — the candidate is its own compilation unit, linked as a
 * module.
 *
 * The solver's function is written **verbatim** into `solution.rs`; a
 * generated `runner.rs` declares `mod solution;` and calls
 * `solution::<fn>(...)` per case. `rustc -O runner.rs -o runner` pulls
 * `solution.rs` in as a second compilation unit — same two-unit model as Java
 * — so the solver's own `use`s, helpers, and structure survive untouched and
 * cannot collide with the driver's `main`.
 *
 * A module-private `fn` is invisible outside its file, so `candidateContent`
 * rewrites a leading `fn <name>` to `pub fn <name>`; demanding `pub` from the
 * solver would be a hostile contract for a detail the driver invented.
 *
 * No serde: results serialise via a small hand-rolled `LeetJson` trait local
 * to the driver (impls for `i32`, `f64`, `bool`, `String`/`&str`, `Vec<T>`,
 * `Option<T>`, `HashMap<String, T>`), not `{:?}` Debug. Debug looked
 * plausible but isn't canonical: `Vec` Debug-prints `[0, 1]` (comma-space,
 * never matches `canonicalJson`'s `[0,1]`) and `HashMap` Debug order is
 * unspecified — confirmed by actually compiling and running the driver.
 * `leetcode-runner.helpers.ts` compares `actual` by strict string equality
 * against `canonicalJson(expected)` with **no** re-canonicalisation, so the
 * env alone is responsible for exact output — same bar Java's `__json`
 * clears via reflection; Rust clears it via trait dispatch instead. Structs
 * and enums are out of scope for this ceiling; serde is the upgrade (T18).
 */

/**
 * A package name unique to this run's temp directory.
 *
 * Every library-backed Rust run shares one `CARGO_TARGET_DIR` — that shared,
 * pre-warmed `target/` is the whole reason the cargo installer builds — so two
 * suites running at once under the same package name would compile over each
 * other's binary and grade the wrong code. Hash-derived from the run's own
 * directory, never from artifact content.
 *
 * @param libDir - The resolved cache directory (its target dir is shared).
 * @param ctx    - The run context, for a per-run discriminator.
 * @returns A legal crate name, e.g. `leet_ab12cd34`.
 *
 * @example
 * runPackageName('/cache/cargo-9f2c', ctx); // → 'leet_5f1c0f7a'
 */
function runPackageName(libDir: string, ctx: EnvContext): string {
	const seed = `${libDir}\n${ctx.code}\n${ctx.cases.length}`;
	return `leet_${createHash('sha256').update(seed).digest('hex').slice(0, 8)}`;
}

/**
 * The Cargo shape a library-backed run emits instead of the bare `rustc` one.
 *
 * **`run` is `cargo run`, not a path into `target/`.** With
 * `CARGO_TARGET_DIR` pointing into the shared cache, `./target/release/<bin>`
 * does not exist under the run's own `cwd`, and naming the real location would
 * put a cache path inside a command string — the one thing the environment-
 * variable seam exists to avoid. Cargo finds its own binary from the same
 * variable.
 *
 * `compile` stays a real step so a broken candidate fails with a readable
 * message before the run; the pre-warmed target keeps it an incremental link.
 *
 * @param ctx    - The run context; its `parsed.libs.rust` names the crates.
 * @param libDir - Resolved cache directory for this run.
 * @returns Files and commands replacing the `rustc` ones.
 */
function cargoProgram(ctx: EnvContext, libDir: string): Partial<EmittedProgram> {
	const specs = (ctx.parsed.libs?.rust ?? []).flatMap((raw): CargoLibSpec[] => {
		const parsed = parseCargoSpec(raw);
		return parsed.ok ? [parsed.spec] : [];
	});

	return {
		files: [
			{ name: 'Cargo.toml', content: renderCargoToml(runPackageName(libDir, ctx), specs) },
			{ name: path.join('src', 'solution.rs'), content: candidateContent(ctx) },
			{ name: path.join('src', 'main.rs'), content: runnerSource(ctx) },
		],
		compile: 'cargo fetch --offline',
		run: 'cargo run --offline --release --quiet',
	};
}

export const rustFunctionEnv = makeFunctionEnv({
	language: 'rust',
	candidateFile: 'solution.rs',
	runnerFile: 'runner.rs',
	compile: 'rustc -O runner.rs -o runner',
	run: './runner',
	candidateContent,
	buildRunner: runnerSource,
	withLibs: cargoProgram,

	/**
	 * Reject a resolved function name that isn't a legal Rust identifier
	 * (it is spliced straight into `solution::<fn>(...)` in the executed
	 * driver — see `RUST_IDENT_RE`), or a candidate with no top-level
	 * `fn <name>(` for the runner to call.
	 */
	validate(ctx: EnvContext): string | null {
		const fn = functionNameFor(ctx.parsed, ctx.langId);
		if (!RUST_IDENT_RE.test(fn)) {
			return `Rust function name \`${fn}\` is not a legal Rust identifier.`;
		}
		if (!topLevelFnRe(fn).test(ctx.code)) {
			return `Rust setup must define a top-level \`fn ${fn}(…)\` — not a method inside an \`impl\` block.`;
		}
		return null;
	},
});

/**
 * Build `solution.rs` — the candidate verbatim, with its `fn <name>` made
 * `pub` so the generated `runner.rs` can call it as `solution::<name>`.
 *
 * @param ctx - Env context carrying the candidate source.
 * @returns Complete Rust source for the candidate module.
 *
 * @example
 * candidateContent({ code: 'fn f(x: i32) -> i32 { x }', … } as EnvContext);
 * // → 'pub fn f(x: i32) -> i32 { x }\n'
 */
function candidateContent(ctx: EnvContext): string {
	const fn = functionNameFor(ctx.parsed, ctx.langId);
	const rewritten = ctx.code.replace(leadingFnRe(fn), `pub fn ${fn}`);
	return `${rewritten}\n`;
}

/**
 * Build the generated `runner.rs` — declares `mod solution;` and drives the
 * suite against it, one unrolled block per case (return types vary per
 * artifact, so a homogeneous closure vector isn't available the way Java's
 * `Object`-erased `Supplier` is).
 *
 * @param ctx - Parsed artifact and the suite.
 * @returns Complete Rust source for the driver binary.
 *
 * @example
 * runnerSource({ parsed, cases, … } as EnvContext);
 */
function runnerSource(ctx: EnvContext): string {
	const { parsed, cases, langId } = ctx;
	const fn = functionNameFor(parsed, langId);
	const caseBlocks = cases.map((c, i) => {
		const args = parsed.params.map(p => jsonToLiteral(c.input[p.name], 'rust'));
		return caseBlock(fn, args, i);
	});

	return [
		'mod solution;',
		'',
		'use std::collections::HashMap;',
		'use std::io::{self, Write};',
		'use std::panic::{self, AssertUnwindSafe};',
		'use std::time::Instant;',
		'',
		...quoteHelper(),
		'',
		...leetJsonHelper(),
		'',
		...panicMessageHelper(),
		'',
		'fn main() {',
		'\tpanic::set_hook(Box::new(|_| {}));',
		...caseBlocks.flat(),
		'}',
		'',
	].join('\n');
}

/**
 * One case's block in the generated driver — runs `solution::<fn>(args)`
 * inside `catch_unwind`, prints a sentinel line, flushes.
 *
 * Braced as its own scope so each case's `__t0`/`__r`/`__ms` locals don't
 * collide with the next case's.
 *
 * @param fn    - Function name to call (post `functions:` override).
 * @param args  - Rust literal expressions, one per parameter, in order.
 * @param index - Zero-based case index.
 * @returns Tab-indented Rust source lines for the case block.
 *
 * @example
 * caseBlock('twoSum', ['vec![2, 7]', '9'], 0);
 */
function caseBlock(fn: string, args: string[], index: number): string[] {
	return [
		'\t{',
		'\t\tlet __t0 = Instant::now();',
		`\t\tlet __r = panic::catch_unwind(AssertUnwindSafe(|| solution::${fn}(${args.join(', ')})));`,
		'\t\tlet __ms = __t0.elapsed().as_millis();',
		'\t\tmatch __r {',
		'\t\t\tOk(__v) => {',
		`\t\t\t\tprintln!("${LEET_SENTINEL}{{\\"index\\":${index},\\"actual\\":{},\\"ms\\":{}}}", __quote(&__v.leet_json()), __ms);`,
		'\t\t\t}',
		'\t\t\tErr(__e) => {',
		`\t\t\t\tprintln!("${LEET_SENTINEL}{{\\"index\\":${index},\\"error\\":{},\\"ms\\":{}}}", __quote(&__panic_msg(__e)), __ms);`,
		'\t\t\t}',
		'\t\t}',
		'\t\tio::stdout().flush().unwrap();',
		'\t}',
	];
}

/**
 * Source lines for `__quote(&str) -> String` — wrap raw text as an escaped
 * JSON string literal, the same role Java's `__quote` plays. Used both by
 * `LeetJson`'s `String`/`&str` impls and to wrap a panic message.
 *
 * Matches `JSON.stringify`'s escaping exactly: `\` `"` `\n` `\r` `\t` `\b`
 * `\f` get their two-character escapes, every other `U+0000`–`U+001F`
 * control character falls back to `\u00XX` (lowercase hex). Missing that
 * fallback would let a control character in a candidate's string return
 * reach `canonicalJson(expected)` (built via `JSON.stringify` on the
 * extension side) unescaped on one side and escaped on the other — a silent
 * wrong grade, not a crash.
 *
 * @returns Rust source lines, unindented (file scope).
 */
function quoteHelper(): string[] {
	return [
		'fn __quote(s: &str) -> String {',
		'\tlet mut out = String::from("\\"");',
		'\tfor c in s.chars() {',
		'\t\tmatch c {',
		String.raw`			'\\' => out.push_str("\\\\"),`,
		String.raw`			'"' => out.push_str("\\\""),`,
		String.raw`			'\n' => out.push_str("\\n"),`,
		String.raw`			'\r' => out.push_str("\\r"),`,
		String.raw`			'\t' => out.push_str("\\t"),`,
		String.raw`			'\u{8}' => out.push_str("\\b"),`,
		String.raw`			'\u{c}' => out.push_str("\\f"),`,
		'\t\t\t_ if (c as u32) < 0x20 => out.push_str(&format!("\\\\u{:04x}", c as u32)),',
		'\t\t\t_ => out.push(c),',
		'\t\t}',
		'\t}',
		'\tout.push(\'"\');',
		'\tout',
		'}',
	];
}

/**
 * Source lines for the `LeetJson` trait — the canonical serialiser.
 *
 * `{:?}` (Debug) looked like a free canonical form but isn't: it separates
 * `Vec` elements with `", "` (never matches `canonicalJson`'s `[0,1]`) and
 * `HashMap`'s Debug order is unspecified per iteration. This trait instead
 * builds compact, key-sorted JSON text directly, covering every rust type
 * `TYPE_SYNTAX` maps to (`i32`, `f64`, `bool`, `String`, `Vec<T>`,
 * `HashMap<String, T>`) plus `Option<T>` for `None`/nullable params. A
 * whole-number `f64` prints without a decimal point, mirroring Java's
 * `__json` so a `3.0` result still matches an integer `expected`.
 *
 * @returns Rust source lines, unindented (file scope).
 */
function leetJsonHelper(): string[] {
	return [
		'trait LeetJson { fn leet_json(&self) -> String; }',
		'',
		'impl LeetJson for i32 { fn leet_json(&self) -> String { self.to_string() } }',
		'impl LeetJson for bool { fn leet_json(&self) -> String { self.to_string() } }',
		'impl LeetJson for String { fn leet_json(&self) -> String { __quote(self) } }',
		'impl LeetJson for &str { fn leet_json(&self) -> String { __quote(self) } }',
		'impl LeetJson for f64 {',
		'\tfn leet_json(&self) -> String {',
		'\t\tif self.is_finite() && *self == self.trunc() { return (*self as i64).to_string(); }',
		'\t\tself.to_string()',
		'\t}',
		'}',
		'impl<T: LeetJson> LeetJson for Vec<T> {',
		'\tfn leet_json(&self) -> String {',
		'\t\tformat!("[{}]", self.iter().map(|x| x.leet_json()).collect::<Vec<_>>().join(","))',
		'\t}',
		'}',
		'impl<T: LeetJson> LeetJson for Option<T> {',
		'\tfn leet_json(&self) -> String {',
		'\t\tmatch self { Some(v) => v.leet_json(), None => String::from("null") }',
		'\t}',
		'}',
		'impl<V: LeetJson> LeetJson for HashMap<String, V> {',
		'\tfn leet_json(&self) -> String {',
		'\t\tlet mut __keys: Vec<&String> = self.keys().collect();',
		'\t\t__keys.sort();',
		'\t\tlet __body = __keys.iter()',
		'\t\t\t.map(|k| format!("{}:{}", __quote(k), self[*k].leet_json()))',
		'\t\t\t.collect::<Vec<_>>().join(",");',
		'\t\tformat!("{{{}}}", __body)',
		'\t}',
		'}',
	];
}

/**
 * Source lines for `__panic_msg` — downcast a `catch_unwind` payload (the
 * argument a `panic!()` was called with) to a display string.
 *
 * @returns Rust source lines, unindented (file scope).
 */
function panicMessageHelper(): string[] {
	return [
		'fn __panic_msg(e: Box<dyn std::any::Any + Send>) -> String {',
		'\tif let Some(s) = e.downcast_ref::<&str>() { return s.to_string(); }',
		'\tif let Some(s) = e.downcast_ref::<String>() { return s.clone(); }',
		'\tString::from("panic")',
		'}',
	];
}
