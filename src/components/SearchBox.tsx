import { useRef } from "react";
import { type Chip, chipLabel, toChip } from "../search";

interface SearchBoxProps {
	chips: Chip[];
	draft: string;
	onDraftChange: (draft: string) => void;
	onChipsChange: (chips: Chip[]) => void;
}

/**
 * A large box: space commits the typed word to a chip, backspace on an empty
 * box pops the last one, and each chip's × removes it, widening the search.
 */
export function SearchBox({ chips, draft, onDraftChange, onChipsChange }: SearchBoxProps) {
	const inputRef = useRef<HTMLInputElement>(null);

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
		<div className="telegrid-search" onClick={() => inputRef.current?.focus()}>
			{chips.map((chip, position) => (
				<span className="telegrid-chip" key={`${chipLabel(chip)}-${position}`}>
					{chipLabel(chip)}
					<button
						className="telegrid-chip-remove"
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
				ref={inputRef}
				className="telegrid-search-input"
				type="text"
				value={draft}
				placeholder={chips.length ? "" : "search my vault"}
				autoFocus
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
