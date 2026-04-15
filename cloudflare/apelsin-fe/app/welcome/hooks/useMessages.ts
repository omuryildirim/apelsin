import {
	type ChangeEvent,
	type MutableRefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { api, type Message } from "../../lib/api";
import type { UserSession } from "../../lib/auth";
import { chatIdFromPair, normalizeEmail } from "../../lib/chatIdentity";
import {
	decryptMessageSymmetric,
	encryptBlob,
	encryptMessageSymmetric,
} from "../../lib/e2eEncryption";
import {
	type OptimizationResult,
	optimizeImage,
} from "../../lib/imageOptimizer";
import {
	type CacheStats,
	cacheMessages,
	getCachedMessagesForChat,
	getCacheStatsForChat,
	getOlderCachedMessages,
	PAGE_SIZE,
} from "../../lib/messageCache";
import { fetchAndDecryptNewMessages } from "../../lib/messageFetcher";
import type { UserKeyPair } from "../../lib/e2eEncryption";

export function useMessages(
	session: UserSession | null,
	selectedChatUser: string | null,
	keyPair: UserKeyPair | null,
	sharedKey: CryptoKey | null,
	isEncryptionReady: boolean,
	sharedKeyPeerRef: MutableRefObject<string | null>,
	sharedKeyRef: MutableRefObject<CryptoKey | null>,
	onUnreadMessage?: (fromEmail: string, chatId?: string, message?: Message) => void,
	onPresence?: (from: string, presenceType: string) => void,
	onCall?: (from: string, callType: string, data: Record<string, unknown>) => void,
	onWsReady?: (sendWsMessage: (msg: Record<string, unknown>) => void) => void,
) {
	const [input, setInput] = useState("");
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [optimizationData, setOptimizationData] =
		useState<OptimizationResult | null>(null);
	const [optimizedBlob, setOptimizedBlob] = useState<Blob | null>(null);
	const [messages, setMessages] = useState<Message[]>([]);
	const [apiEnabled, setApiEnabled] = useState(false);
	const [isSending, setIsSending] = useState(false);
	const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
	const [isOffline, setIsOffline] = useState(false);
	const [hasMoreMessages, setHasMoreMessages] = useState(true);
	const [isLoadingOlder, setIsLoadingOlder] = useState(false);
	const [replyingTo, setReplyingTo] = useState<Message | null>(null);

	const lastServerCursorRef = useRef(0);
	const sseUnsubscribeRef = useRef<(() => void) | null>(null);
	const listRef = useRef<HTMLDivElement | null>(null);
	const sessionRef = useRef<UserSession | null>(null);
	const selectedChatUserRef = useRef<string | null>(null);

	useEffect(() => {
		sessionRef.current = session;
	}, [session]);
	useEffect(() => {
		selectedChatUserRef.current = selectedChatUser;
	}, [selectedChatUser]);

	// Load messages
	useEffect(() => {
		if (!keyPair || !sharedKey || !selectedChatUser) return;
		if (
			normalizeEmail(sharedKeyPeerRef.current ?? "") !==
			normalizeEmail(selectedChatUser)
		)
			return;

		setMessages([]);
		setHasMoreMessages(true);
		lastServerCursorRef.current = 0;

		const activeChatId =
			session && selectedChatUser
				? chatIdFromPair(session.email, selectedChatUser)
				: null;
		if (!activeChatId) return;

		getCachedMessagesForChat(activeChatId, PAGE_SIZE).then(async (cachedMsgs) => {
			try {
				if (cachedMsgs.length > 0) {
					setMessages(cachedMsgs);
					setHasMoreMessages(cachedMsgs.length >= PAGE_SIZE);
					getCacheStatsForChat(activeChatId).then(setCacheStats);
					const maxTimestamp = Math.max(
						...cachedMsgs.map((m) => m.timestamp),
					);
					lastServerCursorRef.current = maxTimestamp;

					// Fetch + decrypt + cache messages that arrived while the app was closed
					const newMsgs = await fetchAndDecryptNewMessages(
						session!.email, selectedChatUser, activeChatId, maxTimestamp,
					);
					if (newMsgs.length > 0) {
						const messageIds = new Set(cachedMsgs.map((m) => m.id));
						const uniqueNew = newMsgs.filter((m) => !messageIds.has(m.id));
						if (uniqueNew.length > 0) {
							setMessages((prev) => [...prev, ...uniqueNew]);
							const newMax = Math.max(...uniqueNew.map((m) => m.timestamp));
							lastServerCursorRef.current = newMax;
							getCacheStatsForChat(activeChatId).then(setCacheStats);
						}
					}
				} else {
					const msgs = await fetchAndDecryptNewMessages(
						session!.email, selectedChatUser, activeChatId, 0,
					);
					if (msgs.length > 0) {
						setMessages(msgs.slice(-PAGE_SIZE));
						setHasMoreMessages(msgs.length > PAGE_SIZE);
						const maxTimestamp = Math.max(...msgs.map((m) => m.timestamp));
						lastServerCursorRef.current = maxTimestamp;
						getCacheStatsForChat(activeChatId).then(setCacheStats);
					}
				}
				setApiEnabled(true);
				setIsOffline(false);
			} catch {
				setIsOffline(true);
			}
		});
	}, [session?.email, keyPair, sharedKey, selectedChatUser, sharedKeyPeerRef]);

	// File preview
	useEffect(() => {
		if (!selectedFile) {
			setPreviewUrl(null);
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			if (typeof reader.result === "string") setPreviewUrl(reader.result);
		};
		reader.readAsDataURL(selectedFile);
	}, [selectedFile]);

	// Auto-scroll to bottom when message count changes (new message arrives or
	// is sent). Initial chat-open scroll is handled separately by useChatReady
	// in ConversationView, which waits for images to load before snapping.
	useEffect(() => {
		const scroller = listRef.current;
		if (!scroller) return;
		requestAnimationFrame(() => {
			scroller.scrollTop = scroller.scrollHeight;
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [messages.length]);

	// WebSocket subscription — connects as soon as we have a session
	useEffect(() => {
		if (!session) return;

		const handleUpdate = async (incoming: Message) => {
			try {
				const sess = sessionRef.current;
				const peer = selectedChatUserRef.current;
				const key = sharedKeyRef.current;
				if (!sess) return;

				// If the message is from ourselves, ignore
				if (incoming.author === sess.email) return;

				// If the message is for a different chat than the active one, increment unread
				const activeChatId = peer ? chatIdFromPair(sess.email, peer) : null;
				if (incoming.chatId && activeChatId && incoming.chatId !== activeChatId) {
					onUnreadMessage?.(incoming.author, incoming.chatId, incoming);
					return;
				}
				if (!activeChatId) {
					onUnreadMessage?.(incoming.author, incoming.chatId, incoming);
					return;
				}

				if (!peer || !key) return;
				if (
					normalizeEmail(sharedKeyPeerRef.current ?? "") !==
					normalizeEmail(peer)
				)
					return;

				const newMessages = await api.getNewMessages(
					activeChatId,
					lastServerCursorRef.current,
				);

				if (newMessages.length > 0) {
					const decryptedMessages = await Promise.all(
						newMessages
							.filter((m) => m.chatId === activeChatId)
							.map(async (msg) => {
								try {
									if (msg.text) {
										const decrypted = await decryptMessageSymmetric(
											msg.text,
											key,
										);
										return { ...msg, text: decrypted };
									}
									return msg;
								} catch {
									return { ...msg, text: "[Decryption failed]" };
								}
							}),
					);

					setMessages((prev) => {
						if (selectedChatUserRef.current !== peer) return prev;
						const messageIds = new Set(prev.map((m) => m.id));
						const uniqueNew = decryptedMessages.filter(
							(m) => !messageIds.has(m.id) && m.author !== sess.email,
						);
						return [...prev, ...uniqueNew];
					});

					await cacheMessages(decryptedMessages);
					const stats = await getCacheStatsForChat(activeChatId);
					setCacheStats(stats);
					lastServerCursorRef.current = incoming.timestamp;
					setIsOffline(false);
				}
			} catch {
				setIsOffline(true);
			}
		};

		const handleReaction = (_chatId: string, messageId: string, reactions: Record<string, string[]>) => {
			setMessages((prev) => {
				const updated = prev.map((m) => m.id === messageId ? { ...m, reactions } : m);
				// Persist to cache
				const msg = updated.find((m) => m.id === messageId);
				if (msg) cacheMessages([msg]);
				return updated;
			});
		};

		const { unsubscribe, sendWsMessage } = api.subscribeToMessages(
			session.email,
			handleUpdate,
			onPresence,
			handleReaction,
			onCall,
		);
		sseUnsubscribeRef.current = unsubscribe;
		onWsReady?.(sendWsMessage);
		return () => {
			sseUnsubscribeRef.current?.();
		};
	}, [session, sharedKeyPeerRef, sharedKeyRef]);

	const sendMessage = useCallback(
		async (text: string, imageBlob?: Blob, audioBlob?: Blob, replyTo?: { id: string; author: string; text?: string } | null) => {
			const trimmed = text.trim();
			if (!trimmed && !imageBlob && !audioBlob) return;
			if (!session || !selectedChatUser) return;

			setIsSending(true);
			try {
				const chatId = chatIdFromPair(session.email, selectedChatUser);

				// Upload media to S3 if present
				let imageUrl: string | undefined;
				let audioUrl: string | undefined;

				if (imageBlob) {
					const urls = await api.getChatMediaUploadUrl(chatId, "application/octet-stream");
					if (urls) {
						const encrypted = sharedKey
							? new Blob([await encryptBlob(await imageBlob.arrayBuffer(), sharedKey)])
							: imageBlob;
						await fetch(urls.uploadUrl, {
							method: "PUT",
							headers: { "Content-Type": "application/octet-stream" },
							body: encrypted,
						});
						imageUrl = urls.readUrl;
					}
				}

				if (audioBlob) {
					const urls = await api.getChatMediaUploadUrl(chatId, "application/octet-stream");
					if (urls) {
						const encrypted = sharedKey
							? new Blob([await encryptBlob(await audioBlob.arrayBuffer(), sharedKey)])
							: audioBlob;
						await fetch(urls.uploadUrl, {
							method: "PUT",
							headers: { "Content-Type": "application/octet-stream" },
							body: encrypted,
						});
						audioUrl = urls.readUrl;
					}
				}

				const msgType: Message["type"] = audioUrl ? "audio" : imageUrl ? "image" : "text";
				const reply = replyTo ?? undefined;

				if (
					apiEnabled &&
					isEncryptionReady &&
					sharedKey &&
					normalizeEmail(sharedKeyPeerRef.current ?? "") ===
						normalizeEmail(selectedChatUser)
				) {
					const localMessage: Message = {
						id: `${Math.random().toString(36).slice(2, 8)}-${Date.now()}`,
						chatId,
						author: session.email,
						type: msgType,
						text: trimmed || undefined,
						imageUrl,
						audioUrl,
						replyTo: reply,
						timestamp: Date.now(),
					};
					setMessages((prev) => [...prev, localMessage]);

					const encryptedText = await encryptMessageSymmetric(
						trimmed || "",
						sharedKey,
					);
					const result = await api.sendMessage(
						chatId,
						session.email,
						msgType,
						encryptedText,
						imageUrl,
						selectedChatUser,
						audioUrl,
						reply,
					);
					if (result) {
						lastServerCursorRef.current = result.timestamp;
						await cacheMessages([{ ...result, text: trimmed }]);
						const stats = await getCacheStatsForChat(chatId);
						setCacheStats(stats);
					}
				} else if (apiEnabled) {
					setTimeout(() => sendMessage(text, imageBlob, audioBlob), 500);
					return;
				} else {
					const newMessage: Message = {
						id: `${Math.random().toString(36).slice(2, 8)}-${Date.now()}`,
						chatId,
						author: session.email,
						type: msgType,
						text: trimmed || undefined,
						imageUrl,
						audioUrl,
						replyTo: reply,
						timestamp: Date.now(),
					};
					setMessages((prev) => [...prev, newMessage]);
					lastServerCursorRef.current = newMessage.timestamp;
					await cacheMessages([newMessage]);
					const stats = await getCacheStatsForChat(chatId);
					setCacheStats(stats);
				}
			} catch (error) {
				console.error("Error sending message:", error);
			} finally {
				setIsSending(false);
			}
		},
		[session, apiEnabled, isEncryptionReady, sharedKey, selectedChatUser, sharedKeyPeerRef],
	);

	const handleChatImageSelect = (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0] ?? null;
		if (file?.type.startsWith("image/")) {
			setSelectedFile(file);
			optimizeImage(file)
				.then((result) => {
					setOptimizationData(result);
					setPreviewUrl(result.dataUrl);
					setOptimizedBlob(result.blob);
				})
				.catch(() => {
					const reader = new FileReader();
					reader.onload = () => {
						if (typeof reader.result === "string")
							setPreviewUrl(reader.result);
					};
					reader.readAsDataURL(file);
				});
		} else {
			setSelectedFile(null);
			setOptimizationData(null);
			setOptimizedBlob(null);
		}
	};

	const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const reply = replyingTo
			? { id: replyingTo.id, author: replyingTo.author, text: replyingTo.text?.slice(0, 100) }
			: undefined;
		const textToSend = input;
		const blobToSend = selectedFile && optimizedBlob ? optimizedBlob : undefined;
		// Clear input + attachment immediately so the user can keep typing
		// while the previous message is still uploading (WhatsApp-style).
		setInput("");
		setSelectedFile(null);
		setOptimizedBlob(null);
		setOptimizationData(null);
		setPreviewUrl(null);
		setReplyingTo(null);
		sendMessage(textToSend, blobToSend, undefined, reply);
	};

	const clearSelectedFile = () => {
		setSelectedFile(null);
		setOptimizationData(null);
		setOptimizedBlob(null);
	};

	const loadOlderMessages = useCallback(async () => {
		if (isLoadingOlder || !hasMoreMessages || !selectedChatUser || !session) return;

		const activeChatId = chatIdFromPair(session.email, selectedChatUser);
		const oldestTimestamp = messages.length > 0 ? messages[0]!.timestamp : Date.now();

		setIsLoadingOlder(true);
		try {
			const older = await getOlderCachedMessages(activeChatId, oldestTimestamp, PAGE_SIZE);
			if (older.length > 0) {
				// Preserve scroll position
				const el = listRef.current;
				const prevHeight = el?.scrollHeight ?? 0;

				setMessages((prev) => {
					const existingIds = new Set(prev.map((m) => m.id));
					const unique = older.filter((m) => !existingIds.has(m.id));
					return [...unique, ...prev];
				});

				// Restore scroll position after DOM update
				requestAnimationFrame(() => {
					if (el) {
						const newHeight = el.scrollHeight;
						el.scrollTop = newHeight - prevHeight;
					}
				});
			}
			setHasMoreMessages(older.length >= PAGE_SIZE);
		} finally {
			setIsLoadingOlder(false);
		}
	}, [isLoadingOlder, hasMoreMessages, selectedChatUser, session, messages]);

	const toggleReaction = useCallback(async (messageId: string, emoji: string) => {
		if (!session || !selectedChatUser) return;
		const chatId = chatIdFromPair(session.email, selectedChatUser);
		const msg = messages.find((m) => m.id === messageId);
		if (!msg) return;

		// Reconstruct the sort key (same format as server)
		const sk = `${String(msg.timestamp).padStart(16, "0")}#${msg.id}`;

		// Optimistic update
		setMessages((prev) => prev.map((m) => {
			if (m.id !== messageId) return m;
			const reactions = { ...(m.reactions ?? {}) };
			// Remove user from all emojis
			for (const key of Object.keys(reactions)) {
				reactions[key] = reactions[key]!.filter((u) => u !== session.email);
				if (reactions[key]!.length === 0) delete reactions[key];
			}
			// Add if not toggling off
			const had = (m.reactions?.[emoji] ?? []).includes(session.email);
			if (!had) {
				reactions[emoji] = [...(reactions[emoji] ?? []), session.email];
			}
			return { ...m, reactions };
		}));

		await api.toggleReaction(chatId, sk, emoji);
	}, [session, selectedChatUser, messages]);

	return {
		input,
		setInput,
		selectedFile,
		previewUrl,
		optimizationData,
		messages,
		isSending,
		cacheStats,
		isOffline,
		hasMoreMessages,
		isLoadingOlder,
		replyingTo,
		setReplyingTo,
		listRef,
		sendMessage,
		toggleReaction,
		loadOlderMessages,
		handleChatImageSelect,
		handleSubmit,
		clearSelectedFile,
	};
}
