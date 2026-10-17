/**
 * Folders the grid leaves alone.
 *
 * A vault holds things that are not cards: an attachment folder of images
 * that belong inside notes rather than beside them, a templates folder, or —
 * the awkward one — another vault nested inside this one, whose every note
 * would otherwise show up twice. Naming those folders in the settings keeps
 * everything under them out of the index: notes, images and sidecars alike,
 * since "ignore this folder" reads as all of it.
 */

/**
 * One folder per line, or separated by commas. Leading and trailing slashes
 * go, so `/attachments/` and `attachments` are the same folder, and blanks
 * and duplicates are dropped.
 */
export function parseIgnored(raw: string): string[] {
	const seen = new Set<string>();
	for (const piece of raw.split(/[\n,]/)) {
		const folder = piece.trim().replace(/^\/+/, "").replace(/\/+$/, "");
		if (folder) seen.add(folder.toLowerCase());
	}
	return [...seen];
}

/**
 * Whether a path lies in one of those folders. Matching is case-insensitive,
 * because a folder typed into a settings box rarely matches the vault's own
 * capitals, and a vault with two folders differing only in case is a stranger
 * thing than a typo.
 */
export function isIgnored(path: string, folders: string[]): boolean {
	if (folders.length === 0) return false;
	const lower = path.toLowerCase();
	return folders.some((folder) => lower === folder || lower.startsWith(`${folder}/`));
}
