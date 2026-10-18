import { createContext, useContext } from "react";
import type { App, WorkspaceLeaf } from "obsidian";
import type { Bus } from "./bus";
import type { Interactions } from "./interactions";
import type { VaultIndex } from "./index";
import type { SkyboxSettings } from "./types";

export interface SkyboxContextValue {
	app: App;
	index: VaultIndex;
	settings: SkyboxSettings;
	leaf: WorkspaceLeaf;
	bus: Bus;
	/** What has happened to the cards that were shared, and what is unread. */
	interactions: Interactions;
	saveSettings: () => Promise<void>;
	/** Turns standalone mode on or off and applies it at once. */
	setStandalone: (on: boolean) => Promise<void>;
}

export const SkyboxContext = createContext<SkyboxContextValue | null>(null);

export function useSkybox(): SkyboxContextValue {
	const value = useContext(SkyboxContext);
	if (!value) throw new Error("Skybox context is missing");
	return value;
}
