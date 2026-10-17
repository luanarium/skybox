import { type App, Menu, Notice, Platform } from "obsidian";
import type { SkyboxSettings } from "./types";

/**
 * Switching vaults is the application's business rather than a vault's, so
 * Obsidian keeps it in the main process and reaches it over Electron's IPC:
 * `vault-list` for the vaults it knows about, `vault-open` to open one in a
 * window of its own. Its own switcher is a menu of exactly this, with a check
 * against the vault you are in.
 *
 * So this is the second place the plugin steps outside Obsidian's API, for the
 * same reason as the first (`src/window.ts`): there is no public route to it.
 * It is desktop-only, feature-detected, and where the handle is missing the
 * menu falls back to Obsidian's own vault chooser, which can do everything
 * here and more. Android never runs it.
 */
interface Ipc {
	sendSync(channel: string, ...args: unknown[]): unknown;
}

function ipc(): Ipc | null {
	if (!Platform.isDesktopApp) return null;
	type Electron = { ipcRenderer?: Ipc };
	const host = window as unknown as {
		require?: (id: string) => unknown;
		electron?: Electron;
	};
	try {
		const electron =
			host.electron ??
			(typeof host.require === "function" ? (host.require("electron") as Electron) : null);
		return electron?.ipcRenderer ?? null;
	} catch (error) {
		console.error("Skybox: no vault list", error);
		return null;
	}
}

export interface KnownVault {
	path: string;
	name: string;
	/** The vault this window has open. */
	current: boolean;
}

/** Every vault Obsidian remembers, most recently opened first. */
export function knownVaults(app: App): KnownVault[] {
	const channel = ipc();
	if (!channel) return [];
	try {
		const listed = channel.sendSync("vault-list");
		if (!listed || typeof listed !== "object") return [];
		const here = app.vault.getName();
		return Object.values(listed as Record<string, { path?: string; ts?: number }>)
			.filter((entry): entry is { path: string; ts?: number } => typeof entry.path === "string")
			.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
			.map((entry) => {
				const name = entry.path.split("/").filter(Boolean).pop() ?? entry.path;
				return { path: entry.path, name, current: name === here };
			});
	} catch (error) {
		console.error("Skybox: could not read the vault list", error);
		return [];
	}
}

/**
 * A vault is bound to a window when the window starts — `app.vault` and
 * everything hanging off it is that one folder — so no plugin can swap the
 * vault underneath itself. Obsidian's own switcher opens the other vault in a
 * new window and, in switch mode, closes the one it was called from: the
 * screen is handed over, which is the nearest thing to changing vault in
 * place. `replace` does that; `beside` leaves this window standing.
 *
 * The close only happens once the main process has confirmed the other vault
 * opened, so a vault that has been moved or renamed leaves this window alone.
 */
function openVault(path: string, replace: boolean): void {
	const channel = ipc();
	if (!channel) return;
	try {
		if (channel.sendSync("vault-open", path, false) === true) {
			if (replace) window.close();
			return;
		}
	} catch (error) {
		console.error("Skybox: could not open that vault", error);
	}
	new Notice("Obsidian could not open that vault. It may have been moved or renamed.");
}

interface VaultChooser {
	commands?: { executeCommandById(id: string): unknown };
}

/** Obsidian's own vault window: the list, and the way a new vault is made. */
function openVaultChooser(app: App): void {
	const host = app as unknown as VaultChooser;
	try {
		if (host.commands?.executeCommandById("app:open-vault")) return;
	} catch (error) {
		console.error("Skybox: could not open the vault chooser", error);
	}
	new Notice("Vaults are managed from Obsidian's vault window.");
}

/**
 * The vaults menu: the ones Obsidian knows about, then the way to a new one.
 * Making a vault asks for a name and a place for it, which is Obsidian's own
 * window's job, so that is where the last item goes.
 */
export function showVaultMenu(app: App, settings: SkyboxSettings, event: MouseEvent): void {
	const menu = new Menu();
	const vaults = knownVaults(app);
	const replace = settings.vaultSwitch === "replace";

	for (const vault of vaults) {
		menu.addItem((entry) =>
			entry
				.setTitle(vault.name)
				.setChecked(vault.current)
				.onClick(() => {
					if (!vault.current) openVault(vault.path, replace);
				})
		);
	}

	if (vaults.length > 0) menu.addSeparator();
	menu.addItem((entry) =>
		entry
			.setTitle(vaults.length > 0 ? "New vault…" : "Manage vaults…")
			.setIcon("vault")
			.onClick(() => openVaultChooser(app))
	);

	menu.showAtMouseEvent(event);
}
