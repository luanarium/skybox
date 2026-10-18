import { type App, Notice, TFile } from "obsidian";
import { listMail, markSeen, readMail, type MaildirFile } from "./maildir";
import { parseMessage, threadSubject, type MailMessage } from "./mime";
import {
	MAIL_TAG,
	sameParty,
	threadFileName,
	threadNote,
	type Thread,
	type ThreadMessage,
} from "./thread";
import { ensureFolder, uniquePath } from "./ingest";
import type { SkyboxSettings } from "./types";
import { guarded } from "./writes";

/**
 * Mail, from a Maildir on this computer into threads in the vault.
 *
 * Nothing here speaks a protocol. Something else fetches, usually `mbsync`,
 * and something else sends, usually `msmtp` over what this leaves in the
 * outbox. What happens in between is reading files, grouping them into
 * conversations, and writing those conversations into the vault as notes, so
 * a phone that will never see the Maildir still has the mail.
 */

/** Groups messages into conversations, by what answers what. */
export function assemble(messages: MailMessage[], me: string): Thread[] {
	const byId = new Map<string, MailMessage>();
	for (const message of messages) if (message.id) byId.set(message.id, message);

	/** The oldest ancestor a message can reach, which names its thread. */
	const rootOf = (message: MailMessage): string => {
		const seen = new Set<string>();
		let current = message;
		for (;;) {
			const parentId = current.inReplyTo ?? current.references[0] ?? null;
			if (!parentId || seen.has(parentId)) break;
			seen.add(parentId);
			const parent = byId.get(parentId);
			if (!parent) return parentId;
			current = parent;
		}
		return current.id || message.id;
	};

	const groups = new Map<string, MailMessage[]>();
	for (const message of messages) {
		const root = rootOf(message);
		const already = groups.get(root);
		if (already) already.push(message);
		else groups.set(root, [message]);
	}

	const threads: Thread[] = [];
	for (const [id, group] of groups) {
		const ordered = [...group].sort((a, b) => a.date - b.date);
		const first = ordered[0];
		// The other party: whoever is not you, preferring whoever wrote first.
		const other =
			ordered.find((message) => !sameParty(message.from.address, me))?.from ??
			first.to[0] ??
			first.from;
		threads.push({
			id,
			source: "mail",
			subject: threadSubject(first.subject) || "(no subject)",
			with: other.name ? `${other.name} <${other.address}>` : other.address,
			messages: ordered.map((message): ThreadMessage => {
				const text = message.text || htmlToPlain(message.html);
				const attached = message.attachments.map((file) => `(attached: ${file.name})`);
				return {
					id: message.id,
					who: message.from.name
						? `${message.from.name} <${message.from.address}>`
						: message.from.address,
					at: message.date,
					text: [text.trim(), ...attached].filter(Boolean).join("\n\n"),
					mine: sameParty(message.from.address, me),
				};
			}),
			unread: false,
		});
	}
	return threads;
}

/** HTML mail, as words, for the notes and for searching. */
export function htmlToPlain(html: string): string {
	return html
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n\n")
		.replace(/<li[^>]*>/gi, "- ")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&mdash;/g, ", ")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/[ \t]+\n/g, "\n")
		.trim();
}

/** The message a reply quotes and answers. */
export function replyHeaders(
	thread: Thread,
	from: string,
	lastMessageId: string
): Record<string, string> {
	const subject = thread.subject.toLowerCase().startsWith("re:")
		? thread.subject
		: `Re: ${thread.subject}`;
	const headers: Record<string, string> = {
		From: from,
		To: thread.with,
		Subject: subject,
		Date: new Date().toUTCString(),
		"MIME-Version": "1.0",
	};
	if (lastMessageId) {
		headers["In-Reply-To"] = `<${lastMessageId}>`;
		headers.References = `<${lastMessageId}>`;
	}
	return headers;
}

