import { type App } from "obsidian";
import {
	type MastodonNotice,
	NOTHING_UNREAD,
	type Unread,
	foldNotice,
	unreadTotal,
} from "./mastodon";
import { clientFor } from "./sharing";
import type { SkyboxSettings } from "./types";

/**
 * What has happened to the cards you shared, and which of it you have not
 * seen.
 *
 * One call to the instance returns replies, favourites and boosts together,
 * so a look costs a single request however many cards are shared. What comes
 * back is counted against the card it concerns and kept here, not in the
 * vault: reading is a thing a person does on a device, and writing it into a
 * note would churn files and tell your other devices you had read something
 * they never showed you.
 *
 * A card holding anything unread wears a tag nothing wrote, so the search box
 * can ask for them the way it asks for anything else.
 */

const STORE_KEY = "skybox:mastodon-unread";

interface LocalStore {
	loadLocalStorage(key: string): string | null;
	saveLocalStorage(key: string, value: string | null): void;
}

interface Kept {
	/** The newest notification already accounted for. */
	since: string;
	/** Unread counts, by the status id of the card's own post. */
	cards: Record<string, Unread>;
}

const EMPTY: Kept = { since: "", cards: {} };

export function readKept(raw: string | null): Kept {
	if (!raw) return { ...EMPTY };
	try {
		const parsed = JSON.parse(raw) as Partial<Kept>;
		return {
			since: typeof parsed.since === "string" ? parsed.since : "",
			cards: parsed.cards && typeof parsed.cards === "object" ? parsed.cards : {},
		};
	} catch {
		// A store this plugin cannot read is a store it starts again.
		return { ...EMPTY };
	}
}

/**
 * Counts what came in against the cards it belongs to. A favourite or a boost
 * names the card's own post; a reply names itself, and `belongsTo` says which
 * card it is under, which the caller works out and caches.
 */
export function foldNotices(
	cards: Record<string, Unread>,
	notices: MastodonNotice[],
	belongsTo: (notice: MastodonNotice) => string | null
): Record<string, Unread> {
	const next = { ...cards };
	for (const notice of notices) {
		const card = belongsTo(notice);
		if (!card) continue;
		next[card] = foldNotice(next[card] ?? NOTHING_UNREAD, notice.kind);
	}
	return next;
}

export class Interactions {
	private kept: Kept;
	private listeners = new Set<(changed: string[]) => void>();
	/** Which card a reply sits under, once worked out, for the next time. */
	private under = new Map<string, string>();
	private looking = false;

	constructor(
		private app: App,
		private settings: SkyboxSettings
	) {
		this.kept = readKept((app as unknown as LocalStore).loadLocalStorage(STORE_KEY));
	}

	subscribe(listener: (changed: string[]) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	unreadFor(statusId: string): Unread {
		return this.kept.cards[statusId] ?? NOTHING_UNREAD;
	}

	hasUnread(statusId: string): boolean {
		return unreadTotal(this.unreadFor(statusId)) > 0;
	}

	/** Everything waiting, for a count on a bell. */
	total(): number {
		return Object.values(this.kept.cards).reduce((sum, card) => sum + unreadTotal(card), 0);
	}

	/** Reading a card's conversation is what marks it read. */
	markSeen(statusId: string): void {
		if (!this.kept.cards[statusId]) return;
		delete this.kept.cards[statusId];
		this.save();
		this.tell([statusId]);
	}

	/**
	 * One look at the instance. Replies arrive naming themselves rather than
	 * the card, so an unfamiliar one costs a second request to find what it
	 * sits under, and the answer is remembered.
	 */
	async look(known: Set<string>): Promise<void> {
		if (this.looking || known.size === 0) return;
		const client = clientFor(this.app, this.settings);
		if (!client) return;
		this.looking = true;
		try {
			const notices = await client.notifications(this.kept.since);
			if (notices.length === 0) return;

			const belongsTo = async (notice: MastodonNotice): Promise<string | null> => {
				if (known.has(notice.statusId)) return notice.statusId;
				if (notice.inReplyTo && known.has(notice.inReplyTo)) return notice.inReplyTo;
				const remembered = this.under.get(notice.statusId);
				if (remembered) return remembered;
				if (!notice.inReplyTo) return null;
				try {
					const above = await client.ancestors(notice.statusId);
					const card = above.find((id) => known.has(id)) ?? null;
					if (card) this.under.set(notice.statusId, card);
					return card;
				} catch {
					return null;
				}
			};

			const placed: { notice: MastodonNotice; card: string }[] = [];
			for (const notice of notices) {
				const card = await belongsTo(notice);
				if (card) placed.push({ notice, card });
			}

			this.kept.cards = foldNotices(
				this.kept.cards,
				placed.map((each) => each.notice),
				(notice) => placed.find((each) => each.notice.id === notice.id)?.card ?? null
			);
			// Notifications come back newest first, so the first is the mark.
			this.kept.since = notices[0]?.id ?? this.kept.since;
			this.save();
			this.tell([...new Set(placed.map((each) => each.card))]);
		} catch (error) {
			console.error("Skybox: could not read notifications", error);
		} finally {
			this.looking = false;
		}
	}

	private save(): void {
		(this.app as unknown as LocalStore).saveLocalStorage(STORE_KEY, JSON.stringify(this.kept));
	}

	private tell(changed: string[]): void {
		if (changed.length === 0) return;
		for (const listener of this.listeners) listener(changed);
	}
}
