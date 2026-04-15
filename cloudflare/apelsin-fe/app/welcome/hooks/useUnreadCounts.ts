import { useCallback, useEffect, useRef, useState } from "react";
import { type Message } from "../../lib/api";
import type { UserSession } from "../../lib/auth";
import { chatIdFromPair } from "../../lib/chatIdentity";
import { fetchAndDecryptNewMessages } from "../../lib/messageFetcher";

const UNREAD_KEY = "apelsin_unread";
const LAST_CHECKED_KEY = "apelsin_last_checked";
const LAST_READ_KEY = "apelsin_last_read";

function loadCounts(): Record<string, number> {
	try {
		return JSON.parse(localStorage.getItem(UNREAD_KEY) ?? "{}");
	} catch {
		return {};
	}
}

function saveCounts(counts: Record<string, number>) {
	localStorage.setItem(UNREAD_KEY, JSON.stringify(counts));
}

function loadTimestamps(key: string): Record<string, number> {
	try {
		return JSON.parse(localStorage.getItem(key) ?? "{}");
	} catch {
		return {};
	}
}

function saveTimestamps(key: string, data: Record<string, number>) {
	localStorage.setItem(key, JSON.stringify(data));
}

// Clear an author's entry from the service worker's unread IDB store.
// SW writes this store on push; without explicit cleanup it grows forever
// and the OS app badge derived from it drifts away from the truth.
function clearSwUnread(author: string): Promise<void> {
	return new Promise((resolve) => {
		try {
			const req = indexedDB.open("apelsin_sw_unread", 1);
			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains("counts")) {
					db.createObjectStore("counts");
				}
			};
			req.onsuccess = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains("counts")) {
					db.close();
					resolve();
					return;
				}
				const tx = db.transaction("counts", "readwrite");
				tx.objectStore("counts").delete(author);
				tx.oncomplete = () => {
					db.close();
					resolve();
				};
				tx.onerror = () => {
					db.close();
					resolve();
				};
			};
			req.onerror = () => resolve();
		} catch {
			resolve();
		}
	});
}

export function useUnreadCounts(
	session: UserSession | null,
	selectedChatUser: string | null,
	chatEmails: string[],
	onNewLastMessage?: (chatId: string, message: Message) => void,
) {
	const [counts, setCounts] = useState<Record<string, number>>(loadCounts);
	const checkedRef = useRef(false);
	const selectedChatUserRef = useRef<string | null>(selectedChatUser);
	useEffect(() => {
		selectedChatUserRef.current = selectedChatUser;
	}, [selectedChatUser]);

	// When the user opens a chat: clear the in-app unread count and the
	// service worker's IDB count for that peer. We deliberately do NOT
	// update lastRead here — that's done by markChatSeen on chat close,
	// so the unread divider stays visible while the user is in the chat.
	useEffect(() => {
		if (!selectedChatUser || !session) return;
		setCounts((prev) => {
			if (!prev[selectedChatUser]) return prev;
			const next = { ...prev };
			delete next[selectedChatUser];
			saveCounts(next);
			return next;
		});
		clearSwUnread(selectedChatUser);
	}, [selectedChatUser, session]);

	// On startup: fetch new messages since lastChecked, count unreads, update cache
	useEffect(() => {
		if (!session || chatEmails.length === 0 || checkedRef.current) return;
		checkedRef.current = true;

		(async () => {
			const lastChecked = loadTimestamps(LAST_CHECKED_KEY);
			const updatedChecked = { ...lastChecked };

			for (const peer of chatEmails) {
				const chatId = chatIdFromPair(session.email, peer);
				const since = lastChecked[chatId] ?? 0;
				if (since === 0) continue;

				try {
					const msgs = await fetchAndDecryptNewMessages(
						session.email, peer, chatId, since,
					);
					const fromPeer = msgs.filter((m: Message) => m.author !== session.email);
					if (fromPeer.length > 0) {
						// Skip incrementing unread for the chat the user is
						// currently viewing — they're reading those messages
						// right now (e.g. opened via notification click).
						const isActive = selectedChatUserRef.current === peer;
						if (!isActive) {
							setCounts((prev) => {
								const next = {
									...prev,
									[peer]: (prev[peer] ?? 0) + fromPeer.length,
								};
								saveCounts(next);
								return next;
							});
						} else {
							// Make sure the SW IDB count is also cleared for this
							// peer in case a push arrived just before the app booted.
							clearSwUnread(peer);
						}
						const newest = msgs[msgs.length - 1];
						if (newest) onNewLastMessage?.(chatId, newest);
					}
				} catch {
					// offline — skip
				}
			}

			// Advance lastChecked to now
			const now = Date.now();
			for (const peer of chatEmails) {
				updatedChecked[chatIdFromPair(session.email, peer)] = now;
			}
			saveTimestamps(LAST_CHECKED_KEY, updatedChecked);
		})();
	}, [session, chatEmails]);

	// Update app badge
	useEffect(() => {
		const total = Object.values(counts).reduce((sum, c) => sum + c, 0);
		if ("setAppBadge" in navigator) {
			if (total > 0) {
				(navigator as Navigator & { setAppBadge: (n: number) => Promise<void> }).setAppBadge(total);
			} else {
				(navigator as Navigator & { clearAppBadge: () => Promise<void> }).clearAppBadge();
			}
		}
	}, [counts]);

	const incrementUnread = useCallback((email: string, chatId?: string, message?: Message) => {
		setCounts((prev) => {
			const next = { ...prev, [email]: (prev[email] ?? 0) + 1 };
			saveCounts(next);
			return next;
		});
		if (chatId && message) {
			onNewLastMessage?.(chatId, message);
		}
	}, [onNewLastMessage]);

	const clearUnread = useCallback((email: string) => {
		setCounts((prev) => {
			if (!prev[email]) return prev;
			const next = { ...prev };
			delete next[email];
			saveCounts(next);
			return next;
		});
		clearSwUnread(email);
	}, []);

	const markChatSeen = useCallback(
		(peerEmail: string) => {
			if (!session) return;
			const chatId = chatIdFromPair(session.email, peerEmail);
			const now = Date.now();
			const lastRead = loadTimestamps(LAST_READ_KEY);
			lastRead[chatId] = now;
			saveTimestamps(LAST_READ_KEY, lastRead);
			const lastChecked = loadTimestamps(LAST_CHECKED_KEY);
			lastChecked[chatId] = now;
			saveTimestamps(LAST_CHECKED_KEY, lastChecked);
		},
		[session],
	);

	const getLastRead = useCallback(
		(peerEmail: string): number => {
			if (!session) return 0;
			const chatId = chatIdFromPair(session.email, peerEmail);
			return loadTimestamps(LAST_READ_KEY)[chatId] ?? 0;
		},
		[session],
	);

	return { unreadCounts: counts, incrementUnread, clearUnread, markChatSeen, getLastRead };
}
