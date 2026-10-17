import { PluginSettingTab, Setting, type App } from "obsidian";
import { BookmarkImport, findBookmarkFiles } from "./bookmarks";
import type SkyboxPlugin from "./main";
import { hasWindowHandle } from "./window";

export class SkyboxSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: SkyboxPlugin
	) {
		super(app, plugin);
	}

	/**
	 * Reading the browser's bookmarks file is the one thing here that reaches
	 * outside the vault, so it says so, shows the path it would read, and
	 * stays off until it is switched on.
	 */
	private bookmarkSettings(containerEl: HTMLElement): void {
		if (!BookmarkImport.available()) {
			new Setting(containerEl)
				.setName("Browser bookmarks")
				.setDesc(
					"Importing bookmarks reads a file on the computer, which a phone has no way " +
						"to do. This setting appears on desktop."
				);
			return;
		}

		new Setting(containerEl)
			.setName("Browser bookmarks")
			.setDesc(
				"Bookmark pages in your browser as you always have, and Skybox writes a note for " +
					"each new one while Obsidian is open. It reads one file, the Chromium " +
					"bookmarks file named below, and nothing else; it only ever adds, so a " +
					"bookmark deleted in the browser leaves its note where it is."
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.bookmarksEnabled).onChange(async (value) => {
					this.plugin.settings.bookmarksEnabled = value;
					await this.plugin.saveSettings();
					this.display();
				})
			);

		/*
		 * The path is set before anything is read, and read only when asked
		 * or once the switch is on. Filling it in from what is lying around
		 * and importing straight away would take whichever browser profile
		 * came first alphabetically, which is nobody's intention.
		 */
		const found = findBookmarkFiles();
		new Setting(containerEl)
			.setName("Bookmarks file")
			.setDesc(
				found.length > 0
					? `Found on this computer: ${found.join(", ")}`
					: "No Chromium bookmarks file turned up in the usual places. Paste the path to one."
			)
			.addText((text) =>
				text
					.setPlaceholder("~/.config/BraveSoftware/Brave-Browser/Default/Bookmarks")
					.setValue(this.plugin.settings.bookmarksPath)
					.onChange(async (value) => {
						this.plugin.settings.bookmarksPath = value;
						await this.plugin.saveSettings();
					})
			)
			.addExtraButton((button) =>
				button
					.setIcon("search")
					.setTooltip(found.length > 0 ? `Use ${found[0]}` : "Nothing found to use")
					.onClick(async () => {
						if (found.length === 0) return;
						this.plugin.settings.bookmarksPath = found[0];
						await this.plugin.saveSettings();
						this.display();
					})
			)
			.addButton((button) =>
				button.setButtonText("Sync now").onClick(() => void this.plugin.bookmarks.syncAloud())
			);

		new Setting(containerEl)
			.setName("Bookmarks folder")
			.setDesc("Where bookmark notes are written. The vault root if this is empty.")
			.addText((text) =>
				text
					.setPlaceholder("bookmarks")
					.setValue(this.plugin.settings.bookmarksFolder)
					.onChange(async (value) => {
						this.plugin.settings.bookmarksFolder = value;
						await this.plugin.saveSettings();
					})
			);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Intake folder")
			.setDesc("Where new notes and added files are written. Empty means the vault root.")
			.addText((text) =>
				text
					.setPlaceholder("Skybox")
					.setValue(this.plugin.settings.intakeFolder)
					.onChange(async (value) => {
						this.plugin.settings.intakeFolder = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Open on startup")
			.setDesc("Open the search pane when Obsidian loads.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.openOnStartup).onChange(async (value) => {
					this.plugin.settings.openOnStartup = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Standalone")
			.setDesc("Launch straight into the search pane and hide Obsidian's own chrome.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.standalone).onChange(async (value) => {
					this.plugin.settings.standalone = value;
					await this.plugin.saveSettings();
					this.plugin.applyStandalone();
				})
			);

		new Setting(containerEl)
			.setName("Appearance")
			.setDesc(
				"Dress the pane light or dark on its own, or let it wear whatever Obsidian is " +
					"wearing. A community theme that colours itself through the body may not follow."
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ follow: "Follow Obsidian", dark: "Dark", light: "Light" })
					.setValue(this.plugin.settings.theme)
					.onChange(async (value) => {
						this.plugin.settings.theme = value as "follow" | "dark" | "light";
						await this.plugin.saveSettings();
					})
			);

		this.bookmarkSettings(containerEl);

		new Setting(containerEl)
			.setName("Images embedded in notes")
			.setDesc(
				"An image a note embeds is part of that note rather than something kept for its " +
					"own sake, so it stays out of the grid while the search box is empty. It is " +
					"not hidden: any search finds it, and #embedded asks for exactly these. " +
					"Nothing is written to the vault — Obsidian already knows what embeds what."
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ hidden: "Out of the everything view", shown: "Shown like any other" })
					.setValue(this.plugin.settings.hideEmbedded ? "hidden" : "shown")
					.onChange(async (value) => {
						this.plugin.settings.hideEmbedded = value === "hidden";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Ignored folders")
			.setDesc(
				"Folders the grid leaves alone, one per line — an attachment folder whose images " +
					"belong inside notes, a templates folder, or another vault nested in this one. " +
					"Everything under them stays out: notes, images and their sidecars."
			)
			.addTextArea((area) => {
				area.setPlaceholder("attachments\ntemplates")
					.setValue(this.plugin.settings.ignoredFolders)
					.onChange(async (value) => {
						this.plugin.settings.ignoredFolders = value;
						await this.plugin.saveSettings();
						this.plugin.index.build();
					});
				area.inputEl.rows = 4;
			});

		new Setting(containerEl)
			.setName("Name notes from their first line")
			.setDesc(
				"A new note starts as Untitled. Once the typing settles, its first line becomes " +
					"its name — headings and list marks stripped — and anything linking to it " +
					"follows. Only notes still called Untitled are renamed, and only once."
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.nameFromFirstLine).onChange(async (value) => {
					this.plugin.settings.nameFromFirstLine = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Cover art")
			.setDesc(
				"Notes have no picture of their own, so the grid draws one — a gradient decided " +
					"by the note's path, the same every time. Nothing is written to the vault, and " +
					"a theme or snippet can restyle or hide it."
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.coverArt).onChange(async (value) => {
					this.plugin.settings.coverArt = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Columns on a phone")
			.setDesc("How many columns the grid packs into on a phone, whichever way it is held.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ auto: "From the screen's width", "1": "One", "2": "Two" })
					.setValue(this.plugin.settings.mobileColumns)
					.onChange(async (value) => {
						this.plugin.settings.mobileColumns = value as "auto" | "1" | "2";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Window controls")
			.setDesc(
				hasWindowHandle()
					? "Standalone mode hides the tab bar, so the band across the top of the pane " +
						"drags the window and maximizes it on a double-click."
					: "This window cannot be moved from the page. The band across the top of the " +
						"pane falls back to the system's drag region, and double-click does nothing."
			);

		new Setting(containerEl)
			.setName("Focus the editor on open")
			.setDesc(
				"Put the cursor in the note as it opens. Off, the note opens fully rendered and " +
					"a click starts the typing."
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.focusEditor).onChange(async (value) => {
					this.plugin.settings.focusEditor = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Expand shared items")
			.setDesc("Open a shared item in its editor instead of staying on the grid.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.expandOnShare).onChange(async (value) => {
					this.plugin.settings.expandOnShare = value;
					await this.plugin.saveSettings();
				})
			);
	}
}
