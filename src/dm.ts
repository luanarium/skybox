import { type App, Notice } from "obsidian";
import { htmlToText } from "./mastodon";
import { ensureFolder, uniquePath } from "./ingest";
import { clientFor } from "./sharing";
import { threadFileName, threadNote, type Thread, type ThreadMessage } from "./thread";
import type { SkyboxSettings } from "./types";
import { guarded } from "./writes";

/**
 * Direct messages, as the same conversations mail makes.
 *
 * A Mastodon conversation is a thread of statuses addressed to the people in
 * it and nobody else, which is near enough a mail thread that it can wear the
 * same note, the same card and the same window. The only thing the surface
 * needs to know is which backend takes a reply, and that is one word in the
 * note's frontmatter.
 *
 * Unlike mail, this works on a phone: it is an HTTP call rather than a
 * directory on a computer.
 */

interface RawStatus {
	id?: string;
	content?: string;
	created_at?: string;
	account?: { acct?: string; display_name?: string; id?: string };
}

interface RawConversation {
	id?: string;
	unread?: boolean;
	accounts?: { acct?: string; display_name?: string }[];
	last_status?: RawStatus;
}

/** Who a conversation is with, as a person reads it. */
export function partyOf(conversation: RawConversation): string {
	const first = conversation.accounts?.[0];
	if (!first?.acct) return "someone";
	return first.display_name ? `${first.display_name} <@${first.acct}>` : `@${first.acct}`;
}

/** A subject, since a direct message has none: the first words said. */
export function subjectOf(text: string): string {
	const line = text.split("\n").map((each) => each.trim()).find(Boolean) ?? "";
	const trimmed = line.replace(/^@\S+\s*/, "").trim();
	if (!trimmed) return "(no subject)";
	return trimmed.length > 60 ? `${trimmed.slice(0, 57).trimEnd()}…` : trimmed;
}

function statusMessage(status: RawStatus, me: string): ThreadMessage {
	const handle = status.account?.acct ?? "";
	const at = Date.parse(status.created_at ?? "");
	return {
		id: String(status.id ?? ""),
		who: status.account?.display_name
			? `${status.account.display_name} <@${handle}>`
			: `@${handle}`,
		at: Number.isNaN(at) ? 0 : at,
		text: htmlToText(status.content ?? ""),
		mine: handle !== "" && handle === me,
	};
}

export class DirectMessages {
	constructor(
		private app: App,
		private settings: SkyboxSettings
	) {}

	/**
	 * Brings the vault's direct-message threads up to date. One call lists
	 * the conversations; each one's thread costs a second call, so only the
	 * ones that have moved are asked about.
	 */
	async sync(): Promise<number> {
		if (!this.settings.dmEnabled) return 0;
		const client = clientFor(this.app, this.settings);
		if (!client) return 0;

		let conversations: RawConversation[];
		let me: string;
		try {
			me = (await client.verify()).username;
			conversations = (await client.conversations()) as RawConversation[];
		} catch (error) {
			console.error("Skybox: could not read conversations", error);
			return 0;
		}

		const folder = await ensureFolder(this.app, this.settings.mailFolder);
		let written = 0;
		for (const conversation of conversations) {
			const last = conversation.last_status;
			if (!last?.id) continue;
			let messages: ThreadMessage[];
			try {
				const [ancestors, descendants] = await client.wholeThread(last.id);
				messages = [...ancestors, last, ...descendants].map((status) =>
					statusMessage(status as RawStatus, me)
				);
			} catch (error) {
				console.error("Skybox: could not read a conversation", error);
				continue;
			}

			const thread: Thread = {
				id: `mastodon:${conversation.id ?? last.id}`,
				source: "mastodon",
				subject: subjectOf(messages[0]?.text ?? ""),
				with: partyOf(conversation),
				messages,
				unread: Boolean(conversation.unread),
			};

			const existing = this.noteFor(thread.id, folder);
			const body = threadNote(thread);
			try {
				if (existing) {
					if ((await this.app.vault.read(existing)) === body) continue;
					await guarded(() => this.app.vault.modify(existing, body));
				} else {
					const path = await uniquePath(this.app, folder, threadFileName(thread));
					await guarded(() => this.app.vault.create(path, body));
				}
				written++;
			} catch (error) {
				console.error("Skybox: could not write a conversation", error);
			}
		}
		return written;
	}

	private noteFor(threadId: string, folder: string) {
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (folder && !file.path.startsWith(`${folder}/`)) continue;
			const front = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (front?.thread_id && String(front.thread_id) === threadId) return file;
		}
		return null;
	}

	/** Replies in the conversation, to the people already in it. */
	async send(thread: Thread, text: string): Promise<boolean> {
		const client = clientFor(this.app, this.settings);
		if (!client) {
			new Notice("Skybox: connect a Mastodon account in the settings first.");
			return false;
		}
		const last = [...thread.messages].reverse().find((message) => message.id);
		const handle = /<@([^>]+)>/.exec(thread.with)?.[1] ?? thread.with.replace(/^@/, "");
		const said = text.trim().startsWith(`@${handle}`) ? text.trim() : `@${handle} ${text.trim()}`;
		try {
			await client.post(said, "direct", [], last?.id);
			return true;
		} catch (error) {
			console.error("Skybox: could not send that message", error);
			new Notice(
				`Skybox could not send that: ${error instanceof Error ? error.message : String(error)}`
			);
			return false;
		}
	}
}
