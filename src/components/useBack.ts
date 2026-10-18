import { useEffect } from "react";
import { type App, Modal, Platform } from "obsidian";

/**
 * Catching the Android back gesture for something that is not a modal.
 *
 * Obsidian takes back through Capacitor and pops its own stack of closeable
 * things, which modals put themselves on. A panel drawn inside a card is not
 * on that stack, so back reaches past it and closes the card instead, which
 * is the wrong thing to lose.
 *
 * So a modal is opened to stand in the stack and nothing else: its container
 * is hidden, it takes no focus, and the one thing it does is call back when
 * Obsidian closes it. The panel stays an ordinary element inside the card,
 * which is what keeps the keyboard working.
 */
export function useBack(app: App, active: boolean, onBack: () => void): void {
	useEffect(() => {
		if (!active || !Platform.isMobile) return;
		let ours = false;
		const catcher = new Modal(app);
		// Nothing to see, nothing to type in, nothing to take the keyboard.
		(catcher as Modal & { hasInitialInputFocus: boolean }).hasInitialInputFocus = false;
		(catcher as Modal & { shouldAnimate: boolean }).shouldAnimate = false;
		catcher.containerEl.addClass("skybox-back-catcher");
		catcher.onClose = () => {
			if (!ours) onBack();
		};
		catcher.open();
		// Hidden after opening, since opening is what puts it on the stack.
		catcher.containerEl.style.display = "none";
		return () => {
			ours = true;
			catcher.close();
		};
	}, [app, active, onBack]);
}
