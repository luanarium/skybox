import { Notice, Platform, TFile, TFolder, normalizePath, type App } from "obsidian";
import type { VaultIndex } from "./index";
import { review } from "./review";
import { guarded } from "./writes";
import type { SkyboxSettings } from "./types";
import {
	HUB_BASE_HEADER,
	HUB_KEY_HEADER,
	hex,
	phraseKey,
	sameKey,
	hubComplaint,
	reviewSentence,
	hubFolders,
	withinServed,
	type HubEntry,
	type HubManifest,
} from "./sync";

/**
 * The listening half, which only a computer can be.
 *
 * Obsidian hands `require` to the renderer on desktop and not on a phone, so
 * this is the same guarded reach that reading a Maildir or a bookmarks file
 * already makes, and the same feature detection: no `require`, no hub. A
 * phone is never the hub; it asks.
 *
 * What it serves is small on purpose. A list of the files in the folders you
 * named, each with the hash of its bytes, and those bytes one file at a time.
 * No search, no writes, nothing about the vault beyond the folders you chose.
 * Every request carries a key derived from the phrase, and a request without
 * it is answered with a closed door rather than an explanation.
 */

/** Where the phrase lives: per-vault local storage, which does not sync. */
const PHRASE_KEY = "skybox:hub-phrase";

interface LocalStore {
	loadLocalStorage(key: string): string | null;
	saveLocalStorage(key: string, value: string | null): void;
}

export function readPhrase(app: App): string {
	return (app as unknown as LocalStore).loadLocalStorage(PHRASE_KEY)?.trim() ?? "";
}

export function writePhrase(app: App, phrase: string): void {
	(app as unknown as LocalStore).saveLocalStorage(PHRASE_KEY, phrase.trim() || null);
}

interface NodeRequest {
	method?: string;
	url?: string;
	headers: Record<string, string | string[] | undefined>;
	socket: { remoteAddress?: string };
	on(event: "data", listener: (chunk: Uint8Array) => void): void;
	on(event: "end" | "error", listener: (error?: Error) => void): void;
}

interface NodeResponse {
	writeHead(status: number, headers: Record<string, string>): void;
	end(body?: string | Uint8Array): void;
}

interface NodeServer {
	listen(port: number, host: string, done: () => void): void;
	close(done?: () => void): void;
	on(event: "error", listener: (error: Error & { code?: string }) => void): void;
}

interface NodeHttp {
	createServer(
		handler: (request: NodeRequest, response: NodeResponse) => void
	): NodeServer;
}

interface NodeOs {
	networkInterfaces(): Record<
		string,
		{ family: string; address: string; internal: boolean }[] | undefined
	>;
}

function node<T>(id: string): T | null {
	if (!Platform.isDesktopApp) return null;
	const host = window as unknown as { require?: (name: string) => unknown };
	try {
		return (host.require?.(id) as T) ?? null;
	} catch (error) {
		console.error(`Skybox: no ${id} for the hub`, error);
		return null;
	}
}

/** Whether this device could serve at all. */
export function canServe(): boolean {
	return node<NodeHttp>("http") !== null;
}

/** The addresses a phone could use to reach this computer. */
export function ownAddresses(port: number): string[] {
	const os = node<NodeOs>("os");
	if (!os) return [];
	const found: string[] = [];
	for (const addresses of Object.values(os.networkInterfaces())) {
		for (const address of addresses ?? []) {
			if (address.family === "IPv4" && !address.internal) {
				found.push(`${address.address}:${port}`);
			}
		}
	}
	return found;
}

export class Hub {
	private server: NodeServer | null = null;
	private key = "";
	/**
	 * Deletions another device has asked for, waiting to be read. Nothing
	 * here has happened yet: a device can ask, and only the person sitting
	 * in front of this vault can agree.
	 */
	private queued = new Map<string, string>();
	/**
	 * Paths somebody chose to keep, by the hash they were kept at, so the
	 * asking device can be told no rather than asked again every two
	 * minutes. Held in memory only: once a device has heard no it stops
	 * asking, so there is nothing left for this to remember.
	 */
	private kept = new Map<string, string>();
	private reviewing = false;
	/** Hashes, kept by path and mtime, so a quiet vault costs nothing. */
	private hashes = new Map<string, { mtime: number; size: number; hash: string }>();

	constructor(
		private app: App,
		private settings: SkyboxSettings,
		private index: VaultIndex
	) {}

