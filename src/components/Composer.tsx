import { useEffect, useRef, useState } from "react";
import { Notice } from "obsidian";
import { ask } from "../confirm";
import { useSkybox } from "../context";
import { createNote, ingest } from "../ingest";

/**
 * The quick way in, on desktop: a box to write in that also takes files.
 *
 * What a dropped file means depends on what is already written. Dropped into
 * an empty box it is a thing in its own right, taken in as its own card, the
 * same as dropping it on the grid. Dropped into a box with words in it, it is
 * part of what is being written, so it is embedded where the cursor was.
 *
 * Both routes go through `ingest`, so a file already in the vault asks before
 * it is written a second time, whichever way it arrived.
 */
export function Composer({ onClose, onOpenPath }: { onClose: () => void; onOpenPath: (path: string) => void }) {
	const { app, index, settings } = useSkybox();
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const [over, setOver] = useState(false);
	const box = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		box.current?.focus();
	}, []);

	const leave = async () => {
		if (draft.trim()) {
			const sure = await ask(app, {
				title: "Throw this away?",
				message: "Nothing has been written to the vault yet.",
				confirm: "Throw it away",
				cancel: "Keep writing",
				destructive: true,
			});
			if (!sure) return;
		}
		onClose();
	};

	/** Writes the note and opens it, so the writing carries straight on. */
	const save = async () => {
		const text = draft.trim();
		if (!text || busy) return;
		setBusy(true);
		try {
			const file = await createNote(app, settings, `${text}\n`);
			const item = index.ensure(file);
			onClose();
			if (item) onOpenPath(file.path);
		} catch (error) {
			new Notice(`Skybox could not write that note: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			setBusy(false);
		}
	};

	const take = async (files: File[]) => {
		if (files.length === 0) return;
		const writing = draft.trim() !== "";
		setBusy(true);
		try {
			const added: string[] = [];
			for (const file of files) {
				const result = await ingest(app, index, settings, file);
				if (result) added.push(result.path);
			}
			if (added.length === 0) return;

			if (!writing) {
				// Nothing written: these are things in their own right, and
				// the grid already has them.
				onClose();
				onOpenPath(added[0]);
				return;
			}
			// Something written: they belong in it.
			setDraft((current) => {
				const embeds = added.map((path) => `![[${path}]]`).join("\n");
				return `${current.trimEnd()}\n\n${embeds}\n`;
			});
		} catch (error) {
			new Notice(`Skybox could not take that in: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			setBusy(false);
			setOver(false);
		}
	};

	return (
		<div
			className="skybox-overlay"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) void leave();
			}}
		>
			<div
				className={`skybox-composer${over ? " is-over" : ""}`}
				onDragOver={(event) => {
					event.preventDefault();
					setOver(true);
				}}
				onDragLeave={(event) => {
					if (event.target === event.currentTarget) setOver(false);
				}}
				onDrop={(event) => {
					event.preventDefault();
					void take([...event.dataTransfer.files]);
				}}
			>
				<textarea
					ref={box}
					className="skybox-composer-text"
					placeholder="write something, or drop a file in"
					value={draft}
					disabled={busy}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							event.preventDefault();
							void leave();
						}
						if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
							event.preventDefault();
							void save();
						}
					}}
				/>
				<div className="skybox-composer-foot">
					<span className="skybox-composer-hint">
						{draft.trim()
							? "a file dropped here is embedded in what you are writing"
							: "a file dropped here becomes a card of its own"}
					</span>
					<button disabled={busy || draft.trim() === ""} onClick={() => void save()}>
						{busy ? "working…" : "save"}
					</button>
				</div>
			</div>
		</div>
	);
}
