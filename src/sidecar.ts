import type { App, TFile } from "obsidian";
import { hashOf } from "./ingest";
import { sidecarPathFor } from "./types";
import { guarded } from "./writes";

/** Images are not notes, so their tags and thoughts live in `<name>.<ext>.md`. */
export async function ensureSidecar(app: App, image: TFile): Promise<TFile> {
	const path = sidecarPathFor(image.path);
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing) return existing as TFile;
	const hash = await hashOf(app, image);
	return guarded(() => app.vault.create(path, `---\ntags: []\nhash: ${hash}\n---\n\n`));
}

/** The note's text below its frontmatter. */
export function splitFrontMatter(content: string): { matter: string; body: string } {
	if (!content.startsWith("---")) return { matter: "", body: content };
	const end = content.indexOf("\n---", 3);
	if (end === -1) return { matter: "", body: content };
	const after = end + 4;
	const newline = content.indexOf("\n", after);
	const cut = newline === -1 ? content.length : newline + 1;
	return { matter: content.slice(0, cut), body: content.slice(cut) };
}

export async function readBody(app: App, note: TFile): Promise<string> {
	return splitFrontMatter(await app.vault.read(note)).body;
}

export async function writeBody(app: App, note: TFile, body: string): Promise<void> {
	await guarded(() =>
		app.vault.process(note, (content) => {
			const { matter } = splitFrontMatter(content);
			return matter ? `${matter}${body}` : body;
		})
	);
}