	get listening(): boolean {
		return this.server !== null;
	}

	/** Start, or say in one sentence why not. Called again, it restarts. */
	async start(aloud = false): Promise<string> {
		this.stop();
		if (!this.settings.hubServe) return "The hub is switched off.";
		const http = node<NodeHttp>("http");
		if (!http) return "Only a computer can serve the hub, not a phone.";
		const phrase = readPhrase(this.app);
		if (!phrase) return "The hub needs a phrase before it will serve anything.";
		this.key = await phraseKey(phrase);

		const port = this.settings.hubPort;
		const server = http.createServer((request, response) => {
			void this.answer(request, response);
		});
		server.on("error", (error) => {
			const said =
				error.code === "EADDRINUSE"
					? `Port ${port} is already taken, so the hub is not serving.`
					: `The hub stopped: ${error.message}`;
			console.error("Skybox: hub error", error);
			new Notice(`Skybox: ${said}`);
			this.stop();
		});

		return await new Promise<string>((done) => {
			try {
				server.listen(port, "0.0.0.0", () => {
					this.server = server;
					const where = ownAddresses(port);
					const serving =
						where.length > 0
							? `Serving on ${where.join(", ")}.`
							: `Serving on port ${port}.`;
					// A hub with nothing to serve says so here, because every
					// other part of it will look correct from the other device.
					const trouble = this.complaint();
					const said = trouble ? `${serving} ${trouble}` : serving;
					if (aloud || trouble) {
						new Notice(`Skybox: ${said}`, trouble ? 15000 : undefined);
					}
					done(said);
				});
			} catch (error) {
				done(`The hub could not start: ${error instanceof Error ? error.message : error}`);
			}
		});
	}

	stop(): void {
		if (!this.server) return;
		try {
			this.server.close();
		} catch (error) {
			console.error("Skybox: the hub would not close", error);
		}
		this.server = null;
	}

	private async answer(request: NodeRequest, response: NodeResponse): Promise<void> {
		const head = {
			"access-control-allow-origin": "*",
			"access-control-allow-headers": `${HUB_KEY_HEADER}, ${HUB_BASE_HEADER}, content-type`,
			"access-control-allow-methods": "GET, PUT, DELETE, OPTIONS",
			"cache-control": "no-store",
		};
		try {
			if (request.method === "OPTIONS") {
				response.writeHead(204, head);
				response.end();
				return;
			}

			const sent = request.headers[HUB_KEY_HEADER];
			const key = Array.isArray(sent) ? (sent[0] ?? "") : (sent ?? "");
			if (!sameKey(key, this.key)) {
				// Nothing about what the right phrase would have been.
				response.writeHead(401, { ...head, "content-type": "application/json" });
				response.end(JSON.stringify({ error: "phrase" }));
				return;
			}

			const url = new URL(request.url ?? "/", "http://hub");
			if (url.pathname === "/skybox" || url.pathname === "/manifest") {
				const manifest = await this.manifest(url.pathname === "/skybox");
				response.writeHead(200, { ...head, "content-type": "application/json" });
				response.end(JSON.stringify(manifest));
				return;
			}
			if (url.pathname === "/file") {
				const asked = url.searchParams.get("path") ?? "";
				if (request.method === "DELETE") {
					await this.dropFile(asked, request, head, response);
					return;
				}
				if (request.method === "PUT") {
					await this.takeFile(asked, request, head, response);
					return;
				}
				await this.serveFile(asked, head, response);
				return;
			}

			response.writeHead(404, { ...head, "content-type": "application/json" });
			response.end(JSON.stringify({ error: "no such thing here" }));
		} catch (error) {
			console.error("Skybox: the hub could not answer", error);
			response.writeHead(500, { ...head, "content-type": "application/json" });
			response.end(JSON.stringify({ error: "the hub broke answering that" }));
		}
	}

	/** The files in the served folders. `bare` leaves the list out. */
	private async manifest(bare: boolean): Promise<HubManifest> {
		const files = bare ? [] : await this.entries();
		return { vault: this.app.vault.getName(), at: Date.now(), files };
	}

	private folders(): string[] {
		return hubFolders(this.settings);
	}

	/**
	 * What is wrong with the folders, for the switch to say. A hub serving an
	 * empty list looks entirely healthy from the other device, so this is
	 * checked here rather than left to be found out by a sync that takes
	 * nothing and calls it synced.
	 */
	complaint(): string {
		const folders = this.folders();
		const present = folders.filter(
			(folder) => this.app.vault.getAbstractFileByPath(folder) instanceof TFolder
		);
		return hubComplaint(folders, present);
	}

