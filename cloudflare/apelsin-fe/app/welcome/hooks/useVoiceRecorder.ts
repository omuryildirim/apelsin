import { useCallback, useEffect, useRef, useState } from "react";

function getMimeType(): string {
	if (typeof MediaRecorder === "undefined") return "audio/webm";
	return MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
		? "audio/webm;codecs=opus"
		: "audio/webm";
}

export function useVoiceRecorder() {
	const [isRecording, setIsRecording] = useState(false);
	const [duration, setDuration] = useState(0);

	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const chunksRef = useRef<Blob[]>([]);
	const streamRef = useRef<MediaStream | null>(null);
	const audioCtxRef = useRef<AudioContext | null>(null);
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const resolveRef = useRef<((blob: Blob | null) => void) | null>(null);

	const cleanup = useCallback(() => {
		if (timerRef.current) {
			clearInterval(timerRef.current);
			timerRef.current = null;
		}
		if (streamRef.current) {
			streamRef.current.getTracks().forEach((t) => t.stop());
			streamRef.current = null;
		}
		if (audioCtxRef.current) {
			audioCtxRef.current.close().catch(() => {});
			audioCtxRef.current = null;
		}
		mediaRecorderRef.current = null;
		chunksRef.current = [];
		setDuration(0);
		setIsRecording(false);
	}, []);

	useEffect(() => {
		return () => cleanup();
	}, [cleanup]);

	const startRecording = useCallback(async () => {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		streamRef.current = stream;

		// Downmix to mono via AudioContext
		const ctx = new AudioContext({ sampleRate: 48000 });
		audioCtxRef.current = ctx;
		const source = ctx.createMediaStreamSource(stream);
		const gain = ctx.createGain();
		gain.channelCount = 1;
		gain.channelCountMode = "explicit";
		source.connect(gain);
		const dest = ctx.createMediaStreamDestination();
		gain.connect(dest);

		const recorder = new MediaRecorder(dest.stream, {
			mimeType: getMimeType(),
			audioBitsPerSecond: 48000,
		});
		mediaRecorderRef.current = recorder;
		chunksRef.current = [];

		recorder.ondataavailable = (e) => {
			if (e.data.size > 0) chunksRef.current.push(e.data);
		};

		recorder.onstop = () => {
			const blob = new Blob(chunksRef.current, { type: getMimeType() });
			resolveRef.current?.(blob);
			resolveRef.current = null;
		};

		recorder.start(100); // collect in 100ms chunks
		setIsRecording(true);
		setDuration(0);
		timerRef.current = setInterval(() => {
			setDuration((d) => d + 1);
		}, 1000);
	}, []);

	const stopRecording = useCallback((): Promise<Blob | null> => {
		return new Promise((resolve) => {
			if (
				!mediaRecorderRef.current ||
				mediaRecorderRef.current.state !== "recording"
			) {
				cleanup();
				resolve(null);
				return;
			}
			resolveRef.current = resolve;
			mediaRecorderRef.current.stop();
			// cleanup everything except the resolve — onstop will fire
			if (timerRef.current) {
				clearInterval(timerRef.current);
				timerRef.current = null;
			}
			if (streamRef.current) {
				streamRef.current.getTracks().forEach((t) => t.stop());
				streamRef.current = null;
			}
			if (audioCtxRef.current) {
				audioCtxRef.current.close().catch(() => {});
				audioCtxRef.current = null;
			}
			setIsRecording(false);
		});
	}, [cleanup]);

	const cancelRecording = useCallback(() => {
		if (
			mediaRecorderRef.current &&
			mediaRecorderRef.current.state === "recording"
		) {
			mediaRecorderRef.current.onstop = null; // discard data
			mediaRecorderRef.current.stop();
		}
		resolveRef.current?.(null);
		resolveRef.current = null;
		cleanup();
	}, [cleanup]);

	return { isRecording, duration, startRecording, stopRecording, cancelRecording };
}
