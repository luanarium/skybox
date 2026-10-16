import { useEffect } from "react";
import { ItemView, Platform } from "obsidian";
import { useTelegrid } from "../context";
import type { Item } from "../types";
import { Editor } from "./Editor";
import { Icon } from "./Icon";
import { MetadataBox } from "./MetadataBox";

interface NoteOverlayProps {
	item: Item;
	/** `keepFocus` false closes without taking the active pane back. */
	onClose: (keepFocus?: boolean) => void;
	onOpenPath: (path: string) => void;
}

export function NoteOverlay({ item, onClose, onOpenPath }: NoteOverlayProps) {
	const { app, leaf } = useTelegrid();

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	/** Opens the note in its own tab, carrying a way back to the grid. */
	const openInObsidian = async () => {
		const target = app.workspace.getLeaf("tab");
		await target.openFile(item.file);
		const view = target.view;
		if (view instanceof ItemView) {
			view.addAction("layout-grid", "Back to Telegrid", () => {
				void app.workspace.revealLeaf(leaf);
				// Revealing alone leaves the grid unfocused and the way-back
				// pill hanging around until something is clicked.
				app.workspace.setActiveLeaf(leaf, { focus: true });
			});
		}
		// The note's tab is the one the reader is heading for.
		onClose(false);
	};

	return (
		<div
			className="telegrid-overlay"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div className="telegrid-expanded">
				<header className="telegrid-expanded-head">
					{Platform.isMobile && (
						<button
							className="telegrid-back-arrow"
							aria-label="Back to the grid"
							onClick={() => onClose()}
						>
							<Icon name="arrow-left" />
						</button>
					)}
					<h2>{item.title}</h2>
					<div className="telegrid-expanded-actions">
						{/*
						 * A phone has no tabs to open into: the note would take
						 * the grid's own leaf and leave the sheet over nothing.
						 */}
						{!Platform.isMobile && (
							<button
								onClick={() => {
									void openInObsidian();
								}}
							>
								Open in Obsidian
							</button>
						)}
						<button className="telegrid-close" aria-label="Close" onClick={() => onClose()}>
							×
						</button>
					</div>
				</header>
				<div className="telegrid-expanded-body">
					<Editor file={item.file} />
					<MetadataBox
						note={item.file}
						file={item.file}
						tags={item.tags}
						onOpenPath={onOpenPath}
					/>
				</div>
			</div>
		</div>
	);
}
