import { useCallback, useEffect, useRef, useState } from "react";
import { formatDuration } from "../../lib/formatters";
import { useAuthMedia } from "../hooks/useAuthMedia";

export function AudioMessage({ audioUrl, decryptionKey }: { audioUrl: string; decryptionKey?: CryptoKey }) {
	const src = useAuthMedia(audioUrl, decryptionKey);
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const [isPlaying, setIsPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [totalDuration, setTotalDuration] = useState(0);

	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) return;

		const resolveDuration = () => {
			if (audio.duration && Number.isFinite(audio.duration)) {
				setTotalDuration(audio.duration);
			} else {
				// WebM from MediaRecorder often lacks duration in header.
				// Force the browser to seek to end to resolve it.
				audio.currentTime = 1e10;
				audio.addEventListener(
					"timeupdate",
					function seekBack() {
						audio.removeEventListener("timeupdate", seekBack);
						if (Number.isFinite(audio.duration)) {
							setTotalDuration(audio.duration);
						}
						audio.currentTime = 0;
					},
				);
			}
		};

		const onTime = () => setCurrentTime(audio.currentTime);
		const onEnded = () => {
			setIsPlaying(false);
			setCurrentTime(0);
		};

		audio.addEventListener("loadedmetadata", resolveDuration);
		audio.addEventListener("timeupdate", onTime);
		audio.addEventListener("ended", onEnded);
		return () => {
			audio.removeEventListener("loadedmetadata", resolveDuration);
			audio.removeEventListener("timeupdate", onTime);
			audio.removeEventListener("ended", onEnded);
		};
	}, []);

	const toggle = useCallback(() => {
		const audio = audioRef.current;
		if (!audio) return;
		if (isPlaying) {
			audio.pause();
			setIsPlaying(false);
		} else {
			audio.play();
			setIsPlaying(true);
		}
	}, [isPlaying]);

	const seek = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			const audio = audioRef.current;
			if (!audio || !totalDuration) return;
			const rect = e.currentTarget.getBoundingClientRect();
			const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
			audio.currentTime = ratio * totalDuration;
			setCurrentTime(audio.currentTime);
		},
		[totalDuration],
	);

	const progress = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;

	return (
		<div className="flex items-center gap-2.5 py-0.5">
			<audio ref={audioRef} src={src || undefined} preload="metadata" />

			{/* Play / Pause */}
			<button
				type="button"
				onClick={toggle}
				className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f4a261] text-[#1a1a2e]"
			>
				{isPlaying ? (
					<svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
						<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
					</svg>
				) : (
					<svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
						<path d="M8 5v14l11-7z" />
					</svg>
				)}
			</button>

			{/* Progress bar */}
			<div
				className="relative h-1.5 flex-1 cursor-pointer rounded-full bg-[#a89984]/30"
				onClick={seek}
			>
				<div
					className="absolute left-0 top-0 h-full rounded-full bg-[#f4a261] transition-[width] duration-100"
					style={{ width: `${progress}%` }}
				/>
			</div>

			{/* Duration */}
			<span className="shrink-0 text-[0.7rem] tabular-nums text-[#a89984]">
				{formatDuration(isPlaying ? currentTime : totalDuration)}
			</span>
		</div>
	);
}
