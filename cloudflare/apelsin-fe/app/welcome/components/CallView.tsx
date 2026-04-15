import type { CallState } from "../hooks/useVoiceCall";
import { formatDuration } from "../../lib/formatters";
import { t } from "../../lib/i18n";
import { Avatar } from "./Avatar";

interface CallViewProps {
	callState: CallState;
	peerName: string;
	peerPhotoUrl?: string;
	callDuration: number;
	isMuted: boolean;
	onAccept: () => void;
	onReject: () => void;
	onEnd: () => void;
	onToggleMute: () => void;
}

export function CallView({
	callState,
	peerName,
	peerPhotoUrl,
	callDuration,
	isMuted,
	onAccept,
	onReject,
	onEnd,
	onToggleMute,
}: CallViewProps) {
	const statusText =
		callState === "calling" ? t("call.calling")
		: callState === "ringing" ? t("call.incoming")
		: callState === "connecting" ? t("call.connecting")
		: callState === "connected" ? formatDuration(callDuration)
		: callState === "ended" ? t("call.ended")
		: "";

	return (
		<div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-[#1a1a2e] px-8 py-16">
			{/* Peer info */}
			<div className="flex flex-col items-center gap-4 pt-8">
				<Avatar name={peerName} photoUrl={peerPhotoUrl} size="xl" />
				<h2 className="text-2xl font-semibold text-[#f0e6d3]">{peerName}</h2>
				<p className={`text-sm ${
					callState === "connected" ? "text-green-400" : "text-[#a89984]"
				}`}>
					{statusText}
				</p>

				{/* Pulsing ring animation for calling/ringing states */}
				{(callState === "calling" || callState === "ringing") && (
					<div className="mt-4 flex items-center justify-center">
						<div className="h-3 w-3 animate-pulse rounded-full bg-[#f4a261]" />
					</div>
				)}
			</div>

			{/* Controls */}
			<div className="flex items-center gap-6 pb-8">
				{callState === "ringing" ? (
					<>
						{/* Reject */}
						<button
							type="button"
							onClick={onReject}
							className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white shadow-lg transition active:scale-95"
						>
							<svg viewBox="0 0 24 24" className="h-7 w-7 fill-current">
								<path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.73-1.68-1.36-2.66-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
							</svg>
						</button>
						{/* Accept */}
						<button
							type="button"
							onClick={onAccept}
							className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500 text-white shadow-lg transition active:scale-95"
						>
							<svg viewBox="0 0 24 24" className="h-7 w-7 fill-current">
								<path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z" />
							</svg>
						</button>
					</>
				) : (callState === "calling" || callState === "connecting" || callState === "connected") ? (
					<>
						{/* Mute toggle */}
						<button
							type="button"
							onClick={onToggleMute}
							className={`flex h-14 w-14 items-center justify-center rounded-full transition active:scale-95 ${
								isMuted ? "bg-[#f4a261] text-[#1a1a2e]" : "bg-[#2d2d44] text-[#f0e6d3]"
							}`}
						>
							{isMuted ? (
								<svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
									<path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.55-.9l4.17 4.18L21 19.73 4.27 3z" />
								</svg>
							) : (
								<svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
									<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
								</svg>
							)}
						</button>

						{/* End call */}
						<button
							type="button"
							onClick={onEnd}
							className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white shadow-lg transition active:scale-95"
						>
							<svg viewBox="0 0 24 24" className="h-7 w-7 fill-current">
								<path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.73-1.68-1.36-2.66-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
							</svg>
						</button>
					</>
				) : null}
			</div>
		</div>
	);
}
