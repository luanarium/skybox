/**
 * The hub: one Skybox serving the files it holds, another pulling them.
 *
 * The desktop listens, because only the desktop can; a phone cannot open a
 * socket from a plugin, so the phone always asks. Which direction the files
 * travel is a separate question from who listens, and this first pass answers
 * it the safe way: the asking device takes what it does not have and what it
 * has not touched, and leaves everything else alone. Nothing is overwritten
 * on a guess, because the thing that makes an overwrite safe, a copy of what
 * both sides started from, comes next rather than now.
 *
 * Everything here is the part that needs no network, so it can be tested
 * without one.
 */

/** One file, as the hub describes it. */
export interface HubEntry {
	path: string;
	size: number;
	mtime: number;
	/** SHA-256 of the bytes, which is what decides whether to ask for them. */
	hash: string;
}

/** What a hub says when asked what it holds. */
export interface HubManifest {
	/** The vault's name, so a phone can tell which computer answered. */
	vault: string;
	at: number;
	files: HubEntry[];
}

/** Every request carries this, derived from the phrase, never the phrase. */
export const HUB_KEY_HEADER = "x-skybox-key";

/**
 * The phrase, as both devices mean it.
 *
 * Typed on two keyboards it will differ in case and spacing, and neither
 * difference is one anybody intends, so both are taken out before the phrase
 * becomes a key. What is left is compared as it was typed otherwise: a phrase
 * is a secret, not an identifier.
 */
export function normalizePhrase(phrase: string): string {
	return phrase.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The key both ends hold. The phrase never crosses the network: each side
 * hashes it and the hub compares what it was sent with what it derived, so a
 * wrong phrase is a closed door rather than a hint.
 */
export async function phraseKey(phrase: string): Promise<string> {
	const said = normalizePhrase(phrase);
	if (!said) return "";
	const bytes = new TextEncoder().encode(`skybox hub/${said}`);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return hex(digest);
}

export function hex(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

/** Comparing two keys without letting the clock say which prefix matched. */
export function sameKey(a: string, b: string): boolean {
	if (!a || !b || a.length !== b.length) return false;
	let same = 0;
	for (let i = 0; i < a.length; i++) same |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return same === 0;
}

/**
 * The folders a hub serves: what you named, or, if you named nothing, the
 * folders Skybox already writes to itself. Both ends work this out the same
 * way, so a file the hub will not serve is also one the puller will not ask
 * for.
 */
export function hubFolders(settings: {
	hubFolders: string;
	intakeFolder: string;
	bookmarksFolder: string;
	mailFolder: string;
}): string[] {
	const named = servedFolders(settings.hubFolders);
	if (named.length > 0) return named;
	return servedFolders(
		[settings.intakeFolder, settings.bookmarksFolder, settings.mailFolder].join("\n")
	);
}

/** The folders a hub serves, one per line, as vault-relative paths. */
export function servedFolders(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim().replace(/^\/+|\/+$/g, ""))
		.filter((line) => line.length > 0 && !line.startsWith("#"));
}

/**
 * Whether a path is one this hub will talk about.
 *
 * A served folder is a promise about what leaves the vault, so the checking
 * is done on the way out as well as on the way in: a request for `../..`, for
 * an address of its own, or for Obsidian's configuration is not a mistake to
 * be forgiving about.
 */
export function withinServed(path: string, folders: string[]): boolean {
	const clean = path.replace(/\\/g, "/");
	if (!clean || clean.startsWith("/") || clean.includes("..")) return false;
	if (/^[a-zA-Z]:/.test(clean) || clean.includes("://")) return false;
	if (clean.split("/").some((part) => part === "" || part === "." || part === ".obsidian")) {
		return false;
	}
	if (folders.length === 0) return false;
	return folders.some((folder) => clean === folder || clean.startsWith(`${folder}/`));
}

/** Why a file is being asked for. */
export type PullWhy = "new" | "changed";

export interface PullStep {
	path: string;
	why: PullWhy;
	hash: string;
}

export interface PullPlan {
	/** Files to ask the hub for. */
	fetch: PullStep[];
	/**
	 * Files both sides have changed since they last agreed. Nothing is done
	 * with these yet: merging them is the next slice, and overwriting one
	 * would be the one mistake this cannot take back.
	 */
	collided: string[];
	/** Files changed here and not there, which a later slice will push. */
	ours: string[];
}

/**
 * What to ask for, given what is here, what is there, and what both sides
 * last agreed on.
 *
 * The agreed hashes are the whole reason this is safe without merging. A
 * local file equal to the agreed hash is one nobody here has touched, so the
 * hub's newer copy can replace it. A local file that differs from the agreed
 * hash is somebody's work, and it stays exactly where it is.
 */
export function pullPlan(
	local: Map<string, string>,
	remote: HubEntry[],
	agreed: Map<string, string>
): PullPlan {
	const plan: PullPlan = { fetch: [], collided: [], ours: [] };
	const seen = new Set<string>();

	for (const entry of remote) {
		seen.add(entry.path);
		const here = local.get(entry.path);
		const base = agreed.get(entry.path);

		if (here === undefined) {
			// Never seen here. If we agreed on it once it was deleted since,
			// and a deletion is not something this slice propagates either way.
			if (base === undefined) plan.fetch.push(step(entry, "new"));
			continue;
		}
		if (here === entry.hash) continue;
		if (base !== undefined && here === base) {
			plan.fetch.push(step(entry, "changed"));
			continue;
		}
		if (base !== undefined && entry.hash === base) {
			plan.ours.push(entry.path);
			continue;
		}
		plan.collided.push(entry.path);
	}

	// Files here that the hub has never heard of are ours to offer, later.
	for (const [path, hash] of local) {
		if (seen.has(path)) continue;
		// Agreed and unchanged means the hub dropped it, and a deletion is
		// nothing this slice carries in either direction.
		if (agreed.get(path) !== hash) plan.ours.push(path);
	}

	return plan;
}

function step(entry: HubEntry, why: PullWhy): PullStep {
	return { path: entry.path, hash: entry.hash, why };
}

/** What a sync did, in one sentence, for a notice on a phone. */
export function pullSentence(plan: PullPlan, taken: number, trouble: number): string {
	if (trouble > 0) return `${said(taken)}, and ${trouble} would not come across.`;
	if (plan.fetch.length === 0 && plan.collided.length === 0) {
		return plan.ours.length > 0
			? `Nothing to take. ${plan.ours.length} here the hub has not got.`
			: "Already in step.";
	}
	const parts = [said(taken)];
	if (plan.collided.length > 0) {
		parts.push(`${plan.collided.length} changed on both sides, left alone`);
	}
	if (plan.ours.length > 0) parts.push(`${plan.ours.length} here the hub has not got`);
	return `${parts.join(", ")}.`;
}

function said(taken: number): string {
	if (taken === 0) return "Took nothing";
	return taken === 1 ? "Took one file" : `Took ${taken} files`;
}

/** The hub's own address, however it was typed, with a port if none was. */
export function hubUrl(address: string, port: number, path: string): string {
	const text = address.trim();
	if (!text) return "";
	const withScheme = /^https?:\/\//i.test(text) ? text : `http://${text}`;
	try {
		const url = new URL(withScheme);
		if (!url.port && !/^https:/i.test(withScheme)) url.port = String(port);
		url.pathname = path;
		url.search = "";
		return url.toString();
	} catch {
		return "";
	}
}
