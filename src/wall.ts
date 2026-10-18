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

/** The first wall tag among the chips, which is the one the grid shows. */
export function wallTagOf(chips: Chip[]): string | null {
	for (const chip of chips) {
		const tag = wallTag(chip);
		if (tag) return tag;
	}
	return null;
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
		.filter((chip) => wallTag(chip) === null)
		.map((chip) => (chip.tagOnly ? chip.text : chip.text).toLowerCase())
		.filter(Boolean);
	if (words.length === 0) return posts;

	return posts.filter((post) => {
		const haystack = `${post.text} ${post.author} ${post.handle} ${post.tags.join(" ")}`.toLowerCase();
		return words.every((word) => word !== tag && haystack.includes(word));
	});
}
