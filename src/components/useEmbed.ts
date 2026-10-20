import { useCallback, useEffect, useRef, useState } from "react";
import { EMBED_LADDER, embedAt, listenMessage, playerMessage, playerState } from "../video";

/**
 * An embed that works its way down to one that plays.
 *
 * A YouTube embed can refuse for reasons that all look the same from inside
 * the frame: "Video unavailable". The private host is stricter than the
 * ordinary one, an embed that takes instructions is checked more closely than
 * one that does not, and an app's own origin is not a domain anybody
 * registered. Rather than guess which it is, the frame asks the first way,
 * waits for a word back, and on hearing nothing tries the next: the private
 * host taking instructions, the ordinary host taking instructions, then the
 * ordinary host with its own controls, which is how every other plugin
 * embeds a video.
 *
 * The last rung cannot be checked, because an embed with no instructions has
 * no way to answer. It is also the one most likely to play, so there is
 * nowhere further to fall.
 */
export function useEmbed(id: string, patience = 3000) {
	const frame = useRef<HTMLIFrameElement | null>(null);
	const [rung, setRung] = useState(0);
	const talked = useRef(false);
	const [at, setAt] = useState<number | null>(null);
	const [length, setLength] = useState<number | null>(null);
	const [playing, setPlaying] = useState(false);
	/** Held while a slider is being dragged, so telemetry does not fight it. */
	const dragging = useRef(false);

	// A card reopened on another video starts at the top again.
	useEffect(() => {
		setRung(0);
		talked.current = false;
		setAt(null);
		setLength(null);
		setPlaying(false);
	}, [id]);

	useEffect(() => {
		const listen = (event: MessageEvent) => {
			const from = typeof event.origin === "string" ? event.origin : "";
			if (!/\.youtube(-nocookie)?\.com$/.test(from.replace(/^https?:\/\//, ""))) return;
			// Anything at all from the player means this rung holds.
			talked.current = true;
			const said = playerState(event.data);
			if (!said) return;
			if (said.at !== null && !dragging.current) setAt(said.at);
			if (said.length !== null) setLength(said.length);
			if (said.playing !== null) setPlaying(said.playing);
		};
		window.addEventListener("message", listen);
		return () => window.removeEventListener("message", listen);
	}, []);

	const step = EMBED_LADDER[Math.min(rung, EMBED_LADDER.length - 1)];

	const tell = useCallback(
		(func: string, args: unknown[] = []) => {
			if (!step.driven) return;
			frame.current?.contentWindow?.postMessage(playerMessage(func, args), "*");
		},
		[step.driven]
	);

	/** Called when the frame has loaded whichever rung it is on. */
	const loaded = useCallback(() => {
		if (!step.driven) return;
		frame.current?.contentWindow?.postMessage(listenMessage(), "*");
		window.setTimeout(() => {
			if (talked.current) return;
			// Long enough for a slow network, short enough to be part of the
			// same gesture as opening the card.
			setRung((was) => Math.min(was + 1, EMBED_LADDER.length - 1));
		}, patience);
	}, [step.driven, patience]);

	return {
		frame,
		/** Changes as the ladder is walked, which remounts the frame. */
		rung,
		src: embedAt(step, id),
		/** Whether this rung can be driven at all. */
		driven: step.driven,
		/** Whether it has actually answered. */
		answering: talked.current,
		at,
		length,
		playing,
		setPlaying,
		setAt,
		dragging,
		tell,
		loaded,
	};
}
