import { type App, Notice, TFile } from "obsidian";
import { ask } from "./confirm";
import type { VaultIndex } from "./index";
import { Mastodon, composePost, type MastodonReply, type Visibility } from "./mastodon";
import { isImageExtension, sidecarTargetPath, type SkyboxSettings } from "./types";
import { guarded } from "./writes";

/**
 * Sharing a card to Mastodon, driven by a tag.
 *
 * Tag a note and it is posted; take the tag away and the post goes with it.
 * Nothing happens on its own: the tag has to be added while the plugin is
 * running, and both posting and deleting ask first, showing what will go out
 * or what will be lost. A note that already carries the tag when Obsidian
 * starts is left alone, or turning the feature on would publish a vault.
 *
 * The post's id and address are written into the note's frontmatter, which is
 * what makes the link survive a rename and what every later slice reads.
 */

/** Where the token lives: the vault's local storage, which never syncs. */
const TOKEN_KEY = "skybox:mastodon-token";

interface LocalStore {
	loadLocalStorage(key: string): string | null;
	saveLocalStorage(key: string, value: string | null): void;
}

export function readToken(app: App): string {
	return (app as unknown as LocalStore).loadLocalStorage(TOKEN_KEY)?.trim() ?? "";
}

export function writeToken(app: App, token: string): void {
	(app as unknown as LocalStore).saveLocalStorage(TOKEN_KEY, token.trim() || null);
}

export function clientFor(app: App, settings: SkyboxSettings): Mastodon | null {
	const token = readToken(app);
	if (!settings.mastodonInstance || !token) return null;
	return new Mastodon(settings.mastodonInstance, token);
}

