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
 * What the sender believed the hub's copy was, sent with a change so the hub
 * can refuse it. Without this a push is a blind overwrite: the manifest a
 * device is working from is seconds old, and seconds are enough.
 */
export const HUB_BASE_HEADER = "x-skybox-base";

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

/**
 * What is wrong with what a hub would serve, in one sentence, or nothing at
 * all when there is nothing wrong.
 *
 * A hub that is listening and serving an empty list is the worst of the
 * possible states, because every part of it looks right: the switch is on,
 * the address answers, the phrase matches, and the sync takes nothing and
 * says it is already synced. So the folders are checked against the vault
 * rather than taken on trust, and the answer is said next to the switch.
 */
export function hubComplaint(folders: string[], present: string[]): string {
	if (folders.length === 0) {
		return (
			"Serving nothing: no folders are named below, and Skybox's own intake, " +
			"bookmarks and conversation folders are not set either."
		);
	}
	const missing = folders.filter((folder) => !present.includes(folder));
	if (missing.length === 0) return "";
	const names = missing.map((folder) => `"${folder}"`).join(", ");
	const is = missing.length === 1 ? "is" : "are";
	if (missing.length === folders.length) {
		return `Serving nothing: ${names} ${is} not in this vault.`;
	}
	const them = missing.length === 1 ? "it" : "them";
	return `${names} ${is} not in this vault, so nothing comes from ${them}.`;
}

/**
 * Pictures the served notes point at from outside the served folders.
 *
 * A note travels and the picture inside it does not, so the note arrives on
 * the other device with a hole where a picture should be, and nothing about
 * the sync looks wrong: it took the note, and the note is what it asked for.
 * Obsidian writes a dropped attachment wherever its own setting says, which is
 * the vault root until somebody changes it, and that is a folder the hub must
 * not serve. So this is counted and said next to the switch.
 */
export function strayPictures(pointed: Iterable<string>, folders: string[]): string[] {
	const stray = new Set<string>();
	for (const path of pointed) {
		if (!withinServed(path, folders)) stray.add(path);
	}
	return [...stray].sort();
}

/** What to say about them, which is nothing when there are none. */
export function strayComplaint(stray: string[]): string {
	if (stray.length === 0) return "";
	const where = places(stray);
	if (stray.length === 1) {
			return (
			`One picture these notes hold is outside the served folders, in ${where}, ` +
			"so the note arrives without it. Obsidian's own setting for where new " +
			"attachments go decides that folder, under Files and links."
		);
	}
	return (
		`${stray.length} pictures these notes hold are outside the served folders, ` +
		`in ${where}, so those notes arrive without them. Obsidian's own setting ` +
		"for where new attachments go decides that folder, under Files and links."
	);
}

/** Where they are, named as somebody would name them, and not all of them. */
function places(stray: string[]): string {
	const folders: string[] = [];
	for (const path of stray) {
		const folder = folderOf(path);
		if (!folders.includes(folder)) folders.push(folder);
	}
	const named = folders.map((folder) => (folder ? `"${folder}"` : "the vault root"));
	if (named.length === 1) return named[0];
	if (named.length === 2) return `${named[0]} and ${named[1]}`;
	return `${named.slice(0, 2).join(", ")} and ${named.length - 2} more`;
}

function folderOf(path: string): string {
	const cut = path.lastIndexOf("/");
	return cut === -1 ? "" : path.slice(0, cut);
}

/** Why a file is being asked for. */
export type PullWhy = "new" | "changed";

export interface PullStep {
	path: string;
	why: PullWhy;
	hash: string;
}

/** A change this device has and the hub does not. */
export interface PushStep {
	path: string;
	why: PullWhy;
	/** The hash of what is here, which is what the hub will end up holding. */
	hash: string;
	/**
	 * The hash the two sides last agreed on, or nothing for a file the hub
	 * has never heard of. The hub compares it with what it holds now and
	 * refuses the change if they differ, so a push can never overwrite work
	 * that arrived after the manifest was read.
	 */
	base?: string;
}

/**
 * A file one side no longer has, named by the hash both sides last agreed to.
 *
 * The baseline is what makes a deletion knowable at all. A file in the
 * baseline that one side no longer has was deleted there; a file in nobody's
 * baseline was simply never shared. Without that, a deletion and a file that
 * never arrived look identical, and a sync that cannot tell them apart will
 * eventually delete something nobody asked it to.
 */
export interface GoneStep {
	path: string;
	base: string;
}

/**
 * A file both sides have moved on from, which is the only case a sync cannot
 * decide by itself. What is carried here is enough to try: the hash both
 * sides started from, and the two hashes they have now. A missing hash on
 * either side means that side deleted it.
 */
export interface CollisionStep {
	path: string;
	/** What the two sides last agreed on, if they ever agreed on anything. */
	base?: string;
	/** The hash here, or nothing where the file was deleted here. */
	mine?: string;
	/** The hash on the hub, or nothing where it was deleted there. */
	theirs?: string;
}

export interface PullPlan {
	/** Files to ask the hub for. */
	fetch: PullStep[];
	/**
	 * Files both sides have changed since they last agreed. Nothing is done
	 * with these yet: merging them is the next slice, and overwriting one
	 * would be the one mistake this cannot take back.
	 */
	collided: CollisionStep[];
	/** Changes here the hub has not got, which are pushed to it. */
	ours: PushStep[];
	/**
	 * Deleted on the hub and untouched here. Nothing is removed on the
	 * strength of this: it is what the review window asks about.
	 */
	gone: GoneStep[];
	/** Deleted here and untouched on the hub, which is asked to remove them. */
	sendGone: GoneStep[];
	/** Paths gone from both sides, whose baseline is finished with. */
	forget: string[];
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
	const plan: PullPlan = {
		fetch: [],
		collided: [],
		ours: [],
		gone: [],
		sendGone: [],
		forget: [],
	};
	const seen = new Set<string>();