	private async entries(): Promise<HubEntry[]> {
		const folders = this.folders();
		const found: HubEntry[] = [];
		for (const file of this.app.vault.getFiles()) {
			if (!withinServed(file.path, folders)) continue;
			found.push({
				path: file.path,
				size: file.stat.size,
				mtime: file.stat.mtime,
				hash: await this.hashOf(file),
			});
		}
		return found;
	}

	/** The hash of a file's bytes, read again only when the file moved on. */
	private async hashOf(file: TFile): Promise<string> {
		const known = this.hashes.get(file.path);
		if (known && known.mtime === file.stat.mtime && known.size === file.stat.size) {
			return known.hash;
		}
		const bytes = await this.app.vault.readBinary(file);
		const hash = hex(await crypto.subtle.digest("SHA-256", bytes));
		this.hashes.set(file.path, { mtime: file.stat.mtime, size: file.stat.size, hash });
		return hash;
	}

	/**
	 * Taking a change from another device.
	 *
	 * The hub is the only one of the two that can be written to over the
	 * network, so this is the part that has to be careful. It takes nothing
	 * unless the phrase matched, the switch is on, the path is inside a
	 * served folder, the bytes hash to something, and the sender said what it
	 * believed the hub was holding. That last one is the whole safety of it:
	 * if the hub's copy is not what the sender thought, the change is refused
	 * rather than applied, and the sender finds out on its next sync.
	 */
	private async takeFile(
		asked: string,
		request: NodeRequest,
		head: Record<string, string>,
		response: NodeResponse
	): Promise<void> {
		const refuse = (status: number, error: string) => {
			response.writeHead(status, { ...head, "content-type": "application/json" });
			response.end(JSON.stringify({ error }));
		};

		if (!this.settings.hubAccept) {
			refuse(403, "this hub is not taking changes");
			return;
		}
		const path = normalizePath(asked);
		if (!withinServed(path, this.folders())) {
			refuse(403, "not a file this hub serves");
			return;
		}

		let bytes: Uint8Array;
		try {
			bytes = await body(request);
		} catch (error) {
			refuse(error instanceof TooMuch ? 413 : 400, String(error instanceof Error ? error.message : error));
			return;
		}

		const sent = request.headers[HUB_BASE_HEADER];
		const base = (Array.isArray(sent) ? (sent[0] ?? "") : (sent ?? "")).trim();
		const existing = this.app.vault.getAbstractFileByPath(path);
		const file = existing instanceof TFile ? existing : null;
		const holding = file ? await this.hashOf(file) : "";

		if (holding !== base) {
			// Either somebody changed it here after the sender read the
			// manifest, or the sender is working from a copy this hub has
			// never agreed to. Both are the sender's to sort out, not this
			// one's to overwrite.
			refuse(409, file ? "the hub's copy has changed since" : "the hub has no such file");
			return;
		}

		const hash = hex(await crypto.subtle.digest("SHA-256", bytes));
		const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
		await guarded(async () => {
			if (file) {
				await this.app.vault.modifyBinary(file, buffer);
				this.index.ensure(file);
				return;
			}
			await this.mkdirs(path);
			this.index.ensure(await this.app.vault.createBinary(path, buffer));
		});
		this.hashes.delete(path);

		response.writeHead(200, { ...head, "content-type": "application/json" });
		response.end(JSON.stringify({ hash }));
	}

	/**
	 * A request to delete a file, which is a request and nothing more.
	 *
	 * The asking device cannot know whether this vault still wants the file,
	 * so it does not get to decide. The path is checked and the hash it
	 * expected is compared with what is here, and then it goes on a list for
	 * somebody to read. "Kept" is a real answer, sent back the next time the
	 * device asks, so it stops asking and takes its copy back instead.
	 */
	private async dropFile(
		asked: string,
		request: NodeRequest,
		head: Record<string, string>,
		response: NodeResponse
	): Promise<void> {
		const say = (status: number, said: Record<string, unknown>) => {
			response.writeHead(status, { ...head, "content-type": "application/json" });
			response.end(JSON.stringify(said));
		};

		if (!this.settings.hubAccept) {
			say(403, { error: "this hub is not taking changes" });
			return;
		}
		const path = normalizePath(asked);
		if (!withinServed(path, this.folders())) {
			say(403, { error: "not a file this hub serves" });
			return;
		}

		const existing = this.app.vault.getAbstractFileByPath(path);
		if (!(existing instanceof TFile)) {
			// Already gone, which is the thing being asked for.
			say(200, { gone: true });
			return;
		}
		const holding = await this.hashOf(existing);
		const sent = request.headers[HUB_BASE_HEADER];
		const base = (Array.isArray(sent) ? (sent[0] ?? "") : (sent ?? "")).trim();
		if (holding !== base) {
			say(409, { error: "the hub's copy has changed since" });
			return;
		}
		if (this.kept.get(path) === holding) {
			say(409, { error: "kept" });
			return;
		}

		this.queued.set(path, holding);
		say(202, { queued: true });
		void this.review();
	}

