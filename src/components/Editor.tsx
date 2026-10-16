import { useEffect, useRef, useState } from "react";
import {
	MarkdownView,
	WorkspaceSidedock,
	type App,
	type TFile,
	type WorkspaceLeaf,
	type WorkspaceSplit,
} from "obsidian";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { borrow } from "../borrowed";
import { useTelegrid } from "../context";
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
	const { app, settings } = useTelegrid();
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
			// Detaching unloads the file, which saves any unsaved changes.
			leaf?.detach();
			leaf = null;
			giveBack();
		};

		const mount = async () => {
			leaf = app.workspace.createLeafInParent(outOfSight(app), 0);
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
			console.error("Telegrid: falling back to a plain editor", error);
			close();
			setBorrowed(false);
		});

		return close;
	}, [app, file.path, borrowed, settings.focusEditor]);

	if (!borrowed) return <SourceEditor file={file} />;
	return <div className="telegrid-editor is-borrowed" ref={host} />;
}

/**
 * Where the borrowed leaf is created: the right sidebar, which is collapsed in
 * standalone mode and usually out of the way otherwise. On mobile the sidebar
 * is a drawer rather than a split, so the root takes it instead.
 */
function outOfSight(app: App): WorkspaceSplit {
	const side = app.workspace.rightSplit;
	return side instanceof WorkspaceSidedock ? side : app.workspace.rootSplit;
}

const SAVE_DELAY = 600;

/** The fallback: CodeMirror 6 over the file's text, writing with `vault.process`. */
function SourceEditor({ file }: { file: TFile }) {
	const { app, settings } = useTelegrid();
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

	return <div className="telegrid-editor" ref={host} />;
}
