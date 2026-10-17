import { type App, MarkdownView, TFile } from "obsidian";
import { noteTitle, uniquePath } from "./ingest";
import type { SkyboxSettings } from "./types";
import { guarded } from "./writes";

/** A note the plus button made and nobody has named: `Untitled`, `Untitled 4`. */
const UNNAMED = /^Untitled(?: \d+)?$/;

/** How long the typing has to stop before a note is named. */
const SETTLE = 1500;

/**
 * Whether this note is still carrying the name the plugin gave it. Only those
 * are renamed: a note you named yourself keeps the name you gave it, however
 * its first line reads.
 */
export function unnamed(basename: string): boolean {
	return UNNAMED.test(basename);
}

/**
 * A new note starts as `Untitled`, which says nothing on a card. Once the
 * typing settles, the first line names the file — what Obsidian itself does
 * for a note created from a link, and what the title at the top of a page has
 * always been for.
 *
 * The rename goes through `fileManager`, so anything already linking to the
 * note follows it. It happens once: after that the note has a name, and
 * rewriting the first line is editing, not naming.
 */
export class Autonamer {
	private timers = new Map<string, number>();

	constructor(
		private app: App,
		private settings: SkyboxSettings
	) {}

	/** Called for every note that changes; most of them are not candidates. */
	touch(file: TFile): void {
		if (!this.settings.nameFromFirstLine) return;
		if (file.extension !== "md" || !unnamed(file.basename)) return;
		const pending = this.timers.get(file.path);
		if (pending !== undefined) window.clearTimeout(pending);
		this.timers.set(
			file.path,
			window.setTimeout(() => {
				this.timers.delete(file.path);
				void this.name(file);
			}, SETTLE)
		);
	}

	private async name(file: TFile): Promise<void> {
		// Typing may have carried on, or the note may be gone, since the timer.
		const current = this.app.vault.getAbstractFileByPath(file.path);
		if (!(current instanceof TFile) || !unnamed(current.basename)) return;

		const title = noteTitle(this.open(current) ?? (await this.app.vault.cachedRead(current)));
		// `noteTitle` falls back to `Untitled`, which is where we started.
		if (unnamed(title) || title.length < 2) return;

		// The vault root is `/`, which is not what a path is built from.
		const folder = current.parent?.path ?? "";
		const target = await uniquePath(this.app, folder === "/" ? "" : folder, `${title}.md`);
		if (target === current.path) return;
		try {
			await guarded(() => this.app.fileManager.renameFile(current, target));
		} catch (error) {
			// A name the filesystem will not take is not worth a notice: the
			// note is fine, it just keeps the name it has.
			console.error("Skybox: could not name the note from its first line", error);
		}
	}

	/**
	 * What the editor has, where the note is open in one. Obsidian writes a
	 * note to disk on its own schedule rather than on every keystroke, so a
	 * note being typed into is usually a character or two ahead of its file —
	 * and naming it from the file gave `image drop tes`.
	 */
	private open(file: TFile): string | null {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === file.path) {
				return view.editor.getValue();
			}
		}
		return null;
	}

	dispose(): void {
		for (const timer of this.timers.values()) window.clearTimeout(timer);
		this.timers.clear();
	}
}
