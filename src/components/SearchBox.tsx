import { useRef } from "react";
import { Platform } from "obsidian";
import { type Chip, chipLabel, toChip } from "../search";

interface SearchBoxProps {
	chips: Chip[];
	draft: string;
	onDraftChange: (draft: string) => void;
	onChipsChange: (chips: Chip[]) => void;
	/** The pane keeps hold of the field, to put the cursor back in it. */
	inputRef?: React.RefObject<HTMLInputElement>;
}

/**
 * A large box: space commits the typed word to a chip, backspace on an empty
 * box pops the last one, and each chip's × removes it, widening the search.
 */
export function SearchBox({ chips, draft, onDraftChange, onChipsChange, inputRef }: SearchBoxProps) {
	const own = useRef<HTMLInputElement>(null);
	const field = inputRef ?? own;

	/** Commits every whole word, keeping anything after the last space typed. */
	const commit = (value: string, remainder = "") => {
		const added: Chip[] = [];
		for (const word of value.split(/\s+/)) {
			const chip = toChip(word);
			if (!chip) continue;
			const taken = [...chips, ...added].some(
				(existing) => existing.text === chip.text && existing.tagOnly === chip.tagOnly
			);
			if (!taken) added.push(chip);
		}
		if (added.length > 0) onChipsChange([...chips, ...added]);
		onDraftChange(remainder);
	};

	return (
		<div className="skybox-search" onClick={() => field.current?.focus()}>
			{chips.map((chip, position) => (
				<span className="skybox-chip" key={`${chipLabel(chip)}-${position}`}>
					{chipLabel(chip)}
					<button
						className="skybox-chip-remove"
						aria-label={`Remove ${chipLabel(chip)}`}
						onClick={(event) => {
							event.stopPropagation();
							onChipsChange(chips.filter((_, index) => index !== position));
						}}
					>
						×
					</button>
				</span>
			))}
			<input
				ref={field}
				className="skybox-search-input"
				type="text"
				value={draft}
				placeholder={chips.length ? "" : "search my vault"}
				// A phone brings its keyboard up with the cursor, over the grid
				// the reader came to scroll.
				autoFocus={!Platform.isMobile}
				spellCheck={false}
				onChange={(event) => {
					const value = event.target.value;
					const lastSpace = value.lastIndexOf(" ");
					if (lastSpace !== -1) {
						commit(value.slice(0, lastSpace), value.slice(lastSpace + 1));
						return;
					}
					onDraftChange(value);
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						commit(draft);
						return;
					}
					if (event.key === "Backspace" && draft === "" && chips.length > 0) {
						event.preventDefault();
						onChipsChange(chips.slice(0, -1));
					}
				}}
			/>
		</div>
	);
}
