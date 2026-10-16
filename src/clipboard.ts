import { type App, Notice } from "obsidian";
import type { Item } from "./types";

/**
 * Copies what a card is: a note's text, or the image itself where the
 * clipboard will take it. Says what it did, since the clipboard cannot be
 * seen.
 */
export async function copyItem(app: App, item: Item): Promise<void> {
	try {
		if (item.kind === "note") {
			await navigator.clipboard.writeText(await app.vault.read(item.file));
			new Notice("Note copied");
			return;
		}
		await copyImage(app, item);
	} catch (error) {
		console.error("Telegrid: nothing could be copied", error);
		new Notice("Nothing could be copied");
	}
}

async function copyImage(app: App, item: Item): Promise<void> {
	const type = mimeOf(item.file.extension);
	const writer = navigator.clipboard as Clipboard & {
		write?: (items: ClipboardItem[]) => Promise<void>;
	};
	if (type && typeof ClipboardItem !== "undefined" && writer.write) {
		const data = await app.vault.readBinary(item.file);
		await writer.write([new ClipboardItem({ [type]: new Blob([data], { type }) })]);
		new Notice("Image copied");
		return;
	}
	// No image on this clipboard: its place in the vault is the next best thing.
	await navigator.clipboard.writeText(item.file.path);
	new Notice("Image path copied");
}

function mimeOf(extension: string): string | null {
	switch (extension.toLowerCase()) {
		case "png":
			return "image/png";
		case "jpg":
		case "jpeg":
			return "image/jpeg";
		case "gif":
			return "image/gif";
		case "webp":
			return "image/webp";
		case "svg":
			return "image/svg+xml";
		default:
			return null;
	}
}
