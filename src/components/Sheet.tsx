import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "obsidian";
import { useSkybox } from "../context";
import { themeClass } from "../types";

/**
 * How a card inside a sheet asks to be closed: through the modal, so the
 * sheet slides away with the card still in it, the way Obsidian's own panels
 * leave. Outside a sheet there is nothing here and the card closes itself.
 */
const SheetDismiss = createContext<(() => void) | null>(null);

/** The sheet's way out where there is one, and the card's own where there is not. */
export function useDismiss(fallback: () => void): () => void {
	const sheet = useContext(SheetDismiss);
	return sheet ?? fallback;
}

/**
 * On a phone the expanded card lives in one of Obsidian's own modals: it
 * arrives as a full-screen sheet that scrolls, and because a modal is a
 * history handler, the Android back gesture closes it instead of leaving the
 * app. The card itself is rendered into the modal through a portal, so the
 * same components serve both platforms.
 */
export function Sheet({
	onClose,
	cls,
	children,
}: {
	onClose: () => void;
	/** An extra class on the modal, for styling one kind of sheet. */
	cls?: string;
	children: React.ReactNode;
}) {
	const { app, settings } = useSkybox();
	const [host, setHost] = useState<HTMLElement | null>(null);
	const sheet = useRef<Modal | null>(null);

	// Closing the modal animates it away and reports back through `onClose`.
	const dismiss = useCallback(() => sheet.current?.close(), []);

	useEffect(() => {
		let ours = false;
		const modal = new Modal(app);
		sheet.current = modal;
		modal.modalEl.addClass("skybox-sheet");
		if (cls) modal.modalEl.addClass(cls);
		// A modal is Obsidian's, not the pane's, so it is dressed to match.
		const dressed = themeClass(settings);
		if (dressed) modal.modalEl.addClass(dressed);
		modal.onClose = () => {
			setHost(null);
			// Back, or a tap outside: the grid has to be told.
			if (!ours) onClose();
		};
		modal.open();
		/*
		 * A modal arrives dressed for a dialog: a close button in the corner,
		 * and on a phone a header bar to hold it. The sheet is the card itself
		 * and its way out is the back arrow, so whatever the modal put beside
		 * its content goes — by what it is rather than by what it is called.
		 */
		for (const spare of Array.from(modal.modalEl.children)) {
			if (spare !== modal.contentEl) spare.remove();
		}
		setHost(modal.contentEl);
		return () => {
			ours = true;
			/*
			 * The card has already gone with the React tree that closed it, so
			 * an animation here would slide an empty sheet away: that is the
			 * blank beat before the grid. Obsidian's own flag turns it off.
			 * Closing through `dismiss` never comes this way round, and keeps
			 * the slide.
			 */
			animated(modal).shouldAnimate = false;
			modal.close();
			sheet.current = null;
		};
	}, [app, cls, onClose, settings]);

	return host
		? createPortal(<SheetDismiss.Provider value={dismiss}>{children}</SheetDismiss.Provider>, host)
		: null;
}

/** Obsidian's modals carry this flag; its own dialogs set it the same way. */
function animated(modal: Modal): Modal & { shouldAnimate: boolean } {
	return modal as Modal & { shouldAnimate: boolean };
}