/** The tag that means "share this", without its hash, lowercased. */
export function shareTag(settings: SkyboxSettings): string {
	return settings.mastodonTag.trim().replace(/^#/, "").toLowerCase();
}

export function hasShareTag(tags: string[], tag: string): boolean {
	return tag !== "" && tags.some((each) => each.toLowerCase() === tag);
}

export class Sharing {
	/** What each note's tag looked like last time, so a change is visible. */
	private tagged = new Map<string, boolean>();
	private busy = new Set<string>();

	constructor(
		private app: App,
		private index: VaultIndex,
		private settings: SkyboxSettings
	) {}

	/**
	 * What is already tagged when the plugin loads, remembered and not acted
	 * on. Only a tag added afterwards means "share this".
	 */
	prime(): void {
		const tag = shareTag(this.settings);
		for (const item of this.index.all()) {
			this.tagged.set(item.id, hasShareTag(item.tags, tag));
		}
	}

	/** Called for every note the vault reports changed. */
	async onChange(file: TFile): Promise<void> {
		if (file.extension !== "md") return;
		const tag = shareTag(this.settings);
		if (!tag || !this.settings.mastodonInstance) return;

		// An image's sidecar speaks for the image: the card is what is shared.
		const target = sidecarTargetPath(file.path);
		const item = this.index.get(target ?? file.path);
		if (!item) return;

		const now = hasShareTag(item.tags, tag);
		const before = this.tagged.get(item.id);
		this.tagged.set(item.id, now);
		if (before === undefined || before === now) return;
		if (this.busy.has(item.id)) return;

		this.busy.add(item.id);
		try {
			if (now) await this.share(item.id);
			else await this.unshare(item.id);
		} finally {
			this.busy.delete(item.id);
		}
	}

	/** The note a card's properties live in: itself, or an image's sidecar. */
	private noteFor(id: string): TFile | null {
		const item = this.index.get(id);
		if (!item) return null;
		if (item.kind === "note") return item.file;
		return item.sidecar;
	}

	private async share(id: string): Promise<void> {
		const item = this.index.get(id);
		const note = this.noteFor(id);
		if (!item || !note) return;

		const client = clientFor(this.app, this.settings);
		if (!client) {
			new Notice("Skybox: connect a Mastodon account in the settings first.");
			return;
		}

		const front = this.app.metadataCache.getFileCache(note)?.frontmatter ?? {};
		if (front.mastodon_id) return;

		const limit = await client.maxCharacters();
		const text = composePost(
			{
				title: item.title,
				link: typeof front.source === "string" ? front.source : null,
				body: item.excerpt,
			},
			limit
		);

		const sure = await ask(this.app, {
			title: `Post to ${this.settings.mastodonInstance.replace(/^https?:\/\//, "")}?`,
			message: `${text}\n\nVisibility: ${this.settings.mastodonVisibility}.`,
			confirm: "Post it",
			cancel: "Not now",
		});
		if (!sure) return;

		try {
			const media: string[] = [];
			// An image card without its image is a link to nothing.
			if (item.kind === "image" && isImageExtension(item.file.extension)) {
				const bytes = await this.app.vault.readBinary(item.file);
				media.push(
					await client.uploadMedia(bytes, mimeOf(item.file.extension), item.file.name, item.title)
				);
			}
			const status = await client.post(text, this.settings.mastodonVisibility as Visibility, media);
			await guarded(() =>
				this.app.fileManager.processFrontMatter(note, (front) => {
					front.mastodon_id = status.id;
					front.mastodon_url = status.url;
				})
			);
			new Notice(`Posted: ${status.url}`);
		} catch (error) {
			console.error("Skybox: could not post", error);
			new Notice(`Skybox could not post that: ${message(error)}`);
		}
	}

	private async unshare(id: string): Promise<void> {
		const note = this.noteFor(id);
		if (!note) return;
		const front = this.app.metadataCache.getFileCache(note)?.frontmatter ?? {};
		const statusId = front.mastodon_id;
		if (typeof statusId !== "string" && typeof statusId !== "number") return;

		const client = clientFor(this.app, this.settings);
		if (!client) return;

		/*
		 * What is about to be lost, said plainly. Mastodon does not cascade a
		 * delete: every reply is a status of its own and outlives the post it
		 * answered. Your own replies can go with it, and are counted here so
		 * the number is in the question; anyone else's stay where they are,
		 * on their own servers, now answering nothing.
		 */
		const [status, thread] = await Promise.all([
			client.status(String(statusId)),
			client.replies(String(statusId)).catch((): MastodonReply[] => []),
		]);
		const me = await client.verify().catch(() => null);
		const mine = me ? thread.filter((reply) => reply.accountId === me.id) : [];
		const theirs = thread.length - mine.length;
		const reactions = (status?.favouritesCount ?? 0) + (status?.reblogsCount ?? 0);

		const said = [
			mine.length > 0
				? `${mine.length} ${mine.length === 1 ? "reply" : "replies"} of your own go with it.`
				: "",
			theirs > 0
				? `${theirs} ${theirs === 1 ? "reply" : "replies"} by other people stay where they are, answering a post that is no longer there.`
				: "",
			reactions > 0 ? `${reactions} ${reactions === 1 ? "reaction" : "reactions"} go too.` : "",
			thread.length === 0 && reactions === 0 ? "Nobody has replied to it." : "",
		]
			.filter(Boolean)
			.join(" ");

		const sure = await ask(this.app, {
			title: "Delete the post?",
			message: `The tag is gone from “${note.basename}”. ${said} Deleting cannot be undone, and copies already sent to other servers may remain.`,
			confirm: "Delete it",
			cancel: "Keep the post",
			destructive: true,
		});

		if (!sure) {
			// Keeping the post means keeping the link to it, so the note still
			// says where it went.
			return;
		}

		try {
			// Deepest first, so nothing is left answering something already
			// gone while the rest are still going.
			let removed = 0;
			for (const reply of [...mine].reverse()) {
				try {
					await client.deleteStatus(reply.id);
					removed++;
				} catch (error) {
					// One stubborn reply is not a reason to keep the post.
					console.error("Skybox: could not delete a reply", error);
				}
			}
			await client.deleteStatus(String(statusId));
			await guarded(() =>
				this.app.fileManager.processFrontMatter(note, (front) => {
					delete front.mastodon_id;
					delete front.mastodon_url;
				})
			);
			new Notice(
				removed > 0
					? `The post is gone, with ${removed} of your ${removed === 1 ? "reply" : "replies"}.`
					: "The post is gone."
			);
		} catch (error) {
			console.error("Skybox: could not delete the post", error);
			new Notice(`Skybox could not delete that post: ${message(error)}`);
		}
	}
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function mimeOf(extension: string): string {
	const known: Record<string, string> = {
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		gif: "image/gif",
		webp: "image/webp",
		avif: "image/avif",
		bmp: "image/bmp",
		svg: "image/svg+xml",
	};
	return known[extension.toLowerCase()] ?? "application/octet-stream";
}
