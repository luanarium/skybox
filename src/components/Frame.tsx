import { useEmbed } from "./useEmbed";

/**
 * A video in a card, in whatever way YouTube will serve it.
 *
 * The same climb down the skinned player makes, without the skin: an embed
 * that answers is kept, one that will not is asked for again from the
 * ordinary host, and then plainly, with its own controls. A card has nothing
 * to drive here, so the instructions are only ever used to find out whether
 * this rung works.
 */
export function Frame({ id, title }: { id: string; title: string }) {
	const player = useEmbed(id);

	return (
		<div className="skybox-video-frame">
			<iframe
				key={player.rung}
				ref={player.frame}
				src={player.src}
				title={title}
				onLoad={player.loaded}
				allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
				allowFullScreen
				referrerPolicy="strict-origin-when-cross-origin"
			/>
		</div>
	);
}
