import * as assert from 'node:assert';
import { generateProgramBoilerplate } from '../src/services/leetcode-codegen.service.js';
import { defaultPracticeConfig, defaultTestConfig } from '../src/services/leetcode-parser.service.js';
import type { ProgramConfig } from '../src/services/program-config.helpers.js';
import { LEET_OUT_ENV_VAR } from '../src/services/test-envs/program/out-channel.js';
import { SOLUTION_MARKER } from '../src/types/constants.js';
import type { ParsedLeetCode } from '../src/types/leetcode.types.js';

/**
 * T2.6 — every language's `program`-type Layer-1 starter writes its answer to
 * `$LEET_OUT` instead of stdout, and the input-reading shape it offers
 * depends on the declared channel: `argv`/`flags` never construct a stdin
 * reader (`Scanner` / `input()` / `readline` / `read_line`), `stdin` does.
 *
 * `leetcode-codegen-golden.test.ts` pins the pre-existing `call` templates
 * byte-for-byte and is never touched here — this is a wholly new emit path.
 */
suite('leetcode-codegen — program variant', () => {

    function fixture(overrides: Partial<ParsedLeetCode> = {}): ParsedLeetCode {
        return {
            title:        'Two Sum',
            difficulty:   'easy',
            functionName: 'twoSum',
            algorithm:    'hash-map',
            status:       'unsolved',
            params:       [
                { name: 'nums',   type: 'int[]' },
                { name: 'target', type: 'int' },
            ],
            returns:      'int[]',
            description:  '',
            examples:     [],
            tests:        [],
            setups:       [],
            finalTests:   [],
            test:         defaultTestConfig(),
            practice:     defaultPracticeConfig(),
            solutions:    [],
            attempts:     [],
            tags:         [],
            ...overrides,
        };
    }

    const argvConfig: ProgramConfig  = { channel: 'argv' };
    const stdinConfig: ProgramConfig = { channel: 'stdin' };
    const flagsConfig: ProgramConfig = { channel: 'flags', flags: ['--nums', '--target'] };

    // ── java — the first failing test ───────────────────────────────────────

    test('java argv starter writes $LEET_OUT and never constructs a Scanner', () => {
        const src = generateProgramBoilerplate(fixture(), 'java', argvConfig);
        assert.ok(src.includes(`System.getenv("${LEET_OUT_ENV_VAR}")`), src);
        assert.ok(!src.includes('Scanner'), src);
    });

    test('java stdin starter still constructs a Scanner', () => {
        const src = generateProgramBoilerplate(fixture(), 'java', stdinConfig);
        assert.ok(src.includes('Scanner'), src);
        assert.ok(src.includes(`System.getenv("${LEET_OUT_ENV_VAR}")`), src);
    });

    test('java flags starter names each declared flag, no Scanner', () => {
        const src = generateProgramBoilerplate(fixture(), 'java', flagsConfig);
        assert.ok(src.includes('--nums') && src.includes('--target'), src);
        assert.ok(!src.includes('Scanner'), src);
    });

    test('java program boilerplate carries exactly one SOLUTION_MARKER', () => {
        const src = generateProgramBoilerplate(fixture(), 'java', argvConfig);
        assert.strictEqual(src.split(SOLUTION_MARKER).length - 1, 1);
    });

    // ── python ────────────────────────────────────────────────────────────

    test('python argv starter writes $LEET_OUT and never calls input()', () => {
        const src = generateProgramBoilerplate(fixture(), 'python', argvConfig);
        assert.ok(src.includes(`os.environ["${LEET_OUT_ENV_VAR}"]`), src);
        assert.ok(!src.includes('input('), src);
    });

    test('python stdin starter still calls input()', () => {
        const src = generateProgramBoilerplate(fixture(), 'python', stdinConfig);
        assert.ok(src.includes('input('), src);
    });

    // ── javascript ────────────────────────────────────────────────────────

    test('javascript argv starter writes $LEET_OUT and never touches readline/stdin', () => {
        const src = generateProgramBoilerplate(fixture(), 'javascript', argvConfig);
        assert.ok(src.includes(`process.env.${LEET_OUT_ENV_VAR}`), src);
        assert.ok(!src.includes('readline') && !src.includes('process.stdin'), src);
    });

    test('javascript stdin starter still wires up readline', () => {
        const src = generateProgramBoilerplate(fixture(), 'javascript', stdinConfig);
        assert.ok(src.includes('readline'), src);
    });

    // ── typescript ────────────────────────────────────────────────────────

    test('typescript argv starter is typed via mapType and never touches readline', () => {
        const src = generateProgramBoilerplate(fixture(), 'typescript', argvConfig);
        assert.ok(src.includes('function twoSum(nums: number[], target: number): number[]'), src);
        assert.ok(src.includes(`process.env.${LEET_OUT_ENV_VAR}`), src);
        assert.ok(!src.includes('readline'), src);
    });

    // ── rust ──────────────────────────────────────────────────────────────

    test('rust argv starter writes $LEET_OUT and never calls read_line', () => {
        const src = generateProgramBoilerplate(fixture(), 'rust', argvConfig);
        assert.ok(src.includes(`std::env::var("${LEET_OUT_ENV_VAR}")`), src);
        assert.ok(!src.includes('read_line'), src);
    });

    test('rust stdin starter still calls read_line', () => {
        const src = generateProgramBoilerplate(fixture(), 'rust', stdinConfig);
        assert.ok(src.includes('read_line'), src);
    });

    // ── unsupported language ─────────────────────────────────────────────

    test('an unsupported language yields empty program boilerplate', () => {
        assert.strictEqual(generateProgramBoilerplate(fixture(), 'ruby', argvConfig), '');
    });
});
