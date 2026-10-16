import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "obsidian";
import { useTelegrid } from "../context";

/**
 * On a phone the expanded card lives in one of Obsidian's own modals: it
 * arrives as a full-screen sheet that scrolls, and because a modal is a
 * history handler, the Android back gesture closes it instead of leaving the
 * app. The card itself is rendered into the modal through a portal, so the
 * same components serve both platforms.
 */
export function Sheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
	const { app } = useTelegrid();
	const [host, setHost] = useState<HTMLElement | null>(null);

	useEffect(() => {
		let ours = false;
		const modal = new Modal(app);
		modal.modalEl.addClass("telegrid-sheet");
		modal.onClose = () => {
			setHost(null);
			// Back, or a tap outside: the grid has to be told.
			if (!ours) onClose();
		};
		modal.open();
		setHost(modal.contentEl);
		return () => {
			ours = true;
			modal.close();
		};
	}, [app, onClose]);

	return host ? createPortal(children, host) : null;
}
