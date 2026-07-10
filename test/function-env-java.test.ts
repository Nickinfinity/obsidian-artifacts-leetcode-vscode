import * as assert from 'node:assert';
import {
    javaFunctionEnv,
    stripImportsAndPackage,
} from '../src/services/test-envs/function/java.env.js';
import { defaultPracticeConfig, defaultTestConfig } from '../src/services/leetcode-parser.service.js';
import type { EmittedProgram } from '../src/services/test-envs/env.types.js';
import type { ParsedLeetCode, TestCase } from '../src/types/leetcode.types.js';

/**
 * Unit tests for the `function × java` environment.
 *
 * The candidate is now its own compilation unit (`Solution.java`) driven by a
 * generated `Runner.java`. These assert on the emitted files. `javac` is never
 * spawned here — the suite must stay runnable with no JDK. The end-to-end proof
 * is the manual F5 pass and the scratch e2e script.
 */
suite('function × java env', () => {

    function fixture(overrides: Partial<ParsedLeetCode> = {}): ParsedLeetCode {
        return {
            title: 'Two Sum', difficulty: 'easy', functionName: 'twoSum', status: 'unsolved',
            params: [{ name: 'nums', type: 'int[]' }, { name: 'target', type: 'int' }],
            returns: 'int[]', description: '', examples: [],
            tests: [], finalTests: [], test: defaultTestConfig(),
            setups: [], practice: defaultPracticeConfig(), solutions: [],
            ...overrides,
        };
    }

    const CASES: TestCase[] = [
        { input: { nums: [2, 7], target: 9 }, expected: [0, 1] },
        { input: { nums: [3, 2, 4], target: 6 }, expected: [1, 2] },
    ];

    const CODE = '\tpublic static int[] twoSum(int[] nums, int target) { return new int[]{0, 1}; }';

    const emit = (parsed = fixture(), cases = CASES, code = CODE): EmittedProgram =>
        javaFunctionEnv.emit({ parsed, langId: 'java', code, cases });

    const fileNamed = (p: EmittedProgram, name: string): string => {
        const f = p.files.find(x => x.name === name);
        assert.ok(f, `expected an emitted file ${name}`);
        return f.content;
    };

    // ── Program shape ─────────────────────────────────────────────────────────

    suite('emit — files and commands', () => {

        test('declares the env identity', () => {
            assert.strictEqual(javaFunctionEnv.type, 'function');
            assert.strictEqual(javaFunctionEnv.language, 'java');
        });

        test('emits Solution.java and Runner.java as separate units', () => {
            const p = emit();
            assert.deepStrictEqual(p.files.map(f => f.name).sort(), ['Runner.java', 'Solution.java']);
        });

        test('compiles both files together and runs Runner', () => {
            const p = emit();
            assert.strictEqual(p.compile, 'javac Solution.java Runner.java');
            assert.strictEqual(p.run, 'java -cp . Runner');
        });

        test('the candidate lives in Solution, verbatim, never spliced into the driver', () => {
            const p = emit();
            const solution = fileNamed(p, 'Solution.java');
            const runner = fileNamed(p, 'Runner.java');
            assert.ok(solution.includes('class Solution {'));
            assert.ok(solution.includes('public static int[] twoSum(int[] nums, int target)'));
            // The driver calls into Solution; it does not contain the candidate body.
            assert.ok(!runner.includes('return new int[]{0, 1}'));
        });

        test('the driver never redeclares class Main — the old collision is gone', () => {
            const runner = fileNamed(emit(), 'Runner.java');
            assert.ok(runner.includes('class Runner {'));
            assert.ok(!runner.includes('class Main'));
        });

        test('cases dispatch through Solution.<fn> via a Supplier', () => {
            const runner = fileNamed(emit(), 'Runner.java');
            assert.ok(runner.includes('List<Supplier<Object>> __cases = new ArrayList<>();'));
            assert.ok(runner.includes('__cases.add(() -> Solution.twoSum(new int[]{2, 7}, 9));'));
            assert.ok(runner.includes('} catch (Throwable __e) {'));
        });

        test('the whole suite compiles once — one main, one case per test', () => {
            const runner = fileNamed(emit(), 'Runner.java');
            assert.strictEqual((runner.match(/public static void main/g) ?? []).length, 1);
            assert.strictEqual((runner.match(/__cases\.add/g) ?? []).length, CASES.length);
        });

        test('prints sentinel-prefixed lines and flushes each one', () => {
            const runner = fileNamed(emit(), 'Runner.java');
            assert.ok(runner.includes('"__LEET__"'));
            assert.ok(runner.includes('System.out.flush();'));
        });
    });

    // ── Import hoisting ───────────────────────────────────────────────────────

    suite('candidate imports', () => {

        const WITH_IMPORTS = [
            'package com.nick.leet;',
            '',
            'import java.util.*;',
            'import java.math.BigInteger;',
            '',
            '\tpublic static int[] twoSum(int[] nums, int target) { return new int[]{0, 1}; }',
        ].join('\n');

        test("a stub's own import is hoisted above class Solution, not left inside it", () => {
            const solution = fileNamed(emit(fixture(), CASES, WITH_IMPORTS), 'Solution.java');
            const lines = solution.split('\n');
            const classAt  = lines.findIndex(l => l.startsWith('class Solution'));
            const importAt = lines.findIndex(l => l.includes('import java.math.BigInteger;'));
            assert.ok(importAt !== -1, 'candidate import must survive');
            assert.ok(importAt < classAt, 'javac: an import inside a class body is illegal');
        });

        test('no import line appears after the class declaration', () => {
            const solution = fileNamed(emit(fixture(), CASES, WITH_IMPORTS), 'Solution.java');
            const lines = solution.split('\n');
            const classAt = lines.findIndex(l => l.startsWith('class Solution'));
            const after = lines.slice(classAt).filter(l => /^\s*import\s/.test(l));
            assert.deepStrictEqual(after, []);
        });

        test('a package declaration never reaches the generated file', () => {
            const solution = fileNamed(emit(fixture(), CASES, WITH_IMPORTS), 'Solution.java');
            assert.ok(!solution.includes('package com.nick.leet'));
        });

        test('stripImportsAndPackage lifts imports and drops package', () => {
            const { imports, body } = stripImportsAndPackage('package a.b;\nimport java.util.*;\n\nstatic int f(){return 1;}');
            assert.deepStrictEqual(imports, ['import java.util.*;']);
            assert.strictEqual(body, 'static int f(){return 1;}');
        });
    });

    // ── Validation ────────────────────────────────────────────────────────────

    suite('validate', () => {

        const check = (code: string): string | null =>
            javaFunctionEnv.validate!({ parsed: fixture(), langId: 'java', code, cases: CASES });

        test('a bare method passes', () => {
            assert.strictEqual(check(CODE), null);
        });

        test("rejects a candidate wrapping the method in the solver's own class", () => {
            const msg = check('class Main {\n  static void main(String[] a){ print("x"); }\n  public static int[] twoSum(int[] n, int t){ return n; }\n}');
            assert.ok(msg);
            assert.ok(/class/i.test(msg));
        });

        test('rejects a candidate that declares main', () => {
            const msg = check('public static void main(String[] a) {}\npublic static int[] twoSum(int[] n, int t){ return n; }');
            assert.ok(msg);
            assert.ok(/main/i.test(msg));
        });

        test('rejects a candidate missing the expected method name', () => {
            const msg = check('public static int[] solve(int[] n, int t){ return n; }');
            assert.ok(msg);
            assert.ok(/twoSum/.test(msg));
        });

        test('an import above the method does not trip the class check', () => {
            assert.strictEqual(check('import java.util.*;\npublic static int[] twoSum(int[] n, int t){ return n; }'), null);
        });
    });

    // ── The generated __json serialiser ───────────────────────────────────────

    suite('emit — __json serialiser', () => {

        const runner = (): string => fileNamed(emit(), 'Runner.java');

        test('is generated, since Java has no stdlib JSON', () => {
            assert.ok(runner().includes('static String __json(Object o)'));
        });

        test('arrays go through reflection, covering int[] and int[][] alike', () => {
            const src = runner();
            assert.ok(src.includes('o.getClass().isArray()'));
            assert.ok(src.includes('java.lang.reflect.Array.getLength(o)'));
        });

        test("emits '[0,1]' spacing, never Arrays.toString's '[0, 1]'", () => {
            const src = runner();
            assert.ok(!src.includes('Arrays.toString'));
            assert.ok(src.includes("sb.append(',')"));
        });

        test('strings are quoted and escaped; map keys sorted; doubles normalised', () => {
            const src = runner();
            assert.ok(src.includes('if (o instanceof String) { return __quote((String) o); }'));
            assert.ok(src.includes('ks.sort((a, b) -> String.valueOf(a).compareTo(String.valueOf(b)));'));
            assert.ok(src.includes('d == Math.rint(d)'));
        });
    });

    // ── Argument literals ─────────────────────────────────────────────────────

    suite('emit — argument literals', () => {

        test('a matrix argument gets a real int[][] literal, not Object[]', () => {
            const parsed = fixture({ params: [{ name: 'grid', type: 'int[][]' }] });
            const cases: TestCase[] = [{ input: { grid: [[1, 2], [3, 4]] }, expected: 0 }];
            const runner = fileNamed(emit(parsed, cases, '\tpublic static int twoSum(int[][] grid) { return 0; }'), 'Runner.java');
            assert.ok(runner.includes('new int[][]{new int[]{1, 2}, new int[]{3, 4}}'), runner);
        });
    });

    // ── parse ─────────────────────────────────────────────────────────────────

    suite('parse', () => {

        test('round-trips an emitted result line', () => {
            assert.deepStrictEqual(
                javaFunctionEnv.parse('__LEET__{"index":0,"actual":"[0,1]","ms":4}\n'),
                [{ index: 0, actual: '[0,1]', ms: 4 }],
            );
        });

        test('recovers a thrown exception message', () => {
            const stdout = '__LEET__{"index":1,"error":"Index 5 out of bounds","ms":2}\n';
            assert.strictEqual(javaFunctionEnv.parse(stdout)[0].error, 'Index 5 out of bounds');
        });

        test('tolerates stdout truncated mid-line', () => {
            const stdout = '__LEET__{"index":0,"actual":"1","ms":0}\n__LEET__{"index":1,';
            assert.strictEqual(javaFunctionEnv.parse(stdout).length, 1);
        });
    });
});
