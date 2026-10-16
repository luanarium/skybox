/**
 * Obsidian ships the CodeMirror 6 modules and hands them to plugins at
 * runtime, so they are external to the bundle. `@codemirror/state` and
 * `@codemirror/view` arrive with their own types through the `obsidian`
 * package; these are the few pieces of `@codemirror/commands` the expanded
 * editor uses, declared here rather than pulled in as a dependency.
 */
declare module "@codemirror/commands" {
	import type { Extension } from "@codemirror/state";
	import type { KeyBinding } from "@codemirror/view";

	export const defaultKeymap: readonly KeyBinding[];
	export const historyKeymap: readonly KeyBinding[];
	export function history(config?: { minDepth?: number; newGroupDelay?: number }): Extension;
}
