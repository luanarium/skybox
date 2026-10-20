import type { TFile } from "obsidian";
import type { WallPost } from "./mastodon";
import type { Chip } from "./search";
import type { Item } from "./types";

/**
 * The wall: what the fediverse is saying under a hashtag, in the same grid as
 * everything else.
 *
 * A chip beginning `#!` asks the instance rather than the vault, so `#!tea`
 * fills the grid with the tag's public timeline. Nothing of it is written
 * anywhere: clear the chip and it is gone, which is the right relationship to
 * have with somebody else's timeline. A post worth keeping is saved
 * deliberately, and once saved it is an ordinary card with an ordinary
 * conversation beside it.
 */

export const WALL_PREFIX = "!";

/** The tag a chip asks the fediverse for, or nothing if it asks the vault. */
export function wallTag(chip: Chip): string | null {
	if (!chip.tagOnly) return null;
	const text = chip.text.trim();
	return text.startsWith(WALL_PREFIX) ? text.slice(1).toLowerCase() : null;
}

/** `#!follows` asks for the people you follow rather than for a hashtag. */
export const WALL_FOLLOWS = "follows";

export interface WallSource {
	kind: "tag" | "home";
	tag: string;
}

/** The first wall chip among them, which is the one the grid shows. */
export function wallSourceOf(chips: Chip[]): WallSource | null {
	for (const chip of chips) {
		const tag = wallTag(chip);
		if (!tag) continue;
		return tag === WALL_FOLLOWS ? { kind: "home", tag } : { kind: "tag", tag };
	}
	return null;
}

/**
 * The tag a kept post carries. A note you shared yourself also ends up with a
 * `mastodon_id`, so the tag is what tells somebody else's post from your own:
 * yours is a note to edit, theirs is a post to read.
 */
export const WALL_TAG = "wall";

/** Whether this note is a post somebody else wrote, kept from a wall. */
export function isKeptPost(front: Record<string, unknown> | undefined): boolean {
	if (!front?.mastodon_id) return false;
	const raw = front.tags;
	const tags = Array.isArray(raw)
		? raw.map(String)
		: typeof raw === "string"
			? raw.split(/[\s,]+/)
			: [];
	return tags.some((tag) => tag.replace(/^#/, "").toLowerCase() === WALL_TAG);
}

/**
 * The properties out of the note's own text.
 *
 * Obsidian's cache is the usual way to read these and for a kept post it is
 * the wrong way twice. It may not have parsed the note yet, which is why a
 * post kept a moment ago came up blank, and YAML reads a status id as a
 * number, which is longer than a number holds exactly: the last digits are
 * rounded away and the thread is then asked for a status that does not exist.
 * The text has the digits, so the text is what is read.
 */
export function frontFromText(text: string): Record<string, unknown> {
	const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
	if (!block) return {};
	const front: Record<string, unknown> = {};
	let list: string | null = null;
	for (const line of block[1].split(/\r?\n/)) {
		const item = /^\s*-\s+(.*)$/.exec(line);
		if (item && list) {
			(front[list] as string[]).push(unquote(item[1]));
			continue;
		}
		const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
		if (!pair) continue;
		const [, key, value] = pair;
		if (value.trim() === "") {
			// A key with nothing after it opens a list.
			list = key;
			front[key] = [];
		} else {
			list = null;
			front[key] = unquote(value.trim());
		}
	}
	return front;
}

function unquote(value: string): string {
	const text = value.trim();
	if (text.length > 1 && (text[0] === '"' || text[0] === "'") && text.at(-1) === text[0]) {
		return text.slice(1, -1).replace(/\\"/g, '"');
	}
	return text;
}

/**
 * The same note with its ids quoted, or nothing if they already are.
 *
 * Skybox wrote the first kept posts with bare ids, and everything that reads
 * those properties through Obsidian's cache, the unread tag among them, gets
 * a rounded number back. Quoting the line changes no words and settles it.
 */
export function quoteIds(text: string): string | null {
	const lines = text.split("\n");
	if (lines[0]?.trim() !== "---") return null;
	let changed = false;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i].trim() === "---") break;
		const pair = /^(mastodon_id|mastodon_account):[ \t]*(.+?)\s*$/.exec(lines[i]);
		if (!pair || pair[2].startsWith('"') || pair[2].startsWith("'")) continue;
		lines[i] = `${pair[1]}: "${pair[2]}"`;
		changed = true;
	}
	return changed ? lines.join("\n") : null;
}

/** A kept post, read back from the note that kept it. */
export function postFromNote(
	cached: Record<string, unknown>,
	body: string
): WallPost | null {
	// The note's own text wins wherever it says anything.
	const front = { ...cached, ...frontFromText(body) };
	const id = front.mastodon_id ? String(front.mastodon_id) : "";
	if (!id) return null;
	const handle = String(front.author ?? "").replace(/^@/, "");
	const at = Date.parse(String(front.created ?? ""));
	// The note's own words, less the frontmatter and the link at the foot.
	const words = body
		.replace(/^---[\s\S]*?\n---\n/, "")
		.replace(/^<https?:\/\/[^>]*>\s*$/gm, "")
		.trim();
	return {
		id,
		url: String(front.mastodon_url ?? front.source ?? ""),
		author: String(front.title ?? handle),
		handle,
		accountId: String(front.mastodon_account ?? ""),
		avatar: "",
		text: words,
		media: typeof front.image === "string" ? [front.image] : [],
		tags: Array.isArray(front.tags) ? front.tags.map(String) : [],
		at: Number.isNaN(at) ? 0 : at,
		repliesCount: 0,
		favouritesCount: 0,
		reblogsCount: 0,
		boosted: false,
		favourited: false,
		entryId: id,
		boostedBy: "",
	};
}

/**
 * A post as a card. The grid wants an `Item`, and an item from the wall has
 * no file behind it, so it carries a stand-in: nothing touches it, because
 * every path that reads a file checks `remote` first.
 */
export function wallItem(post: WallPost): Item {
	const stand: TFile = {
		path: `wall:${post.id}`,
		name: `${post.id}.md`,
		basename: post.id,
		extension: "md",
	} as TFile;

	return {
		id: `wall:${post.id}`,
		kind: "note",
		file: stand,
		sidecar: null,
		title: post.author || `@${post.handle}`,
		mtime: post.at,
		tags: post.tags,
		// A post is not a bookmark: there is no address of its own to read.
		kinds: [],
		headings: [],
		excerpt: post.text,
		embedded: false,
		preview: post.media[0] ?? null,
		unread: false,
		remote: post,
	};
}

/** Posts the other chips also ask for, since a wall can be narrowed too. */
export function narrowWall(posts: WallPost[], chips: Chip[], tag: string): WallPost[] {
	const words = chips
		.filter((chip) => wallTag(chip) === null && !chip.kindOnly)
		.map((chip) => (chip.tagOnly ? chip.text : chip.text).toLowerCase())
		.filter(Boolean);
	if (words.length === 0) return posts;

	return posts.filter((post) => {
		const haystack = `${post.text} ${post.author} ${post.handle} ${post.tags.join(" ")}`.toLowerCase();
		return words.every((word) => word !== tag && haystack.includes(word));
	});
}
