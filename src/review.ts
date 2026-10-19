import { Modal, Setting, type App } from "obsidian";

/**
 * The window that asks before anything is deleted.
 *
 * A deletion is the one thing a sync does that the other device cannot undo
 * by changing its mind, so neither end applies one on its own. The device
 * about to lose the file shows this list instead: switch on whatever you want
 * to keep, press the button, and everything still switched off goes to
 * Obsidian's trash rather than being erased.
 *
 * Dismissing the window keeps everything. Escape, the background and the X
 * are all the cautious answer, because a window nobody read is not consent.
 */

export interface ReviewOptions {
	title: string;
	message: string;
	/** Vault-relative paths, in the order they should be read. */
	items: string[];
	/** The button that applies the rest. */
	confirm: string;
}

/** Asks which of these to keep. Returns the paths to keep, not to delete. */
export function review(app: App, options: ReviewOptions): Promise<Set<string>> {
	return new Promise((resolve) => new ReviewModal(app, options, resolve).open());
}

class ReviewModal extends Modal {
	private kept = new Set<string>();
	private answered = false;

	constructor(
		app: App,
		private options: ReviewOptions,
		private resolve: (kept: Set<string>) => void
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.options.title);
		this.contentEl.createEl("p", { text: this.options.message });

		for (const path of this.options.items) {
			const row = new Setting(this.contentEl).setName(name(path));
			// The folder, only where it says something the name does not.
			if (path.includes("/")) row.setDesc(path);
			row.addToggle((toggle) =>
				toggle.setTooltip("Keep this one").onChange((value) => {
					if (value) this.kept.add(path);
					else this.kept.delete(path);
				})
			);
		}

		new Setting(this.contentEl).addButton((button) =>
			button
				.setButtonText(this.options.confirm)
				.setCta()
				.onClick(() => {
					this.answered = true;
					this.resolve(new Set(this.kept));
					this.close();
				})
		);
	}

	onClose(): void {
		// Nobody answered, so nothing is deleted.
		if (!this.answered) this.resolve(new Set(this.options.items));
	}
}

function name(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}
