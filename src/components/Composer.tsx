import { useState } from "react";
import { Icon } from "./Icon";

interface ComposerProps {
	onSave: (text: string) => void;
	onClose: () => void;
	onAddFiles: () => void;
}

/** The quick note: type, save, and the card drops into the grid. */
export function Composer({ onSave, onClose, onAddFiles }: ComposerProps) {
	const [text, setText] = useState("");
	const ready = text.trim().length > 0;

	const save = () => {
		if (!ready) return;
		onSave(text);
	};

	return (
		<div className="telegrid-composer">
			<header className="telegrid-composer-head">
				<button className="telegrid-composer-close" aria-label="Close" onClick={onClose}>
					<Icon name="x" />
				</button>
				<span className="telegrid-composer-title">create a new note</span>
				<button
					className="telegrid-composer-save"
					disabled={!ready}
					onClick={save}
				>
					SAVE
				</button>
			</header>
			<textarea
				className="telegrid-composer-text"
				placeholder="what's on your mind"
				value={text}
				autoFocus
				onChange={(event) => setText(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
						event.preventDefault();
						save();
					}
				}}
			/>
			<footer className="telegrid-composer-foot">
				<button className="telegrid-composer-files" onClick={onAddFiles}>
					<Icon name="paperclip" />
					Add files
				</button>
			</footer>
		</div>
	);
}
