import { Notice, PluginSettingTab, Setting, type App } from "obsidian";
import { BookmarkImport, findBookmarkFiles } from "./bookmarks";
import { expandHome, homeDir } from "./bookmarks";
import { normalizeInstance } from "./mastodon";
import { clientFor, readToken, writeToken } from "./sharing";
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
					"each new one. It reads one file, the Chromium bookmarks file named below, " +
					"and asks each new page once for what it says about itself, so a note " +
					"carries the page's own description, author, date and picture rather than a " +
					"bare link. It only ever adds, so a bookmark deleted in the browser leaves " +
					"its note where it is. Leave this unconfigured and nothing happens: no file " +
					"is read, no page is fetched, no note is written, and your bookmarking " +
					"carries on as it is. For a page's full text, Obsidian's own Web Clipper " +
					"does that today, and these notes carry its properties, so the two sit side " +
					"by side and neither imports a page the other already saved."
			);

		new Setting(containerEl)
			.setName("Keep them coming")
			.setDesc(
				"Look for new bookmarks on their own: when Obsidian starts, when its window comes " +
					"back to the front, and every five minutes it is left open. A file that has " +
					"not changed costs nothing to look at. Off, the button below is the only way " +
					"anything is read."
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
				(found.length > 0
					? `Found on this computer: ${found.join(", ")}. `
					: "No Chromium bookmarks file turned up in the usual places. Paste the path to one. ") +
					"Sync now reads it once, whether or not the switch above is on."
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
			.setName("Keep the page's text")
			.setDesc(
				"Read the article out of each bookmarked page and keep it in the note, under a " +
					"heading of its own at the end, so the bookmark is searchable by what the " +
					"page said and survives the page going away. The reading is done by " +
					"Defuddle, the same library Obsidian's own Web Clipper uses. Off, a note " +
					"keeps the title, the link and what the page says about itself."
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.bookmarkArticle).onChange(async (value) => {
					this.plugin.settings.bookmarkArticle = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Preview images")
			.setDesc(
				"Show the picture a page offers for its own social cards, where it offers one, " +
					"in place of cover art. The picture is loaded from wherever the page keeps " +
					"it, so showing these cards reaches those hosts; off, cards draw cover art " +
					"and nothing is loaded. What the page said about itself is kept in the " +
					"note's properties either way."
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.bookmarkImages).onChange(async (value) => {
					this.plugin.settings.bookmarkImages = value;
					await this.plugin.saveSettings();
					this.plugin.index.build();
				})
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

	/**
	 * Sharing a card to Mastodon. The token is the one piece of this that is
	 * not kept with the settings: it goes to the vault's local storage, which
	 * does not sync and is not in the vault, so it travels no further than
	 * this computer.
	 */
	private sharingSettings(containerEl: HTMLElement): void {
		const connected = readToken(this.app) !== "";

		new Setting(containerEl)
			.setName("Share to Mastodon")
			.setDesc(
				"Tag a card and it is posted; take the tag away and the post goes with it. Both " +
					"ask first, and nothing is sent until a note carries the tag. The account's " +
					"token is kept on this computer, in storage that does not sync and is not " +
					"part of the vault, so it stays off your phone and out of your notes."
			);

		new Setting(containerEl)
			.setName("Instance")
			.setDesc("The server your account is on. Empty turns sharing off.")
			.addText((text) =>
				text
					.setPlaceholder("mastodon.social")
					.setValue(this.plugin.settings.mastodonInstance)
					.onChange(async (value) => {
						this.plugin.settings.mastodonInstance = normalizeInstance(value);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Access token")
			.setDesc(
				connected
					? "A token is stored on this computer. Replacing it here replaces it there; " +
						"emptying it disconnects. Revoking is done on your instance."
					: "Make one on your instance under Preferences, Development, New " +
						"application. Sharing needs write:statuses, write:media and " +
						"read:statuses; a wall also needs read:follows and write:follows " +
						"for the home timeline and the follow button."
			)
			.addText((text) => {
				text.setPlaceholder(connected ? "stored on this computer" : "paste the token")
					.setValue("")
					.onChange((value) => {
						writeToken(this.app, value);
					});
				text.inputEl.type = "password";
			})
			.addButton((button) =>
				button.setButtonText("Check").onClick(async () => {
					const client = clientFor(this.app, this.plugin.settings);
					if (!client) {
						new Notice("Skybox needs an instance and a token before it can check.");
						return;
					}
					try {
						const account = await client.verify();
						new Notice(`Connected as @${account.username}.`);
					} catch (error) {
						new Notice(
							`Skybox could not connect: ${error instanceof Error ? error.message : String(error)}`
						);
					}
					this.display();
				})
			);

		new Setting(containerEl)
			.setName("Sharing tag")
			.setDesc(
				"The tag that means share this. Pick one you would not type by accident, since " +
					"adding it to a note posts the card."
			)
			.addText((text) =>
				text
					.setPlaceholder("share")
					.setValue(this.plugin.settings.mastodonTag)
					.onChange(async (value) => {
						this.plugin.settings.mastodonTag = value.replace(/^#/, "").trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Who sees it")
			.setDesc("How a shared post is addressed, the same four choices Mastodon offers.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						public: "Public",
						unlisted: "Unlisted",
						private: "Followers only",
						direct: "Mentioned people only",
					})
					.setValue(this.plugin.settings.mastodonVisibility)
					.onChange(async (value) => {
						this.plugin.settings.mastodonVisibility = value;
						await this.plugin.saveSettings();
					})
			);
	}

	/**
	 * Mail, and direct messages that behave like mail. Nothing here fetches
	 * or sends: `mbsync` fills the Maildir and `msmtp` empties the outbox,
	 * which is why this asks for two paths rather than a password.
	 */
	private mailSettings(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Mail")
			.setDesc(
				"Parked, and left in: it works against a Maildir but has never met a real " +
					"mailbox. Conversations as cards. Something else fetches your mail into a Maildir, " +
					"usually mbsync, and something else sends what is left in the outbox, usually " +
					"msmtp; Skybox reads the one and writes the other, so no password and no mail " +
					"protocol come anywhere near the vault. Threads are written into the vault as " +
					"notes, so a phone has the mail without any of this. Leave the paths empty and " +
					"nothing happens."
			);

		new Setting(containerEl)
			.setName("Maildir")
			.setDesc("The mailbox to read, the one holding new and cur.")
			.addText((text) =>
				text
					.setPlaceholder("~/Mail/mail/INBOX")
					.setValue(this.plugin.settings.mailMaildir)
					.onChange(async (value) => {
						this.plugin.settings.mailMaildir = expandHome(value.trim(), homeDir());
						await this.plugin.saveSettings();
					})
			)
			.addButton((button) =>
				button.setButtonText("Read now").onClick(async () => {
					const written = await this.plugin.mail.sync();
					new Notice(written === 0 ? "No new conversations." : `${written} updated.`);
				})
			);

		new Setting(containerEl)
			.setName("Outbox")
			.setDesc("Where a reply is left for msmtp to send.")
			.addText((text) =>
				text
					.setPlaceholder("~/Mail/outbox")
					.setValue(this.plugin.settings.mailOutbox)
					.onChange(async (value) => {
						this.plugin.settings.mailOutbox = expandHome(value.trim(), homeDir());
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Your address")
			.setDesc("Which messages in a thread are yours, and what a reply is sent as.")
			.addText((text) =>
				text
					.setPlaceholder("you@example.net")
					.setValue(this.plugin.settings.mailAddress)
					.onChange(async (value) => {
						this.plugin.settings.mailAddress = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Conversations folder")
			.setDesc("Where thread notes are written.")
			.addText((text) =>
				text
					.setPlaceholder("mail")
					.setValue(this.plugin.settings.mailFolder)
					.onChange(async (value) => {
						this.plugin.settings.mailFolder = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Mastodon direct messages")
			.setDesc(
				"Bring direct messages in as conversations too, in the same cards and the same " +
					"window. This one works on a phone, since it is a call rather than a directory " +
					"on a computer, and it uses the account already connected above."
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.dmEnabled).onChange(async (value) => {
					this.plugin.settings.dmEnabled = value;
					await this.plugin.saveSettings();
					if (value) void this.plugin.dms.sync();
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
		this.sharingSettings(containerEl);
		this.mailSettings(containerEl);

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
					.addOptions({ auto: "From the screen's width", "1": "One", "2": "Two (the default)" })
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
