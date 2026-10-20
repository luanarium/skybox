import { useCallback, useEffect, useRef, useState } from "react";
import { clock, embedUrl, listenMessage, playerMessage, playerState, playerUrl, watchUrl } from "../video";

/**
 * A music video, in the clothes of a desktop music player.
 *
 * A bookmark tagged `music` is not something to watch, it is something to put
 * on, and a plain video frame is the wrong shape for that: no time, nowhere to
 * drop the needle, nothing to turn down. This is a transport bar with the
 * picture kept as its own visualisation, in the spirit of the players everyone
 * had in 1999.
 *
 * It is an homage drawn in CSS, not a copy: no artwork, no skin files and no
 * product's name on it. YouTube still draws the picture and still counts the
 * view, because the embed is doing the playing; what this adds is the panel
 * around it, driven by posting messages at the embed rather than by any
 * library loaded from Google.
 *
 * Where the embed says nothing back, the readouts show dashes and the buttons
 * still work: a player that cannot say where it is can still be told what to
 * do.
 */
export function Winamp({ id, title }: { id: string; title: string }) {
	const frame = useRef<HTMLIFrameElement | null>(null);
	const [at, setAt] = useState<number | null>(null);
	const [length, setLength] = useState<number | null>(null);
	const [playing, setPlaying] = useState(false);
	const [volume, setVolume] = useState(100);
	/** Held while a slider is being dragged, so telemetry does not fight it. */
	const dragging = useRef(false);
	/**
	 * Whether the embed has said anything at all. An embed that will not
	 * answer cannot be driven, and there are several reasons for it that
	 * look identical from here: a video the owner keeps off other sites, a
	 * video needing a decoder this app does not ship, a protocol that has
	 * moved. So the panel waits a moment, and if nothing comes back it hands
	 * the frame over to YouTube's own controls rather than showing buttons
	 * that do nothing.
	 */
	const talked = useRef(false);
	const [plain, setPlain] = useState(false);

	const tell = useCallback((func: string, args: unknown[] = []) => {
		frame.current?.contentWindow?.postMessage(playerMessage(func, args), "*");
	}, []);

	// The embed answers nobody it has not been asked to answer.
	useEffect(() => {
		const listen = (event: MessageEvent) => {
			const from = typeof event.origin === "string" ? event.origin : "";
			if (!/\.youtube(-nocookie)?\.com$/.test(from.replace(/^https?:\/\//, ""))) return;
			// Anything at all from the player means the panel can drive it.
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

	const ready = () => {
		if (plain) return;
		frame.current?.contentWindow?.postMessage(listenMessage(), "*");
		// Long enough for a slow network, short enough to be the same
		// gesture as opening the card.
		window.setTimeout(() => setPlain((was) => was || !talked.current), 3000);
	};

	const nudge = (by: number) => {
		const to = Math.max(0, (at ?? 0) + by);
		setAt(to);
		tell("seekTo", [to, true]);
	};

	return (
		<div className="skybox-amp">
			<div className="skybox-amp-bar">
				<span className="skybox-amp-grip" aria-hidden="true" />
				<span className="skybox-amp-name">skybox amp</span>
				<a className="skybox-amp-out" href={watchUrl(id)}>
					youtube
				</a>
			</div>

			<div className="skybox-amp-screen">
				<iframe
					key={plain ? "plain" : "driven"}
					ref={frame}
					src={plain ? embedUrl(id) : playerUrl(id)}
					title={title}
					onLoad={ready}
					allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
					allowFullScreen
					referrerPolicy="strict-origin-when-cross-origin"
				/>
			</div>

			<div className="skybox-amp-readout">
				<span className="skybox-amp-time">{clock(at)}</span>
				<span className="skybox-amp-marquee">
					{/* Twice, so the loop has no gap to fall through. */}
					<span>
						{title} ✦ {title} ✦
					</span>
				</span>
				<span className="skybox-amp-length">{clock(length)}</span>
			</div>

			{plain ? (
				<p className="skybox-amp-note">
					This one will not take instructions from the panel, so it keeps
					YouTube&apos;s own controls instead.{" "}
					<a href={watchUrl(id)}>Watch it there</a> if it will not play here
					either.
				</p>
			) : (
				<>
				<input
					className="skybox-amp-seek"
					type="range"
					min={0}
					max={Math.max(1, Math.floor(length ?? 1))}
					value={Math.floor(at ?? 0)}
					disabled={length === null}
					aria-label="Where in the track"
					onPointerDown={() => (dragging.current = true)}
					onPointerUp={() => (dragging.current = false)}
					onChange={(event) => {
						const to = Number(event.target.value);
						setAt(to);
						tell("seekTo", [to, true]);
					}}
				/>

				<div className="skybox-amp-buttons">
					<button aria-label="Back ten seconds" onClick={() => nudge(-10)}>
						⏮
					</button>
					<button
						aria-label={playing ? "Pause" : "Play"}
						className="skybox-amp-play"
						onClick={() => {
							tell(playing ? "pauseVideo" : "playVideo");
							setPlaying(!playing);
						}}
					>
						{playing ? "⏸" : "▶"}
					</button>
					<button
						aria-label="Stop"
						onClick={() => {
							tell("stopVideo");
							setPlaying(false);
							setAt(0);
						}}
					>
						⏹
					</button>
					<button aria-label="On ten seconds" onClick={() => nudge(10)}>
						⏭
					</button>
					<label className="skybox-amp-volume">
						<span>vol</span>
						<input
							type="range"
							min={0}
							max={100}
							value={volume}
							aria-label="Volume"
							onChange={(event) => {
								const to = Number(event.target.value);
								setVolume(to);
								tell("setVolume", [to]);
							}}
						/>
					</label>
				</div>
				</>
			)}
		</div>
	);
}
