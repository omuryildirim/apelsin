import { useCallback, useEffect, useMemo, useState } from "react";
import type { Message } from "../../lib/api";

interface DividerSnapshot {
	messageId: string;
	count: number;
}

interface UseUnreadDividerArgs {
	selectedChatUser: string | null;
	userEmail: string | undefined;
	messages: Message[];
	getLastRead: (email: string) => number | null;
}

const findUnreadSnapshot = (
	messages: Message[],
	userEmail: string,
	lastRead: number,
): DividerSnapshot | null => {
	const unread = messages.filter(
		(m) => m.timestamp > lastRead && m.author !== userEmail,
	);
	const first = unread[0];
	return first ? { messageId: first.id, count: unread.length } : null;
};

export const useUnreadDivider = ({
	selectedChatUser,
	userEmail,
	messages,
	getLastRead,
}: UseUnreadDividerArgs) => {
	const [snapshot, setSnapshot] = useState<DividerSnapshot | null>(null);
	const [dismissed, setDismissed] = useState(false);

	// Snapshot when the chat selection changes; intentionally does not depend on
	// `messages` so the divider stays frozen for the duration of the session.
	useEffect(() => {
		if (!selectedChatUser || !userEmail) {
			setSnapshot(null);
			setDismissed(false);
			return;
		}
		const lastRead = getLastRead(selectedChatUser);
		setSnapshot(lastRead ? findUnreadSnapshot(messages, userEmail, lastRead) : null);
		setDismissed(false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedChatUser, userEmail]);

	const index = useMemo(() => {
		if (dismissed || !snapshot) return null;
		const idx = messages.findIndex((m) => m.id === snapshot.messageId);
		return idx >= 0 ? idx : null;
	}, [dismissed, snapshot, messages]);

	const dismiss = useCallback(() => setDismissed(true), []);

	return { index, count: snapshot?.count ?? 0, dismiss };
};
