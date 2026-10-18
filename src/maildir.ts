import { Platform } from "obsidian";

/**
 * Mail as files.
 *
 * A Maildir is a directory of messages, one per file, which is why this
 * plugin reads mail without speaking a protocol: `mbsync` or `getmail` or
 * anything else fetches, and Skybox reads what landed. A message waits in
 * `new` until something has seen it and moves it to `cur`, where its flags
 * are written into its own filename after a `:2,`.
 *
 * Marking a message read is therefore a rename, and the next sync carries
 * that back to the server. Nothing here talks to anyone.
 */

/** The flags Maildir writes after `:2,`; `S` is the one that matters here. */
export function parseFlags(filename: string): Set<string> {
	const marker = filename.lastIndexOf(":2,");
	if (marker === -1) return new Set();
	return new Set(filename.slice(marker + 3).split(""));
}

export function isSeen(filename: string): boolean {
	return parseFlags(filename).has("S");
}

/**
 * The name a message takes once it has been read: flags are kept in order,
 * which is what the format asks for, and a message arriving from `new` has
 * none yet.
 */
export function seenName(filename: string): string {
	const marker = filename.lastIndexOf(":2,");
	if (marker === -1) return `${filename}:2,S`;
	const flags = new Set(filename.slice(marker + 3).split(""));
	flags.add("S");
	return `${filename.slice(0, marker)}:2,${[...flags].sort().join("")}`;
}

export interface MaildirFile {
	/** Full path, for reading and renaming. */
	path: string;
	name: string;
	seen: boolean;
	/** Modification time, as a stand-in for arrival. */
	at: number;
}

interface FileSystem {
	existsSync(path: string): boolean;
	readdirSync(path: string): string[];
	readFileSync(path: string, encoding: string): string;
	renameSync(from: string, to: string): void;
	statSync(path: string): { mtimeMs: number };
}

/** Node's `fs`, on desktop, or nothing: a phone has no Maildir to read. */
function fs(): FileSystem | null {
	if (!Platform.isDesktopApp) return null;
	const host = window as unknown as { require?: (id: string) => unknown };
	try {
		return (host.require?.("fs") as FileSystem) ?? null;
	} catch (error) {
		console.error("Skybox: no filesystem for mail", error);
		return null;
	}
}

export function canReadMail(): boolean {
	return fs() !== null;
}

/** Every message in a mailbox, read and unread, newest first. */
export function listMail(mailbox: string): MaildirFile[] {
	const node = fs();
	if (!node || !mailbox) return [];
	const found: MaildirFile[] = [];
	for (const folder of ["new", "cur"]) {
		const directory = `${mailbox}/${folder}`;
		try {
			if (!node.existsSync(directory)) continue;
			for (const name of node.readdirSync(directory)) {
				if (name.startsWith(".")) continue;
				const path = `${directory}/${name}`;
				found.push({
					path,
					name,
					seen: folder === "cur" && isSeen(name),
					at: node.statSync(path).mtimeMs,
				});
			}
		} catch (error) {
			console.error("Skybox: could not read", directory, error);
		}
	}
	return found.sort((a, b) => b.at - a.at);
}

/**
 * The message itself, read as bytes carried in a string so that each part can
 * be decoded with whatever character set it declares.
 */
export function readMail(path: string): string | null {
	const node = fs();
	if (!node) return null;
	try {
		return node.readFileSync(path, "latin1");
	} catch (error) {
		console.error("Skybox: could not read", path, error);
		return null;
	}
}

/**
 * Marks a message read, which in a Maildir means moving it to `cur` with an
 * `S` in its name. The next sync tells the server.
 */
export function markSeen(file: MaildirFile): boolean {
	const node = fs();
	if (!node || file.seen) return false;
	const inNew = file.path.includes("/new/");
	const target = inNew
		? file.path.replace("/new/", "/cur/").replace(/:2,[^/]*$/, "") + ":2,S"
		: `${file.path.slice(0, file.path.lastIndexOf("/") + 1)}${seenName(file.name)}`;
	try {
		node.renameSync(file.path, target);
		return true;
	} catch (error) {
		console.error("Skybox: could not mark read", file.path, error);
		return false;
	}
}
