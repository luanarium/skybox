import { useEffect, useState } from "react";
import { useTelegrid } from "../context";
import { plainExcerpt } from "../search";
import type { Item } from "../types";

interface CardProps {
	item: Item;
	/** Position in the results, for the staggered fade-in. */
	index: number;
	/** Carries the shared view-transition name while this card expands. */
	named: boolean;
	/** Newly surfaced by the current chip set, so it fades in. */
	fresh: boolean;
	/** Just made by the composer, so it drops in. */
	dropped: boolean;
	onOpen: (item: Item) => void;
}

export function Card({ item, index, named, fresh, dropped, onOpen }: CardProps) {
	const { app, index: vaultIndex } = useTelegrid();
	const [excerpt, setExcerpt] = useState("");

	useEffect(() => {
		let current = true;
		if (item.kind === "note" || item.sidecar) {
			vaultIndex.content(item).then((content) => {
				if (current) setExcerpt(plainExcerpt(content));
			});
		} else {
			setExcerpt("");
		}
		return () => {
			current = false;
		};
	}, [item.id, item.mtime, vaultIndex]);

	const style = {
		animationDelay: `${Math.min(index, 20) * 24}ms`,
		viewTransitionName: named ? "telegrid-expanding" : undefined,
	} as React.CSSProperties;

	return (
		<div
			className={`telegrid-card is-${item.kind}${fresh ? " is-fresh" : ""}${
				dropped ? " is-dropped" : ""
			}`}
			style={style}
			role="button"
			tabIndex={0}
			onClick={() => onOpen(item)}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onOpen(item);
				}
			}}
		>
			{item.kind === "image" && (
				<img
					className="telegrid-card-image"
					src={app.vault.getResourcePath(item.file)}
					alt={item.title}
					loading="lazy"
					draggable={false}
				/>
			)}
			<div className="telegrid-card-body">
				<div className="telegrid-card-title">{item.title}</div>
				{excerpt && <div className="telegrid-card-excerpt">{excerpt}</div>}
				{item.tags.length > 0 && (
					<div className="telegrid-card-tags">
						{item.tags.slice(0, 4).map((tag) => (
							<span className="telegrid-tag" key={tag}>
								#{tag}
							</span>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
