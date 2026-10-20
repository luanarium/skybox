import { clock, watchUrl } from "../video";
import { useEmbed } from "./useEmbed";

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
 * An embed that will not answer gets its own controls back and the panel says
 * so, rather than offering buttons that do nothing. `useEmbed` holds that
 * climb down.
 */
export function Winamp({ id, title }: { id: string; title: string }) {
	const player = useEmbed(id);

	const nudge = (by: number) => {
		const to = Math.max(0, (player.at ?? 0) + by);
		player.setAt(to);
		player.tell("seekTo", [to, true]);
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

			<div className="skybox-amp-readout">
				<span className="skybox-amp-time">{clock(player.at)}</span>
				<span className="skybox-amp-marquee">
					{/* Twice, so the loop has no gap to fall through. */}
					<span>
						{title} ✦ {title} ✦
					</span>
				</span>
				<span className="skybox-amp-length">{clock(player.length)}</span>
			</div>

			{player.driven ? (
				<>
					<input
						className="skybox-amp-seek"
						type="range"
						min={0}
						max={Math.max(1, Math.floor(player.length ?? 1))}
						value={Math.floor(player.at ?? 0)}
						disabled={player.length === null}
						aria-label="Where in the track"
						onPointerDown={() => (player.dragging.current = true)}
						onPointerUp={() => (player.dragging.current = false)}
						onChange={(event) => {
							const to = Number(event.target.value);
							player.setAt(to);
							player.tell("seekTo", [to, true]);
						}}
					/>

					<div className="skybox-amp-buttons">
						<button aria-label="Back ten seconds" onClick={() => nudge(-10)}>
							⏮
						</button>
						<button
							aria-label={player.playing ? "Pause" : "Play"}
							className="skybox-amp-play"
							onClick={() => {
								player.tell(player.playing ? "pauseVideo" : "playVideo");
								player.setPlaying(!player.playing);
							}}
						>
							{player.playing ? "⏸" : "▶"}
						</button>
						<button
							aria-label="Stop"
							onClick={() => {
								player.tell("stopVideo");
								player.setPlaying(false);
								player.setAt(0);
							}}
						>
							⏹
						</button>
						<button aria-label="On ten seconds" onClick={() => nudge(10)}>
							⏭
						</button>
						<label className="skybox-amp-volume">
							<span>vol</span>
							<Volume onSet={(to) => player.tell("setVolume", [to])} />
						</label>
					</div>
				</>
			) : (
				<p className="skybox-amp-note">
					This one would not take instructions, so it keeps YouTube&apos;s own
					controls. <a href={watchUrl(id)}>Watch it there</a> if it will not play
					here either.
				</p>
			)}
		</div>
	);
}

/** The knob keeps its own position: nothing asks the player where it is. */
function Volume({ onSet }: { onSet: (to: number) => void }) {
	return (
		<input
			type="range"
			min={0}
			max={100}
			defaultValue={100}
			aria-label="Volume"
			onChange={(event) => onSet(Number(event.target.value))}
		/>
	);
}
