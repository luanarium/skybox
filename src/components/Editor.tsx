import { useEffect, useRef, useState } from "react";
import {
	MarkdownView,
	Platform,
	WorkspaceSidedock,
	type App,
	type TFile,
	type WorkspaceLeaf,
} from "obsidian";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { borrow } from "../borrowed";
import { useSkybox } from "../context";
import { guarded } from "../writes";

/**
 * The expanded note is edited in Obsidian's own markdown editor: a real
 * markdown leaf is created out of sight, and its view is borrowed into the
 * overlay. That brings live preview with it — headings, links, embeds and
 * images render as they are typed — and the view saves the file itself.
 *
 * If a leaf cannot be borrowed, the overlay falls back to a plain CodeMirror
 * editor over the file's text.
 */
export function Editor({ file }: { file: TFile }) {
	const { app, settings } = useSkybox();
	const host = useRef<HTMLDivElement>(null);
	const [borrowed, setBorrowed] = useState(true);

	useEffect(() => {
		const parent = host.current;
		if (!parent || !borrowed) return;
		let leaf: WorkspaceLeaf | null = null;
		let closed = false;
		const giveBack = borrow();

		const close = () => {
			if (closed) return;
			closed = true;
			const spent = leaf;
			leaf = null;
			/*
			 * Detaching unloads the file, which saves any unsaved changes, and
			 * sends the workspace off to rearrange itself around the leaf that
			 * has gone. That is work in the frame that has to paint the grid
			 * again, so it waits for the frame after instead.
			 */
			window.setTimeout(() => {
				spent?.detach();
				giveBack();
			}, 0);
		};

		const mount = async () => {
			leaf = spareLeaf(app);
			await leaf.setViewState({
				type: "markdown",
				// Live preview: the source mode that renders as it goes.
				state: { file: file.path, mode: "source", source: false },
			});
			if (closed) {
				close();
				return;
			}
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) throw new Error("not a markdown view");
			parent.appendChild(view.containerEl);
			// Unfocused, live preview keeps the first line rendered as a
			// heading rather than showing its markup under a cursor.
			if (settings.focusEditor) view.editor.focus();
		};

		mount().catch((error) => {
			console.error("Skybox: falling back to a plain editor", error);
			close();
			setBorrowed(false);
		});

		return close;
		// The file itself, not its path: a rename keeps the same `TFile`, and
		// the borrowed view follows it on its own. Watching the path would
		// tear the editor down and build it again mid-sentence.
	}, [app, file, borrowed, settings.focusEditor]);

	if (!borrowed) return <SourceEditor file={file} />;
	return <div className="skybox-editor is-borrowed" ref={host} />;
}

/**
 * Where the borrowed leaf is made: somewhere out of sight, because only its
 * view is wanted and the leaf itself should take no space.
 *
 * On a phone that has to be the drawer. The root split shows one leaf at a
 * time, so a leaf made there becomes the visible one, which hides the grid
 * behind the sheet and then shows an empty pane for as long as it takes to
 * detach: the blank beat before the grid comes back. `getRightLeaf` puts it
 * in the drawer instead, which is closed, so the grid stays painted the whole
 * time the card is open and is simply there again when the sheet slides away.
 */
function spareLeaf(app: App): WorkspaceLeaf {
	if (Platform.isMobile) {
		const drawered = app.workspace.getRightLeaf(true);
		if (drawered) return drawered;
	}
	const side = app.workspace.rightSplit;
	const parent = side instanceof WorkspaceSidedock ? side : app.workspace.rootSplit;
	return app.workspace.createLeafInParent(parent, 0);
}

const SAVE_DELAY = 600;

/** The fallback: CodeMirror 6 over the file's text, writing with `vault.process`. */
function SourceEditor({ file }: { file: TFile }) {
	const { app, settings } = useSkybox();
	const host = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const parent = host.current;
		if (!parent) return;
		let view: EditorView | null = null;
		let timer: number | null = null;
		let pending: string | null = null;
		let disposed = false;

		const flush = async () => {
			if (timer !== null) {
				window.clearTimeout(timer);
				timer = null;
			}
			if (pending === null) return;
			const content = pending;
			pending = null;
			await guarded(() => app.vault.process(file, () => content));
		};

		const schedule = (content: string) => {
			pending = content;
			if (timer !== null) window.clearTimeout(timer);
			timer = window.setTimeout(() => void flush(), SAVE_DELAY);
		};

		void app.vault.read(file).then((content) => {
			if (disposed) return;
			view = new EditorView({
				parent,
				state: EditorState.create({
					doc: content,
					extensions: [
						history(),
						keymap.of([...defaultKeymap, ...historyKeymap]),
						EditorView.lineWrapping,
						EditorView.updateListener.of((update) => {
							if (update.docChanged) schedule(update.state.doc.toString());
						}),
					],
				}),
			});
			if (settings.focusEditor) view.focus();
		});

		return () => {
			disposed = true;
			void flush();
			view?.destroy();
		};
	}, [app, file.path, settings.focusEditor]);

	return <div className="skybox-editor" ref={host} />;
}