	for (const entry of remote) {
		seen.add(entry.path);
		const here = local.get(entry.path);
		const base = agreed.get(entry.path);

		if (here === undefined) {
			// Never agreed on means never shared, so this is simply new here.
			if (base === undefined) {
				plan.fetch.push(step(entry, "new"));
				continue;
			}
			// Agreed on once and missing now means it was deleted here. The
			// hub is asked to do the same, unless its copy has moved on since,
			// in which case somebody edited what somebody else deleted and the
			// edit is the thing that survives.
			if (entry.hash === base) plan.sendGone.push({ path: entry.path, base });
			else plan.collided.push({ path: entry.path, base, theirs: entry.hash });
			continue;
		}
		if (here === entry.hash) continue;
		if (base !== undefined && here === base) {
			plan.fetch.push(step(entry, "changed"));
			continue;
		}
		if (base !== undefined && entry.hash === base) {
			plan.ours.push({ path: entry.path, hash: here, base, why: "changed" });
			continue;
		}
		plan.collided.push({ path: entry.path, base, mine: here, theirs: entry.hash });
	}

	for (const [path, hash] of local) {
		if (seen.has(path)) continue;
		const base = agreed.get(path);
		// Never agreed on means the hub has never had it, so it goes up.
		if (base === undefined) {
			plan.ours.push({ path, hash, why: "new" });
			continue;
		}
		// Agreed on once and no longer offered means the hub deleted it.
		// Untouched here, that is a deletion to review; edited here, the
		// edit survives and the disagreement is reported as one.
		if (hash === base) plan.gone.push({ path, base });
		else plan.collided.push({ path, base, mine: hash });
	}

	// A baseline for a file neither side has any more has nothing left to
	// describe, and keeping it would make the file new all over again if it
	// ever came back.
	for (const path of agreed.keys()) {
		if (!seen.has(path) && !local.has(path)) plan.forget.push(path);
	}

	return plan;
}

function step(entry: HubEntry, why: PullWhy): PullStep {
	return { path: entry.path, hash: entry.hash, why };
}

/** What a sync managed, in each direction. */
export interface SyncTally {
	taken: number;
	sent: number;
	/** Deletions the hub was asked to carry out, once somebody has looked. */
	asked: number;
	/** Files that changed on both sides and went back together. */
	merged: number;
	/** Files that could not, and now exist twice. */
	split: number;
	/** Files the hub was asked for that did not arrive, or arrived wrong. */
	trouble: number;
	/** Pictures these notes hold that the served folders do not cover. */
	stray: number;
}

/**
 * What a sync did, in one sentence, for a notice on a phone.
 *
 * It names both directions, and it names what did not happen as well as what
 * did. A sync that quietly carries half of what you expected is worse than
 * one that says it refused the other half. Deletions are counted as waiting
 * rather than done, because nothing is deleted until somebody has read the
 * list and said so.
 */
export function syncSentence(plan: PullPlan, tally: SyncTally): string {
	const parts: string[] = [];
	if (tally.taken > 0) parts.push(`took ${files(tally.taken)}`);
	if (tally.sent > 0) parts.push(`sent ${files(tally.sent)}`);
	if (tally.asked > 0) parts.push(`asked the hub about ${files(tally.asked)} deleted here`);
	if (plan.gone.length > 0) parts.push(`${plan.gone.length} deleted on the hub, waiting on you`);
	if (tally.merged > 0) parts.push(`merged ${files(tally.merged)}`);
	if (tally.split > 0) parts.push(`split ${files(tally.split)} in two`);
	const stuck = plan.collided.length - tally.merged - tally.split;
	if (stuck > 0) parts.push(`${stuck} changed on both sides, left alone`);
	const waiting = plan.ours.length - tally.sent;
	if (waiting > 0) parts.push(`${waiting} the hub would not take`);
	if (tally.trouble > 0) parts.push(`${tally.trouble} would not come across`);
	// A note travels without the picture inside it when the picture sits
	// outside the served folders, and nothing else in a sync says so.
	const behind =
		tally.stray === 0
			? ""
			: tally.stray === 1
				? "one picture stayed behind, outside the served folders"
				: `${tally.stray} pictures stayed behind, outside the served folders`;
	if (parts.length === 0) {
		return behind ? `Already synced, but ${behind}.` : "Already synced.";
	}
	if (behind) parts.push(behind);
	const said = parts.join(", ");
	return `${said.charAt(0).toUpperCase()}${said.slice(1)}.`;
}

/** What a review did, once somebody has read it. */
export function reviewSentence(removed: number, kept: number): string {
	if (removed === 0 && kept === 0) return "Nothing to remove.";
	const parts: string[] = [];
	if (removed > 0) parts.push(`${files(removed)} to the trash`);
	if (kept > 0) parts.push(`kept ${kept}`);
	return `${parts.join(", ").replace(/^./, (first) => first.toUpperCase())}.`;
}

function files(count: number): string {
	return count === 1 ? "one file" : `${count} files`;
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
