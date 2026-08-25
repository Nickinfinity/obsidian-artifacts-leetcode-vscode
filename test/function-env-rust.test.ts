import * as assert from 'node:assert';
import { rustFunctionEnv } from '../src/services/test-envs/function/rust.env.js';
import { defaultPracticeConfig, defaultTestConfig } from '../src/services/leetcode-parser.service.js';
import type { EmittedProgram } from '../src/services/test-envs/env.types.js';
import type { ParsedLeetCode, TestCase } from '../src/types/leetcode.types.js';

/**
 * Unit tests for the `function × rust` environment.
 *
 * The candidate is its own compilation unit (`solution.rs`) driven by a
 * generated `runner.rs` linked via `mod solution;`. These assert on the
 * emitted source text — `rustc` is never spawned here so the suite stays
 * runnable with no Rust toolchain. The end-to-end proof is a scratch script
 * that actually compiles and runs the emitted program (see task report).
 */
suite('function × rust env', () => {

    function fixture(overrides: Partial<ParsedLeetCode> = {}): ParsedLeetCode {
        return {
            title: 'Two Sum', difficulty: 'easy', functionName: 'twoSum', status: 'unsolved',
            leetcodeType: 'function',
            params: [{ name: 'nums', type: 'int[]' }, { name: 'target', type: 'int' }],
            returns: 'int[]', description: '', examples: [],
            tests: [], finalTests: [], test: defaultTestConfig(),
            setups: [], practice: defaultPracticeConfig(), solutions: [], attempts: [], tags: [],
            ...overrides,
        };
    }

    const CASES: TestCase[] = [
        { input: { nums: [2, 7], target: 9 }, expected: [0, 1] },
        { input: { nums: [3, 2, 4], target: 6 }, expected: [1, 2] },
    ];

    const CODE = 'fn twoSum(nums: Vec<i32>, target: i32) -> Vec<i32> { vec![0, 1] }';

    const emit = (parsed = fixture(), cases = CASES, code = CODE): EmittedProgram =>
        rustFunctionEnv.emit({ parsed, langId: 'rust', code, cases });

    const fileNamed = (p: EmittedProgram, name: string): string => {
        const f = p.files.find(x => x.name === name);
        assert.ok(f, `expected an emitted file ${name}`);
        return f.content;
    };

    // ── emit — files and commands ────────────────────────────────────────────

    suite('emit — files and commands', () => {

        test('declares the env identity', () => {
            assert.strictEqual(rustFunctionEnv.type, 'call');
            assert.strictEqual(rustFunctionEnv.language, 'rust');
        });

        test('emits solution.rs and runner.rs', () => {
            const p = emit();
            assert.deepStrictEqual(p.files.map(f => f.name).sort(), ['runner.rs', 'solution.rs']);
        });

        test('compiles with rustc -O and runs the binary', () => {
            const p = emit();
            assert.strictEqual(p.compile, 'rustc -O runner.rs -o runner');
            assert.strictEqual(p.run, './runner');
        });

        test('the candidate lives in solution.rs, verbatim, never spliced into the driver', () => {
            const runner = fileNamed(emit(), 'runner.rs');
            assert.ok(!runner.includes('vec![0, 1]'));
        });

        test('runner links the candidate as a module, not by splicing its body', () => {
            const runner = fileNamed(emit(), 'runner.rs');
            assert.ok(runner.includes('mod solution;'));
        });

        test('cases call solution::<fn> directly, one unrolled block per case', () => {
            const runner = fileNamed(emit(), 'runner.rs');
            assert.ok(runner.includes('solution::twoSum(vec![2, 7], 9)'));
            assert.ok(runner.includes('solution::twoSum(vec![3, 2, 4], 6)'));
        });

        test('a functions: override is what the driver calls, not functionName', () => {
            const parsed = fixture({ functions: { rust: 'solve' } });
            const overrideCode = 'fn solve(nums: Vec<i32>, target: i32) -> Vec<i32> { vec![0, 1] }';
            const runner = fileNamed(emit(parsed, CASES, overrideCode), 'runner.rs');
            assert.ok(runner.includes('solution::solve(vec![2, 7], 9)'));
        });

        test('one block per case, each in its own scope so locals cannot collide', () => {
            const runner = fileNamed(emit(), 'runner.rs');
            assert.strictEqual((runner.match(/catch_unwind/g) ?? []).length, CASES.length);
        });

        test('prints sentinel-prefixed lines and flushes each one', () => {
            const runner = fileNamed(emit(), 'runner.rs');
            assert.ok(runner.includes('__LEET__'));
            assert.ok(runner.includes('io::stdout().flush().unwrap();'));
        });

        test('installs a no-op panic hook so a caught panic prints no banner', () => {
            const runner = fileNamed(emit(), 'runner.rs');
            assert.ok(runner.includes('panic::set_hook(Box::new(|_| {}));'));
        });

        test('catches a panic via AssertUnwindSafe rather than letting it kill the process', () => {
            const runner = fileNamed(emit(), 'runner.rs');
            assert.ok(runner.includes('panic::catch_unwind(AssertUnwindSafe('));
        });
    });

    // ── candidateContent — pub rewrite ───────────────────────────────────────

    suite('candidateContent', () => {

        test('rewrites a leading `fn <name>` to `pub fn <name>`', () => {
            const solution = fileNamed(emit(), 'solution.rs');
            assert.ok(solution.startsWith('pub fn twoSum(nums: Vec<i32>, target: i32)'));
        });

        test('leaves an already-pub candidate alone (idempotent, no double pub)', () => {
            const alreadyPub = 'pub fn twoSum(nums: Vec<i32>, target: i32) -> Vec<i32> { vec![0, 1] }';
            const solution = fileNamed(emit(fixture(), CASES, alreadyPub), 'solution.rs');
            assert.ok(!solution.includes('pub pub fn'));
            assert.ok(solution.startsWith('pub fn twoSum'));
        });

        test('a helper fn with a different name is left private', () => {
            const withHelper = [
                'fn helper(x: i32) -> i32 { x + 1 }',
                'fn twoSum(nums: Vec<i32>, target: i32) -> Vec<i32> { vec![helper(0), 1] }',
            ].join('\n');
            const solution = fileNamed(emit(fixture(), CASES, withHelper), 'solution.rs');
            assert.ok(solution.includes('fn helper(x: i32) -> i32'));
            assert.ok(!solution.includes('pub fn helper'));
            assert.ok(solution.includes('pub fn twoSum'));
        });

        // Hostile candidate: a decoy `fn twoSum` sitting at column 0 inside a
        // block comment, ahead of the real definition. A non-global first-match
        // replace would rewrite the harmless decoy and leave the *real*
        // definition private — breaking `solution::twoSum(...)` in the driver.
        // The global regex must reach the real one regardless.
        test('a decoy fn at column 0 inside a comment does not steal the only pub rewrite', () => {
            const hostile = [
                '/*',
                'fn twoSum(x) { evil() }',
                '*/',
                'fn twoSum(nums: Vec<i32>, target: i32) -> Vec<i32> { vec![0, 1] }',
            ].join('\n');
            const solution = fileNamed(emit(fixture(), CASES, hostile), 'solution.rs');
            assert.ok(
                /^pub fn twoSum\(nums: Vec<i32>, target: i32\)/m.test(solution),
                `real definition must be pub — got:\n${solution}`,
            );
        });

        test('the candidate file is never asked to read stdin', () => {
            assert.ok(!fileNamed(emit(), 'solution.rs').includes('io::stdin'));
        });
    });

    // ── validate ──────────────────────────────────────────────────────────────

    suite('validate', () => {

        const check = (code: string): string | null =>
            rustFunctionEnv.validate!({ parsed: fixture(), langId: 'rust', code, cases: CASES });

        test('a bare top-level fn passes', () => {
            assert.strictEqual(check(CODE), null);
        });

        test('an already-pub top-level fn passes', () => {
            assert.strictEqual(check('pub fn twoSum(nums: Vec<i32>, target: i32) -> Vec<i32> { vec![0, 1] }'), null);
        });

        test('rejects a method nested inside an impl block', () => {
            const msg = check([
                'struct Solution;',
                'impl Solution {',
                '    fn twoSum(nums: Vec<i32>, target: i32) -> Vec<i32> { nums }',
                '}',
            ].join('\n'));
            assert.ok(msg);
            assert.ok(/impl/i.test(msg));
        });

        test('rejects a candidate defining the wrong name', () => {
            const msg = check('fn solve(nums: Vec<i32>, target: i32) -> Vec<i32> { nums }');
            assert.ok(msg);
            assert.ok(/twoSum/.test(msg));
        });

        test('a functions: override requires the overridden name, not functionName', () => {
            const parsed = fixture({ functions: { rust: 'solve' } });
            const msg = rustFunctionEnv.validate!({ parsed, langId: 'rust', code: CODE, cases: CASES });
            assert.ok(msg);
            assert.ok(/solve/.test(msg));
        });

        // SEC: functionNameFor is untrusted frontmatter, spliced straight into
        // `solution::<fn>(args)` inside the generated, executed runner.rs. It is
        // currently non-exploitable only because the fn-name-must-appear-in-the-
        // candidate check below breaks compilation for an illegal name — an
        // implicit invariant a future candidate-model change could silently drop.
        // validate() must reject an illegal identifier directly, not rely on the
        // compile break.
        test('rejects a functions: override that is not a legal Rust identifier — nothing is emitted', () => {
            const parsed = fixture({ functions: { rust: 'twoSum(); std::process::exit(1); //' } });
            const msg = rustFunctionEnv.validate!({ parsed, langId: 'rust', code: CODE, cases: CASES });
            assert.ok(msg);
            assert.ok(/identifier/i.test(msg));
        });

        test('rejects a name containing a space or semicolon even if otherwise plausible', () => {
            const parsed = fixture({ functions: { rust: 'two sum' } });
            const msg = rustFunctionEnv.validate!({ parsed, langId: 'rust', code: CODE, cases: CASES });
            assert.ok(msg);
            assert.ok(/identifier/i.test(msg));
        });
    });

    // ── emit — argument literals ─────────────────────────────────────────────

    suite('emit — argument literals', () => {

        test('int/array/bool/string/map params render as rust literals via jsonToLiteral', () => {
            const parsed = fixture({
                params: [
                    { name: 'nums', type: 'int[]' },
                    { name: 'flag', type: 'bool' },
                    { name: 'label', type: 'string' },
                ],
            });
            const cases: TestCase[] = [{ input: { nums: [1, 2], flag: true, label: 'hi' }, expected: 0 }];
            const runner = fileNamed(
                rustFunctionEnv.emit({
                    parsed, langId: 'rust', cases,
                    code: 'fn twoSum(nums: Vec<i32>, flag: bool, label: String) -> i32 { 0 }',
                }),
                'runner.rs',
            );
            assert.ok(runner.includes('solution::twoSum(vec![1, 2], true, String::from("hi"))'), runner);
        });
    });

    // ── emit — __quote / LeetJson control-char escaping ──────────────────────

    // SEC: __quote must match JSON.stringify's escaping exactly (\b \f \n \r \t \\
    // \" plus \u00XX for every other control char). canonicalJson on the extension
    // side is built via JSON.stringify; a gap here means a string result containing
    // a control character compares unequal (or, worse, equal by coincidence) to what
    // JS considers canonical — a silent wrong grade, not a crash. The real-rustc
    // proof (compiling and running a candidate returning "a\bb\fc\x01d") is in the
    // task report; these assert the generated source carries the fix.
    suite('emit — __quote control-char escaping', () => {

        const runner = (): string => fileNamed(emit(), 'runner.rs');

        test('escapes backspace and form feed to their two-character JSON forms', () => {
            const src = runner();
            assert.ok(src.includes(String.raw`'\u{8}' => out.push_str("\\b"),`), src);
            assert.ok(src.includes(String.raw`'\u{c}' => out.push_str("\\f"),`), src);
        });

        test('falls back to \\u00XX for any other control character below 0x20', () => {
            const src = runner();
            assert.ok(src.includes('out.push_str(&format!("\\\\u{:04x}", c as u32))'), src);
            assert.ok(src.includes('< 0x20'), src);
        });
    });

    // ── parse ─────────────────────────────────────────────────────────────────

    suite('parse', () => {

        test('round-trips an emitted result line', () => {
            assert.deepStrictEqual(
                rustFunctionEnv.parse('__LEET__{"index":0,"actual":"[0,1]","ms":4}\n'),
                [{ index: 0, actual: '[0,1]', ms: 4 }],
            );
        });

        test('recovers a caught panic message', () => {
            const stdout = '__LEET__{"index":1,"error":"index out of bounds","ms":2}\n';
            assert.strictEqual(rustFunctionEnv.parse(stdout)[0].error, 'index out of bounds');
        });

        test('tolerates stdout truncated mid-line', () => {
            const stdout = '__LEET__{"index":0,"actual":"1","ms":0}\n__LEET__{"index":1,';
            assert.strictEqual(rustFunctionEnv.parse(stdout).length, 1);
        });
    });
});