/** A message a mail transfer agent will take: headers, then both bodies. */
export function composeMail(
	headers: Record<string, string>,
	text: string,
	html: string
): string {
	const boundary = `skybox-${Math.random().toString(36).slice(2, 10)}`;
	const lines = Object.entries(headers).map(([name, value]) => `${name}: ${value}`);
	lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`, "");
	lines.push(`--${boundary}`, "Content-Type: text/plain; charset=utf-8", "", text.trim(), "");
	lines.push(`--${boundary}`, "Content-Type: text/html; charset=utf-8", "", html.trim(), "");
	lines.push(`--${boundary}--`, "");
	return lines.join("\r\n");
}

export class MailImport {
	/** What each thread note was written from, so unchanged mail is skipped. */
	private written = new Map<string, number>();

	constructor(
		private app: App,
		private settings: SkyboxSettings
	) {}

	/** Reads the Maildir and brings the vault's threads up to date. */
	async sync(): Promise<number> {
		const mailbox = this.settings.mailMaildir.trim();
		if (!mailbox) return 0;

		const files = listMail(mailbox);
		if (files.length === 0) return 0;

		const parsed: { file: MaildirFile; message: MailMessage }[] = [];
		for (const file of files) {
			const raw = readMail(file.path);
			if (!raw) continue;
			parsed.push({ file, message: parseMessage(raw) });
		}

		const unreadIds = new Set(
			parsed.filter((each) => !each.file.seen).map((each) => each.message.id)
		);
		const threads = assemble(
			parsed.map((each) => each.message),
			this.settings.mailAddress
		);

		const folder = await ensureFolder(this.app, this.settings.mailFolder);
		let written = 0;
		for (const thread of threads) {
			thread.unread = thread.messages.some((message) => unreadIds.has(message.id));
			const newest = thread.messages.reduce((at, message) => Math.max(at, message.at), 0);
			if (this.written.get(thread.id) === newest) continue;

			const existing = this.noteFor(thread.id, folder);
			const body = threadNote(thread);
			try {
				if (existing) {
					// The note is a view of the mail: it is rewritten rather
					// than merged, and anything you write belongs in a note of
					// your own beside it.
					await guarded(() => this.app.vault.modify(existing, body));
				} else {
					const path = await uniquePath(this.app, folder, threadFileName(thread));
					await guarded(() => this.app.vault.create(path, body));
				}
				this.written.set(thread.id, newest);
				written++;
			} catch (error) {
				console.error("Skybox: could not write a thread", error);
			}
		}

		await this.pushReadState(parsed, folder);
		return written;
	}

	/**
	 * A thread read anywhere is read here: the note says so, and the Maildir
	 * is told, which is what carries it back to the server on the next sync.
	 */
	private async pushReadState(
		parsed: { file: MaildirFile; message: MailMessage }[],
		folder: string
	): Promise<void> {
		for (const { file, message } of parsed) {
			if (file.seen) continue;
			const note = this.noteForMessage(message, folder);
			if (!note) continue;
			const front = this.app.metadataCache.getFileCache(note)?.frontmatter;
			if (front?.unread === false) markSeen(file);
		}
	}

	private noteFor(threadId: string, folder: string): TFile | null {
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (folder && !file.path.startsWith(`${folder}/`)) continue;
			const front = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (front?.thread_id && String(front.thread_id) === threadId) return file;
		}
		return null;
	}

	private noteForMessage(message: MailMessage, folder: string): TFile | null {
		const root = message.references[0] ?? message.inReplyTo ?? message.id;
		return this.noteFor(root, folder) ?? this.noteFor(message.id, folder);
	}

	/** Leaves a reply where the mail transfer agent will find it. */
	async send(thread: Thread, text: string, html: string): Promise<boolean> {
		const outbox = this.settings.mailOutbox.trim();
		const from = this.settings.mailAddress.trim();
		if (!outbox || !from) {
			new Notice("Skybox: set your address and an outbox in the settings first.");
			return false;
		}
		const last = [...thread.messages].reverse().find((message) => message.id);
		const raw = composeMail(replyHeaders(thread, from, last?.id ?? ""), text, html);
		const host = window as unknown as { require?: (id: string) => unknown };
		try {
			const node = host.require?.("fs") as
				| { writeFileSync(path: string, data: string, encoding: string): void }
				| undefined;
			if (!node) throw new Error("no filesystem");
			node.writeFileSync(`${outbox}/${Date.now()}-skybox.eml`, raw, "utf8");
			return true;
		} catch (error) {
			console.error("Skybox: could not write to the outbox", error);
			new Notice(
				`Skybox could not leave that in the outbox: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
			return false;
		}
	}
}

export { MAIL_TAG };
