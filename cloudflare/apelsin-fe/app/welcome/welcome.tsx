import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type ChatUser } from "../lib/api";
import { hasLocalPrivateKey } from "../lib/auth";
import { t } from "../lib/i18n";
import { chatIdFromPair, chatHashSync } from "../lib/chatIdentity";
import { getLastCachedMessagePerChat } from "../lib/messageCache";
import type { Message } from "../lib/api";
import { Login } from "./login";
import { useAuth } from "./hooks/useAuth";
import { useEncryption } from "./hooks/useEncryption";
import { useMessages } from "./hooks/useMessages";
import { useNotifications } from "./hooks/useNotifications";
import { useProfile } from "./hooks/useProfile";
import { useUnreadCounts } from "./hooks/useUnreadCounts";
import { useUnreadDivider } from "./hooks/useUnreadDivider";
import { usePresence } from "./hooks/usePresence";
import { useVoiceRecorder } from "./hooks/useVoiceRecorder";
import { useVoiceCall } from "./hooks/useVoiceCall";
import { CallView } from "./components/CallView";
import { ChatListView } from "./components/ChatListView";
import { ConversationView } from "./components/ConversationView";
import { DeviceLinkQR } from "./components/DeviceLinkQR";
import { ProfileView } from "./components/ProfileView";
import { QRScanner } from "./components/QRScanner";
import { AddContactView } from "./components/AddContactView";
import { PendingRequestsView } from "./components/PendingRequestsView";
import { SlideIn } from "./components/SlideIn";
import { FadeIn } from "./components/FadeIn";

type View = "chats" | "conversation" | "profile" | "linkDevice" | "addContact" | "pendingRequests";

function pushPath(path: string) {
	if (typeof window !== "undefined" && window.location.pathname !== path) {
		window.history.pushState(null, "", path);
	}
}

function getInitialState(): { view: View; chatId?: string } {
	if (typeof window === "undefined") return { view: "chats" };
	const path = window.location.pathname;
	if (path.startsWith("/chat/")) return { view: "conversation", chatId: path.slice(6) };
	if (path === "/profile") return { view: "profile" };
	if (path === "/link-device") return { view: "linkDevice" };
	if (path === "/add-contact") return { view: "addContact" };
	if (path === "/pending") return { view: "pendingRequests" };
	return { view: "chats" };
}

