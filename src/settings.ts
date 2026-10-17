import { PluginSettingTab, Setting, type App } from "obsidian";
import type SkyboxPlugin from "./main";
import { knownVaults } from "./vaults";
import { hasWindowHandle } from "./window";

export class SkyboxSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: SkyboxPlugin
	) {
		super(app, plugin);
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

		const vaults = knownVaults(this.app);
		new Setting(containerEl)
			.setName("Vaults")
			.setDesc(
				vaults.length > 0
					? `The band's vaults button lists the ${vaults.length} ${
							vaults.length === 1 ? "vault" : "vaults"
						} Obsidian remembers. A vault belongs to the window it opened in, so ` +
						"choosing another one is a new window either way; a new vault is made in " +
						"Obsidian's own vault window, which that menu's last item opens."
					: "The band's vaults button opens Obsidian's vault window, where vaults are " +
						"chosen and created. This window gave no vault list for the menu to show."
			);

		new Setting(containerEl)
			.setName("Choosing another vault")
			.setDesc(
				"Whether this window gets out of the way once the other vault is up. Closing it " +
					"reads as the app changing vault rather than collecting windows; keeping it is " +
					"what you want when the two vaults are being used side by side."
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						replace: "Close this window",
						beside: "Leave this window open",
					})
					.setValue(this.plugin.settings.vaultSwitch)
					.onChange(async (value) => {
						this.plugin.settings.vaultSwitch = value as "replace" | "beside";
						await this.plugin.saveSettings();
					})
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
