import { type App, Notice, TFile, TFolder, normalizePath } from "obsidian";
import type { VaultIndex } from "./index";
import { isImageExtension, sidecarPathFor, type Item, type TelegridSettings } from "./types";
import { guarded } from "./writes";

export interface IngestResult {
	/** Path of the card's primary file. */
	path: string;
	/** False when nothing was written because the content was already here. */
	created: boolean;
	/** The card that already held this content, if there was one. */
	duplicate: Item | null;
}

/** Asked before a second copy of known content is written. */
export type DuplicateAnswer = (existing: Item) => Promise<boolean>;

/**
 * The one way files enter the vault: hash the content, write the file and a
 * sidecar note carrying the hash. When the hash is already known the caller is
 * asked whether to add it again; without an answer to ask for, the existing
 * card stands and nothing is written. Returns null for anything that is
 * neither an image nor a note.
 *
 * Where the content cannot be hashed, the file is still taken in — without a
 * hash, and so without dedupe.
 */
export async function ingest(
	app: App,
	index: VaultIndex,
	settings: TelegridSettings,
	file: File,
	askAnyway?: DuplicateAnswer
): Promise<IngestResult | null> {
	const extension = extensionOf(file.name);
	const isImage = isImageExtension(extension);
	const isNote = extension === "md";
	if (!isImage && !isNote) return null;

	const data = await file.arrayBuffer();
	const hash = await sha256(data);

	const known = hash ? index.hashes().get(hash) ?? null : null;
	if (known && !(askAnyway && (await askAnyway(known)))) {
		return { path: known.id, created: false, duplicate: known };
	}

	return guarded(async () => {
		const folder = await ensureFolder(app, settings.intakeFolder);
		const path = await uniquePath(app, folder, file.name);
		if (isImage) {
			await app.vault.createBinary(path, data);
			await app.vault.create(sidecarPathFor(path), sidecarNote(hash));
			return { path, created: true, duplicate: known };
		}
		const created = await app.vault.create(path, new TextDecoder().decode(data));
		await app.fileManager.processFrontMatter(created, (frontmatter) => {
			frontmatter.hash = hash;
		});
		return { path, created: true, duplicate: known };
	});
}

/** A new, empty note in the intake folder. */
export async function createNote(
	app: App,
	settings: TelegridSettings,
	title = "Untitled"
): Promise<TFile> {
	return guarded(async () => {
		const folder = await ensureFolder(app, settings.intakeFolder);
		const path = await uniquePath(app, folder, `${title}.md`);
		return app.vault.create(path, "");
	});
}

/** Hash of a file already in the vault, for sidecars written before dedupe. */
export async function hashOf(app: App, file: TFile): Promise<string | null> {
	return sha256(await app.vault.readBinary(file));
}

/** Said once, where the browser will not hash. */
let warned = false;

/**
 * The content hash every intake route dedupes by. `crypto.subtle` needs a
 * secure context, which Obsidian's own windows are; somewhere it is missing,
 * this says so once and returns null rather than swallowing the import.
 */
export async function sha256(data: ArrayBuffer): Promise<string | null> {
	try {
		const digest = await crypto.subtle.digest("SHA-256", data);
		return [...new Uint8Array(digest)]
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join("");
	} catch (error) {
		console.error("Telegrid: this browser will not hash content", error);
		if (!warned) {
			warned = true;
			new Notice("Telegrid cannot hash content here, so duplicates will not be spotted.");
		}
		return null;
	}
}

export function sidecarNote(hash: string | null): string {
	return hash ? `---\ntags: []\nhash: ${hash}\n---\n\n` : "---\ntags: []\n---\n\n";
}

function extensionOf(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

async function ensureFolder(app: App, folder: string): Promise<string> {
	const path = normalizePath(folder || "/");
	if (path === "/" || path === "") return "";
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFolder) return path;
	if (!existing) await app.vault.createFolder(path);
	return path;
}

/** `name.png`, then `name 1.png`, until nothing is in the way. */
async function uniquePath(app: App, folder: string, name: string): Promise<string> {
	const dot = name.lastIndexOf(".");
	const stem = dot === -1 ? name : name.slice(0, dot);
	const extension = dot === -1 ? "" : name.slice(dot);
	for (let n = 0; ; n++) {
		const candidate = normalizePath(
			`${folder ? `${folder}/` : ""}${stem}${n ? ` ${n}` : ""}${extension}`
		);
		const taken =
			app.vault.getAbstractFileByPath(candidate) ||
			(extension === ".md" ? null : app.vault.getAbstractFileByPath(sidecarPathFor(candidate)));
		if (!taken) return candidate;
	}
}