export function Welcome() {
	const initial = useMemo(getInitialState, []);
	const [view, setView] = useState<View>(initial.view);
	const [chatUsers, setChatUsers] = useState<ChatUser[]>([]);
	const [selectedChatUser, setSelectedChatUser] = useState<string | null>(null);
	const [needsDeviceLink, setNeedsDeviceLink] = useState<boolean | null>(null);
	const [lastMessages, setLastMessages] = useState<Record<string, Message>>({});
	const [pendingCount, setPendingCount] = useState(0);

	const { session, isAuthReady, handleLoginSuccess, handleLogout } = useAuth();
	const profile = useProfile(session);
	const { permission, requestPermission } = useNotifications(session);
	const chatEmails = useMemo(() => chatUsers.map((u) => u.email), [chatUsers]);
	const updateLastMessage = useCallback((chatId: string, message: Message) => {
		setLastMessages((prev) => ({ ...prev, [chatId]: message }));
	}, []);

	const { unreadCounts, incrementUnread, clearUnread, markChatSeen, getLastRead } = useUnreadCounts(session, selectedChatUser, chatEmails, updateLastMessage);
	const {
		keyPair,
		sharedKey,
		isEncryptionReady,
		sharedKeyPeerRef,
		sharedKeyRef,
	} = useEncryption(session, selectedChatUser);

	const presence = usePresence(session, selectedChatUser);
	const sendWsRef = useRef<((msg: Record<string, unknown>) => void) | null>(null);
	const voiceCall = useVoiceCall(sendWsRef);

	// Handle incoming call from push notification (?call=email query param)
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const caller = params.get("call");
		if (caller) {
			voiceCall.handleCallSignal(caller, "call-request", {});
			// Clean up the URL
			window.history.replaceState({}, "", window.location.pathname);
		}
	}, []);

	const handleWsReady = useCallback((sendWsMessage: (msg: Record<string, unknown>) => void) => {
		sendWsRef.current = sendWsMessage;
		presence.registerSendPresence(sendWsMessage);
	}, [presence.registerSendPresence]);

	const msg = useMessages(
		session,
		selectedChatUser,
		keyPair,
		sharedKey,
		isEncryptionReady,
		sharedKeyPeerRef,
		sharedKeyRef,
		incrementUnread,
		presence.handlePresence,
		voiceCall.handleCallSignal,
		handleWsReady,
	);

	const recorder = useVoiceRecorder();

	const unreadDivider = useUnreadDivider({
		selectedChatUser,
		userEmail: session?.email,
		messages: msg.messages,
		getLastRead,
	});

	const handleStartRecording = () => {
		presence.sendRecording();
		recorder.startRecording();
	};

	const handleStopRecording = async () => {
		presence.sendIdle();
		const audioBlob = await recorder.stopRecording();
		if (audioBlob) {
			const reply = msg.replyingTo
				? { id: msg.replyingTo.id, author: msg.replyingTo.author, text: msg.replyingTo.text?.slice(0, 100) }
				: undefined;
			msg.sendMessage("", undefined, audioBlob, reply);
			msg.setReplyingTo(null);
			unreadDivider.dismiss();
		}
	};

	const handleConversationSubmit = (event: FormEvent<HTMLFormElement>) => {
		msg.handleSubmit(event);
		unreadDivider.dismiss();
	};

	const handleCancelRecording = () => {
		presence.sendIdle();
		recorder.cancelRecording();
	};

	// Build a hash → email lookup from the chat users list
	const hashToEmail = useMemo(() => {
		if (!session) return new Map<string, string>();
		const map = new Map<string, string>();
		for (const user of chatUsers) {
			const fullChatId = chatIdFromPair(session.email, user.email);
			map.set(chatHashSync(fullChatId), user.email);
		}
		return map;
	}, [session, chatUsers]);

	// Resolve chatId from URL path once users are loaded
	useEffect(() => {
		if (!initial.chatId || !session || chatUsers.length === 0) return;
		const peerEmail = hashToEmail.get(initial.chatId);
		if (peerEmail) {
			setViewOnSelection(peerEmail);
		}
	}, [initial.chatId, session, chatUsers, hashToEmail]);

	const statusText = useMemo(() => {
		if (presence.presenceText) return presence.presenceText;
		if (msg.isOffline && msg.cacheStats && msg.cacheStats.messageCount > 0) {
			return t("presence.offline", { count: msg.cacheStats.messageCount });
		}
		if (!isEncryptionReady && selectedChatUser) {
			return t("presence.establishing");
		}
		if (isEncryptionReady && selectedChatUser) {
			return t("presence.encrypted");
		}
		return "";
	}, [presence.presenceText, isEncryptionReady, msg.isOffline, msg.cacheStats, selectedChatUser]);

	const [isReady, setIsReady] = useState(false);

	useEffect(() => {
		if ("serviceWorker" in navigator) {
			navigator.serviceWorker.register("/sw.js").then();
		}
	}, []);

	// Reply to the service worker's "are you focused?" pings on push events.
	// The SW uses our reply (not its own client.visibilityState, which can be
	// stale) to decide whether to suppress a notification. If we don't reply
	// in time the SW assumes we're not active and shows the notification.
	useEffect(() => {
		if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
		const handler = (event: MessageEvent) => {
			if (event.data?.type !== "apelsin:ping") return;
			const port = event.ports[0];
			if (!port) return;
			port.postMessage({ focused: document.visibilityState === "visible" });
		};
		navigator.serviceWorker.addEventListener("message", handler);
		return () => navigator.serviceWorker.removeEventListener("message", handler);
	}, []);

	// Single initialization: wait for auth, then fetch users + check device key
	useEffect(() => {
		if (!isAuthReady) return;

		if (!session) {
			setNeedsDeviceLink(null);
			setIsReady(true);
			return;
		}

		setIsReady(false);
		(async () => {
			const [contacts, hasKey, cached, pending] = await Promise.all([
				api.getContacts(),
				hasLocalPrivateKey(session.email),
				getLastCachedMessagePerChat(),
				api.getPendingRequests(),
			]);
			setChatUsers(contacts);
			setNeedsDeviceLink(!hasKey);
			setPendingCount(pending.length);

			// If we have cached (decrypted) last messages, use them
			if (Object.keys(cached).length > 0) {
				setLastMessages(cached);
				setIsReady(true);
				return;
			}

			setIsReady(true);
		})();
	}, [isAuthReady, session]);

	const logout = () => {
		handleLogout();
		setSelectedChatUser(null);
		setChatUsers([]);
		setNeedsDeviceLink(null);
		pushPath("/");
	};

	const refreshContacts = async () => {
		const [contacts, pending] = await Promise.all([
			api.getContacts(),
			api.getPendingRequests(),
		]);
		setChatUsers(contacts);
		setPendingCount(pending.length);
	};

	const setViewOnSelection = (email: string) => {
		clearUnread(email);
		setSelectedChatUser(email);
		setView("conversation");
	};

	const openChat = (email: string) => {
		if (!session) return;
		setViewOnSelection(email);
		const hash = chatHashSync(chatIdFromPair(session.email, email));
		pushPath(`/chat/${hash}`);
	};

	const closeChat = () => {
		if (selectedChatUser) markChatSeen(selectedChatUser);
		setSelectedChatUser(null);
		setView("chats");
		pushPath("/");
	};

	const selectedPeer = chatUsers.find(
		(u) => u.email === selectedChatUser,
	);

	// ── Render ────────────────────────────────────────────────────────────────

	// iOS only works properly in Safari (PWA, push, service worker)
	const isUnsupportedIOSBrowser = useMemo(() => {
		if (typeof navigator === "undefined") return false;
		const ua = navigator.userAgent;
		const isIOS = /iPhone|iPad|iPod/.test(ua);
		if (!isIOS) return false;
		// Safari on iOS includes "Safari" but NOT "CriOS" (Chrome) or "FxiOS" (Firefox) or "EdgiOS" (Edge)
		const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
		return !isSafari;
	}, []);

	if (isUnsupportedIOSBrowser) {
		return (
			<div className="flex h-dvh flex-col items-center justify-center gap-4 bg-[#1a1a2e] px-8 text-center">
				<div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#22223a] text-2xl">
					🧭
				</div>
				<h2 className="text-lg font-semibold text-[#f0e6d3]">{t("ios.title")}</h2>
				<p className="text-sm text-[#a89984]">{t("ios.description")}</p>
				<button
					type="button"
					onClick={() => {
						// Copy URL to clipboard for easy pasting into Safari
						navigator.clipboard?.writeText(window.location.href);
					}}
					className="mt-2 rounded-lg bg-[#f4a261] px-6 py-2.5 text-sm font-semibold text-[#1a1a2e] transition hover:bg-[#e76f51]"
				>
					{t("ios.copyLink")}
				</button>
			</div>
		);
	}

	if (!isReady) {
		return (
			<div className="flex h-dvh items-center justify-center bg-[#1a1a2e]">
				<div className="h-10 w-10 animate-spin rounded-full border-2 border-[#2d2d44] border-t-[#f4a261]" />
			</div>
		);
	}

	if (!session) {
		return (
			<FadeIn>
				<Login onLoginSuccess={handleLoginSuccess} />
			</FadeIn>
		);
	}

	if (needsDeviceLink) {
		return (
			<FadeIn>
				<DeviceLinkQR
					session={session}
					onLinkComplete={() => setNeedsDeviceLink(false)}
					onCancel={logout}
				/>
			</FadeIn>
		);
	}

	if (view === "addContact") {
		return (
			<FadeIn>
				<AddContactView
					onBack={() => { setView("chats"); pushPath("/"); }}
					onAdded={() => { refreshContacts(); setView("chats"); pushPath("/"); }}
				/>
			</FadeIn>
		);
	}

	if (view === "pendingRequests") {
		return (
			<FadeIn>
				<PendingRequestsView
					onBack={() => { setView("chats"); pushPath("/"); }}
					onAccepted={() => { refreshContacts(); }}
				/>
			</FadeIn>
		);
	}

	if (view === "linkDevice") {
		return (
			<FadeIn>
				<QRScanner
					session={session}
					onComplete={() => { setView("profile"); pushPath("/profile"); }}
					onCancel={() => { setView("profile"); pushPath("/profile"); }}
				/>
			</FadeIn>
		);
	}

	if (view === "profile") {
		return (
			<FadeIn>
				<ProfileView
					email={session.email}
					displayName={profile.displayName}
					photoUrl={profile.photoUrl}
					isUploadingPhoto={profile.isUploadingPhoto}
					isSaving={profile.isSaving}
					onBack={() => { setView("chats"); pushPath("/"); }}
					onDisplayNameChange={profile.setDisplayName}
					onPhotoUpload={profile.handlePhotoUpload}
					onSave={profile.handleSave}
					onLinkDevice={() => { setView("linkDevice"); pushPath("/link-device"); }}
					onLogout={logout}
				/>
			</FadeIn>
		);
	}

	return (
		<>
			<ChatListView
				email={session.email}
				displayName={profile.displayName}
				profilePhotoUrl={profile.photoUrl}
				chatUsers={chatUsers}
				lastMessages={lastMessages}
				unreadCounts={unreadCounts}
				notificationPermission={permission}
				onRequestNotifications={requestPermission}
				onOpenChat={openChat}
				onOpenProfile={() => { setView("profile"); pushPath("/profile"); }}
				onAddContact={() => { setView("addContact"); pushPath("/add-contact"); }}
				onOpenPending={() => { setView("pendingRequests"); pushPath("/pending"); }}
				pendingCount={pendingCount}
			/>
			<SlideIn show={view === "conversation" && !!selectedChatUser} onSwipeClose={closeChat}>
				{selectedChatUser && (
					<ConversationView
						email={session.email}
						selectedChatUser={selectedChatUser}
						selectedPeer={selectedPeer}
						statusText={statusText}
						messages={msg.messages}
						unreadMessageIndex={unreadDivider.index}
						unreadMessageCount={unreadDivider.count}
						input={msg.input}
						isSending={msg.isSending}
						selectedFile={msg.selectedFile}
						previewUrl={msg.previewUrl}
						optimizationData={msg.optimizationData}
						listRef={msg.listRef}
						isRecording={recorder.isRecording}
						recordingDuration={recorder.duration}
						onBack={closeChat}
						onInputChange={msg.setInput}
						onSubmit={handleConversationSubmit}
						onImageSelect={msg.handleChatImageSelect}
						onClearFile={msg.clearSelectedFile}
						onStartRecording={handleStartRecording}
						onStopRecording={handleStopRecording}
						onCancelRecording={handleCancelRecording}
						onTyping={presence.sendTyping}
						onIdle={presence.sendIdle}
						hasMoreMessages={msg.hasMoreMessages}
						isLoadingOlder={msg.isLoadingOlder}
						onLoadOlder={msg.loadOlderMessages}
						replyingTo={msg.replyingTo}
						onReply={msg.setReplyingTo}
						onCancelReply={() => msg.setReplyingTo(null)}
						onReaction={msg.toggleReaction}
						onStartCall={() => selectedChatUser && voiceCall.startCall(selectedChatUser)}
						mediaDecryptionKey={sharedKey ?? undefined}
					/>
				)}
			</SlideIn>

			{/* Voice call overlay */}
			{voiceCall.callState !== "idle" && voiceCall.callPeer && (
				<CallView
					callState={voiceCall.callState}
					peerName={chatUsers.find((u) => u.email === voiceCall.callPeer)?.displayName ?? voiceCall.callPeer}
					peerPhotoUrl={chatUsers.find((u) => u.email === voiceCall.callPeer)?.photoUrl}
					callDuration={voiceCall.callDuration}
					isMuted={voiceCall.isMuted}
					onAccept={voiceCall.acceptCall}
					onReject={voiceCall.rejectCall}
					onEnd={voiceCall.endCall}
					onToggleMute={voiceCall.toggleMute}
				/>
			)}
		</>
	);
}
