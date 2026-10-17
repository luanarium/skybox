import { createContext, useContext } from "react";
import type { App, WorkspaceLeaf } from "obsidian";
import type { Bus } from "./bus";
import type { VaultIndex } from "./index";
import type { SkyboxSettings } from "./types";

export interface SkyboxContextValue {
	app: App;
	index: VaultIndex;
	settings: SkyboxSettings;
	leaf: WorkspaceLeaf;
	bus: Bus;
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
