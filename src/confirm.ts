import { type App, Modal, Setting } from "obsidian";

export interface AskOptions {
	title: string;
	message: string;
	/** The answer the confirming button gives. */
	confirm: string;
	/** The answer dismissing the modal gives, so Escape is always the safe one. */
	cancel: string;
	/** Styles the confirming button as destructive. */
	destructive?: boolean;
}

/**
 * A yes-or-no question, asked in an Obsidian modal. Closing the modal — with
 * Escape, the background, or the X — answers with the cancelling choice.
 */
export function ask(app: App, options: AskOptions): Promise<boolean> {
	return new Promise((resolve) => new AskModal(app, options, resolve).open());
}

class AskModal extends Modal {
	private answered = false;

	constructor(
		app: App,
		private options: AskOptions,
		private resolve: (answer: boolean) => void
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.options.title);
		this.contentEl.createEl("p", { text: this.options.message });
		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText(this.options.cancel).onClick(() => this.answer(false))
			)
			.addButton((button) => {
				button.setButtonText(this.options.confirm).onClick(() => this.answer(true));
				// setWarning rather than the newer setDestructive, which needs a
				// more recent Obsidian than the manifest asks for.
				if (this.options.destructive) button.setWarning();
				else button.setCta();
			});
	}

	onClose(): void {
		// Dismissed rather than answered.
		if (!this.answered) this.resolve(false);
	}

	private answer(answer: boolean): void {
		this.answered = true;
		this.resolve(answer);
		this.close();
	}
}
