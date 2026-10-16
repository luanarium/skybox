import { Platform } from "obsidian";

interface NativeWindow {
	isMaximized(): boolean;
	maximize(): void;
	unmaximize(): void;
	getPosition(): number[];
	setPosition(x: number, y: number): void;
}

/**
 * Maximizing is the window's business, and Obsidian reaches it through
 * Electron: its own titlebar buttons call `maximize()` and `unmaximize()` on
 * the Electron window, and it wires double-click to them on macOS only.
 *
 * This is the one place the plugin steps outside Obsidian's API and the
 * browser. It is desktop-only, it is feature-detected, and it does nothing at
 * all when the handle is not there — on Android the function never runs.
 */
function nativeWindow(): NativeWindow | null {
	if (!Platform.isDesktopApp) return null;
	type Electron = { remote?: { getCurrentWindow?: () => NativeWindow } };
	const host = window as unknown as {
		require?: (id: string) => unknown;
		electron?: Electron;
	};
	try {
		// Obsidian reaches Electron both ways; whichever is there will do.
		const electron =
			host.electron ??
			(typeof host.require === "function" ? (host.require("electron") as Electron) : null);
		return electron?.remote?.getCurrentWindow?.() ?? null;
	} catch (error) {
		console.error("Telegrid: no window handle", error);
		return null;
	}
}

/** Whether the window can be moved and maximized from the page. */
export function hasWindowHandle(): boolean {
	return nativeWindow() !== null;
}

export function toggleMaximize(): void {
	const win = nativeWindow();
	if (!win) return;
	if (win.isMaximized()) win.unmaximize();
	else win.maximize();
}

/**
 * Moves the window with the pointer, the way a titlebar does. Obsidian's own
 * draggable region is the tab header bar, which standalone mode hides, and a
 * CSS drag region would swallow the clicks the band needs for double-clicking,
 * so the move is followed here instead.
 *
 * Screen coordinates, because the window moves out from under client ones.
 */
export function startWindowDrag(event: { button: number; screenX: number; screenY: number }): void {
	const win = nativeWindow();
	if (!win || event.button !== 0) return;
	// Dragging a maximized window restores it first, as everywhere else.
	if (win.isMaximized()) win.unmaximize();

	const [originX, originY] = win.getPosition();
	const startX = event.screenX;
	const startY = event.screenY;
	let frame = 0;
	let x = originX;
	let y = originY;

	const onMove = (move: MouseEvent) => {
		x = originX + (move.screenX - startX);
		y = originY + (move.screenY - startY);
		if (frame) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			win.setPosition(Math.round(x), Math.round(y));
		});
	};

	const onUp = () => {
		document.removeEventListener("mousemove", onMove);
		document.removeEventListener("mouseup", onUp);
		if (frame) cancelAnimationFrame(frame);
	};

	document.addEventListener("mousemove", onMove);
	document.addEventListener("mouseup", onUp);
}
