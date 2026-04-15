import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { UserSession } from "../../lib/auth";
import { formatLastSeen } from "../../lib/formatters";
import { t } from "../../lib/i18n";

export type PresenceType = "typing" | "recording" | "online" | "idle";

const ACTIVITY_TIMEOUT = 4000;

export function usePresence(
	session: UserSession | null,
	selectedChatUser: string | null,
) {
	const [activityType, setActivityType] = useState<PresenceType | null>(null);
	const [peerOnline, setPeerOnline] = useState(false);
	const [peerLastSeen, setPeerLastSeen] = useState<number | undefined>();
	const sendPresenceRef = useRef<((msg: Record<string, unknown>) => void) | null>(null);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const selectedRef = useRef(selectedChatUser);

	useEffect(() => {
		selectedRef.current = selectedChatUser;
	}, [selectedChatUser]);

	// Fetch online/lastSeen when opening a chat + send "online" to peer
	useEffect(() => {
		setActivityType(null);
		setPeerOnline(false);
		setPeerLastSeen(undefined);

		if (!selectedChatUser) return;

		// Fetch initial status from API
		api.getUserStatus(selectedChatUser).then((status) => {
			if (status) {
				setPeerOnline(status.online);
				setPeerLastSeen(status.lastSeen);
			}
		});
	}, [selectedChatUser]);

	const handlePresence = useCallback((from: string, presenceType: string) => {
		if (from !== selectedRef.current) return;

		if (presenceType === "offline") {
			setPeerOnline(false);
			setActivityType(null);
			setPeerLastSeen(Date.now());
			return;
		}

		if (presenceType === "idle") {
			setActivityType(null);
			setPeerOnline(true);
			return;
		}

		if (presenceType === "online") {
			setPeerOnline(true);
			setActivityType(null);
			return;
		}

		setActivityType(presenceType as PresenceType);
		setPeerOnline(true);

		if (timeoutRef.current) clearTimeout(timeoutRef.current);
		timeoutRef.current = setTimeout(() => {
			setActivityType(null);
		}, ACTIVITY_TIMEOUT);
	}, []);

	const registerSendPresence = useCallback(
		(fn: (msg: Record<string, unknown>) => void) => {
			sendPresenceRef.current = fn;
		},
		[],
	);

	const sendTyping = useCallback(() => {
		if (selectedChatUser && sendPresenceRef.current) {
			sendPresenceRef.current({ type: "typing", to: selectedChatUser });
		}
	}, [selectedChatUser]);

	const sendRecording = useCallback(() => {
		if (selectedChatUser && sendPresenceRef.current) {
			sendPresenceRef.current({ type: "recording", to: selectedChatUser });
		}
	}, [selectedChatUser]);

	const sendIdle = useCallback(() => {
		if (selectedChatUser && sendPresenceRef.current) {
			sendPresenceRef.current({ type: "idle", to: selectedChatUser });
		}
	}, [selectedChatUser]);

	// Derive status text
	let presenceText: string | null = null;
	if (activityType === "typing") {
		presenceText = t("presence.typing");
	} else if (activityType === "recording") {
		presenceText = t("presence.recording");
	} else if (peerOnline) {
		presenceText = t("presence.online");
	} else if (peerLastSeen) {
		presenceText = t("presence.lastSeen", { time: formatLastSeen(peerLastSeen) });
	}

	return {
		presenceText,
		peerOnline,
		handlePresence,
		registerSendPresence,
		sendTyping,
		sendRecording,
		sendIdle,
	};
}
