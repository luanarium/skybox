import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "obsidian";
import { useTelegrid } from "../context";
import { themeClass } from "../types";

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
	const { app, settings } = useTelegrid();
	const [host, setHost] = useState<HTMLElement | null>(null);

	useEffect(() => {
		let ours = false;
		const modal = new Modal(app);
		modal.modalEl.addClass("telegrid-sheet");
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
			 * A phone slides a modal out over a quarter of a second, and the card
			 * inside this one has already gone with the React tree that closed it:
			 * what slides away is an empty sheet. Obsidian's own flag turns that
			 * last animation off, so the grid is simply there again. Tapping
			 * outside or going back closes the modal itself, with the card still
			 * in it, and keeps the slide.
			 */
			animated(modal).shouldAnimate = false;
			modal.close();
		};
	}, [app, cls, onClose, settings]);

	return host ? createPortal(children, host) : null;
}

/** Obsidian's modals carry this flag; its own dialogs set it the same way. */
function animated(modal: Modal): Modal & { shouldAnimate: boolean } {
	return modal as Modal & { shouldAnimate: boolean };
}
