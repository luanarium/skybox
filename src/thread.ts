/**
 * A conversation in the vault, whoever carried it.
 *
 * Mail and direct messages are the same thing to a reader: people saying
 * things to each other in order, each with a name and a time. So both are
 * written into the vault as the same note, and the card, the thread view and
 * the composer know nothing about where a thread came from beyond which
 * backend to hand a reply to.
 *
 * The note is the store. Its frontmatter says what the thread is and whether
 * anything in it is unread, which is what lets a phone show both without
 * reaching the Maildir it will never see. Its body holds the messages, each
 * under a heading this file writes and reads back.
 */

export type ThreadSource = "mail" | "mastodon";

export interface ThreadMessage {
	/** The backend's own id, for replying in the right place. */
	id: string;
	/** Who said it, as a person reads it: a name, or an address, or a handle. */
	who: string;
	/** Milliseconds since the epoch. */
	at: number;
	text: string;
	/** True where this one is yours. */
	mine: boolean;
}

export interface Thread {
	/** Stable across syncs: the root message's id. */
	id: string;
	source: ThreadSource;
	subject: string;
	/** The other party, for the card's title and for addressing a reply. */
	with: string;
	messages: ThreadMessage[];
	unread: boolean;
}

/** The tag every thread note carries, so the grid can ask for them. */
export const MAIL_TAG = "mail";

const HEADING = /^####\s+(.+?)\s+·\s+(\S+)\s*$/;

/** A time a person reads, and a machine can read back. */
function stamp(at: number): string {
	return new Date(at).toISOString();
}

export function threadNote(thread: Thread): string {
	const lines = [
		"---",
		`thread_id: ${yamlValue(thread.id)}`,
		`thread_source: ${thread.source}`,
		`thread_with: ${yamlValue(thread.with)}`,
		`subject: ${yamlValue(thread.subject || "(no subject)")}`,
		`updated: ${stamp(lastAt(thread))}`,
		`unread: ${thread.unread ? "true" : "false"}`,
		"tags:",
		`  - ${MAIL_TAG}`,
		"---",
		"",
		`# ${thread.subject || "(no subject)"}`,
		"",
	];
	for (const message of thread.messages) {
		lines.push(`#### ${message.who} · ${stamp(message.at)}`, "");
		lines.push(message.text.trim(), "");
	}
	return `${lines.join("\n").trimEnd()}\n`;
}

/** Reads back what `threadNote` wrote, for the thread view to render. */
export function parseThreadNote(note: string, me: string): ThreadMessage[] {
	const body = note.startsWith("---") ? note.slice(note.indexOf("\n---", 3) + 4) : note;
	const messages: ThreadMessage[] = [];
	let current: ThreadMessage | null = null;
	const held: string[] = [];

	const close = () => {
		if (!current) return;
		current.text = held.join("\n").trim();
		messages.push(current);
		held.length = 0;
	};

	for (const line of body.split("\n")) {
		const heading = HEADING.exec(line);
		if (heading) {
			close();
			const at = Date.parse(heading[2]);
			current = {
				id: "",
				who: heading[1].trim(),
				at: Number.isNaN(at) ? 0 : at,
				text: "",
				mine: sameParty(heading[1], me),
			};
			continue;
		}
		if (current) held.push(line);
	}
	close();
	return messages;
}

/** `Marion <marion@example.org>` and `marion@example.org` are one person. */
export function sameParty(a: string, b: string): boolean {
	const address = (value: string): string => {
		const angled = /<([^>]+)>/.exec(value);
		return (angled ? angled[1] : value).trim().toLowerCase().replace(/^@/, "");
	};
	if (!a || !b) return false;
	return address(a) === address(b);
}

export function lastAt(thread: Thread): number {
	return thread.messages.reduce((latest, message) => Math.max(latest, message.at), 0);
}

/** A filename a vault will take, from a subject that may contain anything. */
export function threadFileName(thread: Thread): string {
	const subject = (thread.subject || "conversation")
		.replace(/[\\/:*?"<>|#^[\]]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 60);
	return `${subject || "conversation"}.md`;
}

function yamlValue(value: string): string {
	return /^[\w][\w ,.'()/@<>-]*$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Threads, newest first, with anything unread before anything read. What is
 * waiting is the reason to look at a list of conversations at all.
 */
export function sortThreads(threads: Thread[]): Thread[] {
	return [...threads].sort((a, b) => {
		if (a.unread !== b.unread) return a.unread ? -1 : 1;
		return lastAt(b) - lastAt(a);
	});
}
