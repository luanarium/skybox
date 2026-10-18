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
		/*
		 * Nothing to see, nothing to type in, nothing to take the keyboard.
		 * A modal takes focus when it opens and gives it back to wherever it
		 * was when it closes, and this one is standing in a stack rather than
		 * being looked at: both would pull the cursor out of the box the
		 * person is typing into, which is the whole thing this must not do.
		 */
		const flags = catcher as Modal & {
			hasInitialInputFocus: boolean;
			shouldRestoreSelection: boolean;
			shouldAnimate: boolean;
		};
		flags.hasInitialInputFocus = false;
		flags.shouldRestoreSelection = false;
		flags.shouldAnimate = false;
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