	/**
	 * Reading the list, which only happens in front of somebody. A window
	 * rather than a notice, because the choice is per file and a notice has
	 * nowhere to put that.
	 */
	private async review(): Promise<void> {
		if (this.reviewing || this.queued.size === 0) return;
		this.reviewing = true;
		try {
			const asked = [...this.queued.keys()];
			const keeping = await review(this.app, {
				title: "Deleted on another device",
				message:
					`Another device has deleted ${asked.length === 1 ? "this" : `these ${asked.length}`}, ` +
					"and is asking this vault to do the same. Switch on anything you want " +
					"to keep here, and it goes back to that device instead. The rest go to " +
					"the trash. Closing this window keeps the lot.",
				items: asked,
				confirm: "Apply",
			});

			let removed = 0;
			for (const path of asked) {
				const hash = this.queued.get(path) ?? "";
				this.queued.delete(path);
				if (keeping.has(path)) {
					this.kept.set(path, hash);
					continue;
				}
				const file = this.app.vault.getAbstractFileByPath(path);
				// Obsidian's own trash, so the user's setting decides whether
				// that means .trash or the system bin. Nothing is erased here.
				if (file) await this.app.fileManager.trashFile(file);
				this.hashes.delete(path);
				removed++;
			}
			new Notice(`Skybox: ${reviewSentence(removed, keeping.size)}`);
		} catch (error) {
			console.error("Skybox: the review went wrong", error);
		} finally {
			this.reviewing = false;
			// Something may have arrived while the window was open.
			if (this.queued.size > 0) void this.review();
		}
	}

	private async mkdirs(path: string): Promise<void> {
		const parts = path.split("/").slice(0, -1);
		let walked = "";
		for (const part of parts) {
			walked = walked ? `${walked}/${part}` : part;
			if (!(await this.app.vault.adapter.exists(walked))) {
				await this.app.vault.adapter.mkdir(walked);
			}
		}
	}

	private async serveFile(
		asked: string,
		head: Record<string, string>,
		response: NodeResponse
	): Promise<void> {
		const path = normalizePath(asked);
		if (!withinServed(path, this.folders())) {
			response.writeHead(403, { ...head, "content-type": "application/json" });
			response.end(JSON.stringify({ error: "not a file this hub serves" }));
			return;
		}
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			response.writeHead(404, { ...head, "content-type": "application/json" });
			response.end(JSON.stringify({ error: "no such file" }));
			return;
		}
		const bytes = new Uint8Array(await this.app.vault.readBinary(file));
		response.writeHead(200, {
			...head,
			"content-type": "application/octet-stream",
			"content-length": String(bytes.byteLength),
			"x-skybox-hash": await this.hashOf(file),
		});
		response.end(bytes);
	}
}

/** A file bigger than this is not something a sync should be moving blind. */
const MOST = 128 * 1024 * 1024;

class TooMuch extends Error {}

/** The bytes of a request, or an error rather than an unbounded buffer. */
function body(request: NodeRequest): Promise<Uint8Array> {
	return new Promise((done, fail) => {
		const chunks: Uint8Array[] = [];
		let size = 0;
		request.on("data", (chunk) => {
			size += chunk.byteLength;
			if (size > MOST) {
				fail(new TooMuch("that file is too big for the hub to take"));
				return;
			}
			chunks.push(chunk);
		});
		request.on("end", () => {
			const all = new Uint8Array(size);
			let at = 0;
			for (const chunk of chunks) {
				all.set(chunk, at);
				at += chunk.byteLength;
			}
			done(all);
		});
		request.on("error", (error) => fail(error ?? new Error("the request broke")));
	});
}
