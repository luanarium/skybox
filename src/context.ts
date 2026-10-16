import { createContext, useContext } from "react";
import type { App, WorkspaceLeaf } from "obsidian";
import type { Bus } from "./bus";
import type { VaultIndex } from "./index";
import type { TelegridSettings } from "./types";

export interface TelegridContextValue {
	app: App;
	index: VaultIndex;
	settings: TelegridSettings;
	leaf: WorkspaceLeaf;
	bus: Bus;
	saveSettings: () => Promise<void>;
	/** Turns standalone mode on or off and applies it at once. */
	setStandalone: (on: boolean) => Promise<void>;
}

export const TelegridContext = createContext<TelegridContextValue | null>(null);

export function useTelegrid(): TelegridContextValue {
	const value = useContext(TelegridContext);
	if (!value) throw new Error("Telegrid context is missing");
	return value;
}
