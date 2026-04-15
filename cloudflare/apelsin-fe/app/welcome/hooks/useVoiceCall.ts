import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";

export type CallState =
	| "idle"
	| "calling"      // outgoing call ringing
	| "ringing"      // incoming call ringing
	| "connecting"   // WebRTC handshake in progress
	| "connected"    // call active
	| "ended";

const ICE_SERVERS: RTCConfiguration = {
	iceServers: [
		{ urls: "stun:stun.l.google.com:19302" },
		{ urls: "stun:stun1.l.google.com:19302" },
	],
};

const RING_TIMEOUT = 30_000;

export function useVoiceCall(
	sendWsRef: React.RefObject<((msg: Record<string, unknown>) => void) | null>,
) {
	const [callState, setCallState] = useState<CallState>("idle");
	const [callPeer, setCallPeer] = useState<string | null>(null);
	const [callDuration, setCallDuration] = useState(0);
	const [isMuted, setIsMuted] = useState(false);

	const pcRef = useRef<RTCPeerConnection | null>(null);
	const localStreamRef = useRef<MediaStream | null>(null);
	const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
	const durationRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const callStateRef = useRef<CallState>("idle");
	const callPeerRef = useRef<string | null>(null);

	useEffect(() => { callStateRef.current = callState; }, [callState]);
	useEffect(() => { callPeerRef.current = callPeer; }, [callPeer]);

	const cleanup = useCallback(() => {
		if (durationRef.current) { clearInterval(durationRef.current); durationRef.current = null; }
		if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null; }
		if (localStreamRef.current) {
			localStreamRef.current.getTracks().forEach((t) => t.stop());
			localStreamRef.current = null;
		}
		if (pcRef.current) {
			pcRef.current.close();
			pcRef.current = null;
		}
		setCallDuration(0);
		setIsMuted(false);
	}, []);

	useEffect(() => {
		if (typeof document === "undefined") return;
		const audio = document.createElement("audio");
		audio.autoplay = true;
		remoteAudioRef.current = audio;
		return () => { audio.pause(); audio.srcObject = null; };
	}, []);

	const sendCallSignal = useCallback((type: string, to: string, data?: Record<string, unknown>) => {
		sendWsRef.current?.({ type, to, data });
	}, [sendWsRef]);

	const createPeerConnection = useCallback((peer: string) => {
		const pc = new RTCPeerConnection(ICE_SERVERS);
		pcRef.current = pc;

		pc.onicecandidate = (event) => {
			if (event.candidate) {
				sendCallSignal("candidate", peer, { candidate: event.candidate.toJSON() });
			}
		};

		pc.ontrack = (event) => {
			if (remoteAudioRef.current && event.streams[0]) {
				remoteAudioRef.current.srcObject = event.streams[0];
			}
		};

		pc.onconnectionstatechange = () => {
			if (pc.connectionState === "connected") {
				setCallState("connected");
				durationRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
			} else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
				endCall();
			}
		};

		return pc;
	}, [sendCallSignal]);

	const startLocalAudio = useCallback(async (pc: RTCPeerConnection) => {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
		localStreamRef.current = stream;
		stream.getTracks().forEach((track) => pc.addTrack(track, stream));
	}, []);

	// ── Outgoing call ──────────────────────────────────────────────────────

	const startCall = useCallback(async (peerEmail: string) => {
		if (callStateRef.current !== "idle") return;

		setCallPeer(peerEmail);
		setCallState("calling");

		// HTTP endpoint sends both WS relay + push notification
		await api.callRequest(peerEmail);

		ringTimeoutRef.current = setTimeout(() => {
			if (callStateRef.current === "calling") {
				// Timeout — cancel call and trigger missed call push
				api.callCancel(peerEmail);
				setCallState("ended");
				setTimeout(() => { setCallState("idle"); setCallPeer(null); }, 2000);
				cleanup();
			}
		}, RING_TIMEOUT);
	}, [cleanup]);

	// ── Incoming call ──────────────────────────────────────────────────────

	const handleIncomingCall = useCallback((from: string) => {
		if (callStateRef.current !== "idle") return;
		setCallPeer(from);
		setCallState("ringing");

		ringTimeoutRef.current = setTimeout(() => {
			if (callStateRef.current === "ringing") {
				sendCallSignal("call-end", from);
				setCallState("idle");
				setCallPeer(null);
			}
		}, RING_TIMEOUT);
	}, [sendCallSignal]);

	const acceptCall = useCallback(async () => {
		if (!callPeerRef.current) return;
		const peer = callPeerRef.current;
		if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null; }

		setCallState("connecting");
		sendCallSignal("call-accept", peer);
	}, [sendCallSignal]);

	const rejectCall = useCallback(() => {
		if (!callPeerRef.current) return;
		sendCallSignal("call-reject", callPeerRef.current);
		if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null; }
		setCallState("idle");
		setCallPeer(null);
	}, [sendCallSignal]);

	const endCall = useCallback(() => {
		const peer = callPeerRef.current;
		if (peer) {
			// If still ringing (outgoing), cancel via HTTP to send missed call push
			if (callStateRef.current === "calling") {
				api.callCancel(peer);
			}
			sendCallSignal("call-end", peer);
		}
		cleanup();
		setCallState("ended");
		setTimeout(() => { setCallState("idle"); setCallPeer(null); }, 2000);
	}, [sendCallSignal, cleanup]);

	const toggleMute = useCallback(() => {
		if (localStreamRef.current) {
			const track = localStreamRef.current.getAudioTracks()[0];
			if (track) {
				track.enabled = !track.enabled;
				setIsMuted(!track.enabled);
			}
		}
	}, []);

	// ── Handle all incoming call WebSocket signals ─────────────────────────

	const handleCallSignal = useCallback(async (from: string, callType: string, data: Record<string, unknown>) => {
		const state = callStateRef.current;
		const peer = callPeerRef.current;

		if (callType === "call-request") {
			handleIncomingCall(from);
			return;
		}

		// Ignore signals not from our current call peer
		if (from !== peer) return;

		if (callType === "call-accept" && state === "calling") {
			// Peer accepted — create offer
			if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null; }
			setCallState("connecting");

			const pc = createPeerConnection(from);
			await startLocalAudio(pc);
			const offer = await pc.createOffer();
			await pc.setLocalDescription(offer);
			sendCallSignal("offer", from, { sdp: offer.sdp, type: offer.type });

		} else if (callType === "offer" && state === "connecting") {
			// We accepted, now received the offer
			const pc = pcRef.current ?? createPeerConnection(from);
			if (!localStreamRef.current) await startLocalAudio(pc);
			await pc.setRemoteDescription(new RTCSessionDescription(data as unknown as RTCSessionDescriptionInit));
			const answer = await pc.createAnswer();
			await pc.setLocalDescription(answer);
			sendCallSignal("answer", from, { sdp: answer.sdp, type: answer.type });

		} else if (callType === "answer" && pcRef.current) {
			await pcRef.current.setRemoteDescription(new RTCSessionDescription(data as unknown as RTCSessionDescriptionInit));

		} else if (callType === "candidate" && pcRef.current) {
			await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate as RTCIceCandidateInit));

		} else if (callType === "call-reject") {
			setCallState("ended");
			setTimeout(() => { setCallState("idle"); setCallPeer(null); }, 2000);
			cleanup();

		} else if (callType === "call-end") {
			cleanup();
			setCallState("ended");
			setTimeout(() => { setCallState("idle"); setCallPeer(null); }, 2000);
		}
	}, [handleIncomingCall, createPeerConnection, startLocalAudio, sendCallSignal, cleanup]);

	useEffect(() => () => cleanup(), [cleanup]);

	return {
		callState,
		callPeer,
		callDuration,
		isMuted,
		startCall,
		acceptCall,
		rejectCall,
		endCall,
		toggleMute,
		handleCallSignal,
	};
}
