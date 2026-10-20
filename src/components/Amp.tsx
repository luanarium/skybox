import { useEffect, useRef, useState } from "react";
import type { TFile } from "obsidian";
import { useSkybox } from "../context";
import { clock } from "../video";

/**
 * A track in the vault, played in the clothes of a desktop music player.
 *
 * This is where the panel belongs. A file in the vault is the same origin as
 * the pane that draws it, so the element says exactly where it is, seeking is
 * instant, the volume is the volume, and the bars are the sound itself read
 * through an analyser rather than an animation pretending to be one. None of
 * that is possible through an embed from somewhere else, which is why it is
 * not attempted there any more.
 *
 * The look is an homage drawn in CSS: no artwork, no skin files, no product's
 * name on it. The audio never leaves the vault and nothing is loaded from
 * anywhere.
 */
export function Amp({ file, title }: { file: TFile; title: string }) {
	const { app } = useSkybox();
	const sound = useRef<HTMLAudioElement | null>(null);
	const canvas = useRef<HTMLCanvasElement | null>(null);
	const [at, setAt] = useState(0);
	const [length, setLength] = useState<number | null>(null);
	const [playing, setPlaying] = useState(false);
	const [volume, setVolume] = useState(1);
	const dragging = useRef(false);

	// One graph for the life of the element: a second source on the same
	// element throws, and a context left open holds the sound card.
	const graph = useRef<{ context: AudioContext; analyser: AnalyserNode } | null>(null);
	useEffect(
		() => () => {
			void graph.current?.context.close();
			graph.current = null;
		},
		[file.path]
	);

	/**
	 * Built on the first press rather than on load, because a context made
	 * before any gesture starts suspended and a suspended context draws a
	 * flat line.
	 */
	const listen = () => {
		const element = sound.current;
		if (!element || graph.current) return;
		const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!Context) return;
		try {
			const context = new Context();
			const source = context.createMediaElementSource(element);
			const analyser = context.createAnalyser();
			analyser.fftSize = 128;
			analyser.smoothingTimeConstant = 0.75;
			source.connect(analyser);
			analyser.connect(context.destination);
			graph.current = { context, analyser };
			draw();
		} catch (error) {
			// A browser that will not analyse still plays: the bars are the
			// decoration, the sound is the point.
			console.error("Skybox: no analyser for this one", error);
		}
	};

	const draw = () => {
		const frame = canvas.current;
		const analyser = graph.current?.analyser;
		if (!frame || !analyser) return;
		const pen = frame.getContext("2d");
		if (!pen) return;
		const bins = new Uint8Array(analyser.frequencyBinCount);
		const paint = () => {
			if (!graph.current || !canvas.current) return;
			analyser.getByteFrequencyData(bins);
			const width = frame.width;
			const height = frame.height;
			pen.clearRect(0, 0, width, height);
			const bars = Math.min(24, bins.length);
			const step = width / bars;
			for (let bar = 0; bar < bars; bar++) {
				const level = bins[bar] / 255;
				const tall = Math.max(1, Math.round(level * height));
				pen.fillStyle = level > 0.75 ? "#9fe34b" : "#16e04b";
				pen.fillRect(bar * step + 1, height - tall, Math.max(1, step - 2), tall);
			}
			window.requestAnimationFrame(paint);
		};
		paint();
	};

	const play = async () => {
		const element = sound.current;
		if (!element) return;
		listen();
		await graph.current?.context.resume();
		if (element.paused) await element.play();
		else element.pause();
	};

	const nudge = (by: number) => {
		const element = sound.current;
		if (!element) return;
		element.currentTime = Math.max(0, Math.min(element.duration || 0, element.currentTime + by));
	};

	return (
		<div className="skybox-amp">
			<div className="skybox-amp-bar">
				<span className="skybox-amp-grip" aria-hidden="true" />
				<span className="skybox-amp-name">skybox amp</span>
			</div>

			<audio
				ref={sound}
				src={app.vault.getResourcePath(file)}
				preload="metadata"
				onLoadedMetadata={(event) => {
					const length = event.currentTarget.duration;
					setLength(Number.isFinite(length) ? length : null);
				}}
				onTimeUpdate={(event) => {
					if (!dragging.current) setAt(event.currentTarget.currentTime);
				}}
				onPlay={() => setPlaying(true)}
				onPause={() => setPlaying(false)}
				onEnded={() => setPlaying(false)}
			/>

			<div className="skybox-amp-screen is-levels">
				<canvas ref={canvas} width={320} height={80} aria-hidden="true" />
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

			<input
				className="skybox-amp-seek"
				type="range"
				min={0}
				max={Math.max(1, Math.floor(length ?? 1))}
				value={Math.floor(at)}
				disabled={length === null}
				aria-label="Where in the track"
				onPointerDown={() => (dragging.current = true)}
				onPointerUp={() => (dragging.current = false)}
				onChange={(event) => {
					const to = Number(event.target.value);
					setAt(to);
					if (sound.current) sound.current.currentTime = to;
				}}
			/>

			<div className="skybox-amp-buttons">
				<button aria-label="Back ten seconds" onClick={() => nudge(-10)}>
					⏮
				</button>
				<button
					aria-label={playing ? "Pause" : "Play"}
					className="skybox-amp-play"
					onClick={() => void play()}
				>
					{playing ? "⏸" : "▶"}
				</button>
				<button
					aria-label="Stop"
					onClick={() => {
						const element = sound.current;
						if (!element) return;
						element.pause();
						element.currentTime = 0;
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
						value={Math.round(volume * 100)}
						aria-label="Volume"
						onChange={(event) => {
							const to = Number(event.target.value) / 100;
							setVolume(to);
							if (sound.current) sound.current.volume = to;
						}}
					/>
				</label>
			</div>
		</div>
	);
}
