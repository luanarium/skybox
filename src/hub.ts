import { Notice, Platform, TFile, normalizePath, type App } from "obsidian";
import type { SkyboxSettings } from "./types";
import {
	HUB_KEY_HEADER,
	hex,
	phraseKey,
	sameKey,
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
	/** Hashes, kept by path and mtime, so a quiet vault costs nothing. */
	private hashes = new Map<string, { mtime: number; size: number; hash: string }>();

	constructor(
		private app: App,
		private settings: SkyboxSettings
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
					const said =
						where.length > 0
							? `Serving on ${where.join(", ")}.`
							: `Serving on port ${port}.`;
					if (aloud) new Notice(`Skybox: ${said}`);
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
			"access-control-allow-headers": `${HUB_KEY_HEADER}, content-type`,
			"access-control-allow-methods": "GET, OPTIONS",
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
				await this.serveFile(url.searchParams.get("path") ?? "", head, response);
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
