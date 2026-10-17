import { type App, TFile } from "obsidian";
import type { Bus } from "./bus";
import { ask } from "./confirm";
import type { VaultIndex } from "./index";
import { hashOf } from "./ingest";
import { ensureSidecar } from "./sidecar";
import { isImageExtension, type SkyboxSettings } from "./types";
import { guarded, isWriting } from "./writes";

/** How long after the app comes back a vault write counts as a shared item. */
const FOREGROUND_WINDOW = 5000;
/** How recently a file must have been written to count on a cold start. */
const COLD_START_WINDOW = 8000;

/**
 * Obsidian's own share target imports the shared item; the plugin cannot
 * replace it, so it reacts to the write instead and brings the grid back.
 *
 * Its own writes and files arriving from sync are ignored: it only reacts when
 * the app has just returned to the foreground, or, on a cold start from the
 * share sheet, to a file written in the last few seconds.
 */
export class ShareIntake {
	private becameVisible = Date.now();
	private handled = new Set<string>();

	constructor(
		private app: App,
		private index: VaultIndex,
		private bus: Bus,
		private settings: SkyboxSettings,
		private bringBack: () => Promise<void>
	) {}

	/** Registered on the window; call the returned function to detach. */
	watchForeground(): () => void {
		const onVisible = () => {
			if (document.visibilityState === "visible") this.becameVisible = Date.now();
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => document.removeEventListener("visibilitychange", onVisible);
	}

	onVaultWrite(file: TFile): void {
		if (isWriting()) return;
		if (Date.now() - this.becameVisible > FOREGROUND_WINDOW) return;
		void this.adopt(file);
	}

	/** Opened straight from the share sheet: look for what just landed. */
	coldStart(): void {
		const now = Date.now();
		const recent = this.app.vault
			.getFiles()
			.filter((file) => now - file.stat.mtime < COLD_START_WINDOW)
			.sort((a, b) => b.stat.mtime - a.stat.mtime);
		if (recent.length > 0) void this.adopt(recent[0]);
	}

	private async adopt(file: TFile): Promise<void> {
		if (this.handled.has(file.path)) return;
		this.handled.add(file.path);

		if (file.extension === "md") {
			// A shared note, new or appended to, simply surfaces.
			await this.surface(file.path);
			return;
		}
		if (!isImageExtension(file.extension)) return;

		const hash = await hashOf(this.app, file);
		const known = hash ? this.index.hashes().get(hash) : undefined;
		if (known && known.id !== file.path) {
			// Obsidian's share target has already written the copy, so the
			// question is whether to keep it. Dismissing the modal keeps it.
			// The grid comes forward first, so the question is asked there.
			await this.bringBack();
			const discard = await ask(this.app, {
				title: "Already in your vault",
				message: `“${file.name}” has the same contents as “${known.title}”. Keep this copy as well?`,
				confirm: "Move copy to trash",
				cancel: "Keep copy",
				destructive: true,
			});
			if (discard) {
				await guarded(() => this.app.fileManager.trashFile(file));
				await this.surface(known.id);
				return;
			}
		}
		await ensureSidecar(this.app, file);
		await this.surface(file.path);
	}

	private async surface(path: string): Promise<void> {
		await this.bringBack();
		this.bus.emit({ path, expand: this.settings.expandOnShare });
	}
}
