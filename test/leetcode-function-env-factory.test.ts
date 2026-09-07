import * as assert from 'node:assert';
import { LEET_SENTINEL } from '../src/types/constants.js';
import { makeFunctionEnv, type FunctionEnvSpec } from '../src/services/test-envs/function/make-function-env.js';
import type { EnvContext } from '../src/services/test-envs/env.types.js';
import type { ParsedLeetCode } from '../src/types/leetcode.types.js';

/**
 * Unit tests for the `makeFunctionEnv` factory — the shared shape the three
 * built-in function envs are assembled from. Verifies the factory wires the
 * per-language spec into a `TestEnv` correctly and owns the identical bits
 * (`type`, the two-file emit shape, `parseSentinelLines`).
 */
suite('makeFunctionEnv', () => {

    function ctx(code: string): EnvContext {
        return { code, parsed: {} as ParsedLeetCode, langId: 'python', cases: [] };
    }

    function spec(overrides: Partial<FunctionEnvSpec> = {}): FunctionEnvSpec {
        return {
            language: 'python',
            candidateFile: 'sol.py',
            runnerFile: 'runner.py',
            run: 'python3 runner.py',
            candidateContent: c => `${c.code}\n`,
            buildRunner: () => 'DRIVER',
            validate: c => (c.code === '' ? 'empty' : null),
            ...overrides,
        };
    }

    test('carries type "call" and the spec language', () => {
        const env = makeFunctionEnv(spec());
        assert.strictEqual(env.type, 'call');
        assert.strictEqual(env.language, 'python');
    });

    test('emit writes candidate verbatim-ish then the driver, in order', () => {
        const env = makeFunctionEnv(spec());
        const { files } = env.emit(ctx('code here'));
        assert.deepStrictEqual(files, [
            { name: 'sol.py', content: 'code here\n' },
            { name: 'runner.py', content: 'DRIVER' },
        ]);
    });

    test('an interpreted language emits no compile step', () => {
        const prog = makeFunctionEnv(spec()).emit(ctx('x'));
        assert.strictEqual('compile' in prog, false);
        assert.strictEqual(prog.run, 'python3 runner.py');
    });

    test('a compiled language carries its compile command', () => {
        const prog = makeFunctionEnv(spec({ compile: 'javac X.java' })).emit(ctx('x'));
        assert.strictEqual(prog.compile, 'javac X.java');
    });

    test('validate delegates to the spec rule', () => {
        const env = makeFunctionEnv(spec());
        assert.strictEqual(env.validate?.(ctx('')), 'empty');
        assert.strictEqual(env.validate?.(ctx('def f(): ...')), null);
    });

    test('parse recovers sentinel-prefixed case lines', () => {
        const env = makeFunctionEnv(spec());
        const out = env.parse(`${LEET_SENTINEL}{"index":0,"actual":"1","ms":2}\n`);
        assert.strictEqual(out.length, 1);
        assert.strictEqual(out[0].index, 0);
        assert.strictEqual(out[0].actual, '1');
    });
});
