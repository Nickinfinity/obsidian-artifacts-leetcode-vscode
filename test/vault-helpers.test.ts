import * as assert from 'node:assert';
import { exercisesSubdir } from '../src/services/vault.helpers.js';

/**
 * Unit tests for exercisesSubdir(useVaultRoot): string — the single, pure
 * resolver for "where do exercises live". `refreshVaultContext` and the
 * picker both call the thin `getExercisesSubdir` wrapper over this, so this
 * pure core is the one place the `LeetCode`-vs-root decision is pinned down.
 */
suite('exercisesSubdir', () => {

    test('default (subfolder mode): resolves to the LeetCode constant', () => {
        assert.strictEqual(exercisesSubdir(false), 'LeetCode');
    });

    test('vault-root mode: resolves to empty string (no subfolder)', () => {
        assert.strictEqual(exercisesSubdir(true), '');
    });

});
