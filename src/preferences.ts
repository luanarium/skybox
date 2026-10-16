import { type App, Notice } from "obsidian";

interface SettingsWindow {
	setting?: {
		open(): void;
		openTabById(id: string): unknown;
	};
}

/**
 * Obsidian's settings window, opened straight on a plugin's own tab. The
 * settings window is not part of the public API, so this says where to look
 * rather than failing silently when it is not there.
 */
export function openPluginSettings(app: App, pluginId: string): void {
	const host = app as unknown as SettingsWindow;
	if (!host.setting) {
		new Notice("Telegrid's settings are in Obsidian's settings, under Community plugins.");
		return;
	}
	try {
		host.setting.open();
		host.setting.openTabById(pluginId);
	} catch (error) {
		console.error("Telegrid: could not open the settings window", error);
		new Notice("Telegrid's settings are in Obsidian's settings, under Community plugins.");
	}
}
