import { flushSync } from "react-dom";
import { Platform } from "obsidian";

/**
 * The View Transitions API, with an instant fallback where it is missing and
 * when the reader asks for less motion.
 */
type TransitionDocument = Document & {
	startViewTransition?: (callback: () => void | Promise<void>) => { finished: Promise<void> };
};

export function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function supportsViewTransitions(): boolean {
	return typeof (document as TransitionDocument).startViewTransition === "function";
}

/**
 * Runs the state update inside a view transition when one is available, and
 * resolves once the animation has finished.
 */
export function withTransition(update: () => void): Promise<void> {
	const doc = document as TransitionDocument;
	if (!doc.startViewTransition || prefersReducedMotion() || Platform.isMobile) {
		update();
		return Promise.resolve();
	}
	try {
		const transition = doc.startViewTransition(() => {
			flushSync(update);
		});
		return transition.finished.catch(() => undefined);
	} catch (error) {
		// A transition that will not start is no reason to stay put.
		console.error("Skybox: view transition refused", error);
		update();
		return Promise.resolve();
	}
}
