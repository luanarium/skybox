import { ItemView, type WorkspaceLeaf } from "obsidian";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App as Skybox } from "./App";
import { SkyboxContext } from "./context";
import type SkyboxPlugin from "./main";
import { applyScopedTheme } from "./theme";
import { themeClass, VIEW_TYPE_SKYBOX } from "./types";

export class SkyboxView extends ItemView {
	private root: Root | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: SkyboxPlugin
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_SKYBOX;
	}

	getDisplayText(): string {
		return "Skybox";
	}

	getIcon(): string {
		return "layout-grid";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("skybox-content");
		this.root = createRoot(this.contentEl);
		this.render();
	}

	/** Re-renders with the current settings. */
	render(): void {
		this.contentEl.removeClasses(["theme-dark", "theme-light"]);
		const dressed = themeClass(this.plugin.settings);
		if (dressed) this.contentEl.addClass(dressed);
		applyScopedTheme(this.plugin.settings.theme);
		this.root?.render(
			<StrictMode>
				<SkyboxContext.Provider
					value={{
						app: this.app,
						index: this.plugin.index,
						settings: this.plugin.settings,
						leaf: this.leaf,
						bus: this.plugin.bus,
						interactions: this.plugin.interactions,
						saveSettings: () => this.plugin.saveSettings(),
						setStandalone: async (on: boolean) => {
							this.plugin.settings.standalone = on;
							await this.plugin.saveSettings();
							this.plugin.applyStandalone();
						},
					}}
				>
					<Skybox />
				</SkyboxContext.Provider>
			</StrictMode>
		);
	}

	async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
	}
}
