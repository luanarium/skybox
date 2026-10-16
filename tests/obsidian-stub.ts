/**
 * Just enough of Obsidian's API for the tests to run under node. The runner
 * points the `obsidian` import at this file; everything here stands in for
 * something the real app provides.
 */

/** Scores an earlier match higher, which is all the ordering tests need. */
export function prepareSimpleSearch(query: string) {
	const needle = query.toLowerCase();
	return (text: string) => {
		const at = text.toLowerCase().indexOf(needle);
		return at === -1 ? null : { score: 10 - at / 100, matches: [[at, at + needle.length]] };
	};
}

export function getAllTags(): string[] {
	return [];
}

export class TFile {}

export class TFolder {}

export function normalizePath(path: string): string {
	return path;
}
