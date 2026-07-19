import { PRACTICE_OPTIONS } from '../types/constants.js';
import type { PracticeOptionId } from '../types/leetcode.types.js';

/**
 * Flatten the selected option ids into a single `settingKey → value` map.
 *
 * Later options win on key collisions — none collide today, but the map keeps
 * that deterministic rather than order-dependent across two writes. Pure and
 * `vscode`-free (`PracticeMode` owns the actual global-scope writes), so the
 * flattening is unit-testable on its own.
 *
 * @param ids - Selected practice option ids.
 * @returns Map of VS Code setting key to the value to write.
 *
 * @example
 * collectSettings(['noSnippets']); // → Map { 'editor.snippetSuggestions' => 'none', … }
 */
export function collectSettings(ids: PracticeOptionId[]): Map<string, unknown> {
	const out = new Map<string, unknown>();
	for (const option of PRACTICE_OPTIONS) {
		if (!ids.includes(option.id)) { continue; }
		for (const [key, value] of Object.entries(option.settings)) { out.set(key, value); }
	}
	return out;
}
