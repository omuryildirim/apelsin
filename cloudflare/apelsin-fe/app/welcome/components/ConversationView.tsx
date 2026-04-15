import { type ChangeEvent, type FormEvent, type RefObject, useCallback, useRef, useState } from "react";
import type { ChatUser, Message } from "../../lib/api";
import type { OptimizationResult } from "../../lib/imageOptimizer";
import { formatFileSize } from "../../lib/imageOptimizer";
import { formatDuration } from "../../lib/formatters";
import { t } from "../../lib/i18n";
import { useChatReady } from "../hooks/useChatReady";
import { Avatar } from "./Avatar";
import { BackButton } from "./BackButton";
import { ImageViewer } from "./ImageViewer";
import { MessageBubble } from "./MessageBubble";
import { MessageContextMenu } from "./MessageContextMenu";

interface ConversationViewProps {
	email: string;
	selectedChatUser: string;
	selectedPeer?: ChatUser;
	statusText: string;
	messages: Message[];
	unreadMessageIndex: number | null;
	unreadMessageCount: number;
	input: string;
	isSending: boolean;
	selectedFile: File | null;
	previewUrl: string | null;
	optimizationData: OptimizationResult | null;
	listRef: RefObject<HTMLDivElement | null>;
	isRecording: boolean;
	recordingDuration: number;
	onBack: () => void;
	onInputChange: (value: string) => void;
	onSubmit: (e: FormEvent<HTMLFormElement>) => void;
	onImageSelect: (e: ChangeEvent<HTMLInputElement>) => void;
	onClearFile: () => void;
	onStartRecording: () => void;
	onStopRecording: () => void;
	onCancelRecording: () => void;
	onTyping: () => void;
	onIdle: () => void;
	hasMoreMessages: boolean;
	isLoadingOlder: boolean;
	onLoadOlder: () => void;
	onStartCall: () => void;
	replyingTo: Message | null;
	onReply: (message: Message) => void;
	onCancelReply: () => void;
	onReaction: (messageId: string, emoji: string) => void;
	mediaDecryptionKey?: CryptoKey;
}

export function ConversationView({
	email,
	selectedChatUser,
	selectedPeer,
	statusText,
	messages,
	unreadMessageIndex,
	unreadMessageCount,
	input,
	isSending,
	selectedFile,
	previewUrl,
	optimizationData,
	listRef,
	isRecording,
	recordingDuration,
	onBack,
	onInputChange,
	onSubmit,
	onImageSelect,
	onClearFile,
	onStartRecording,
	onStopRecording,
	onCancelRecording,
	onTyping,
	onIdle,
	hasMoreMessages,
	isLoadingOlder,
	onLoadOlder,
	onStartCall,
	replyingTo,
	onReply,
	onCancelReply,
	onReaction,
	mediaDecryptionKey,
}: ConversationViewProps) {
	const [menuMessageId, setMenuMessageId] = useState<string | null>(null);
	const [viewerImage, setViewerImage] = useState<{ src: string; caption?: string } | null>(null);
	const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const isReady = useChatReady({ scrollerRef: listRef, resetKey: selectedChatUser });

	const handleSubmit = useCallback(
		(e: FormEvent<HTMLFormElement>) => {
			onSubmit(e);
			// Refocus immediately within the same user gesture so iOS keeps
			// the keyboard open. Without this, tapping the send button on iOS
			// can briefly blur the input and dismiss the keyboard.
			inputRef.current?.focus();
		},
		[onSubmit],
	);
	const swipeState = useRef<{
		startX: number;
		startY: number;
		lastX: number;
		message: Message | null;
		messageEl: HTMLElement | null;
		hintEl: HTMLElement | null;
		direction: "none" | "horizontal" | "vertical";
		vibrated: boolean;
	}>({
		startX: 0, startY: 0, lastX: 0,
		message: null, messageEl: null, hintEl: null,
		direction: "none", vibrated: false,
	});

	const handleTouchStart = useCallback((e: React.TouchEvent, message: Message) => {
		const touch = e.touches[0]!;
		const el = e.currentTarget as HTMLElement;
		swipeState.current = {
			startX: touch.clientX,
			startY: touch.clientY,
			lastX: touch.clientX,
			message,
			messageEl: el,
			hintEl: el.parentElement?.querySelector(".swipe-reply-hint") as HTMLElement | null,
			direction: "none",
			vibrated: false,
		};
		longPressTimer.current = setTimeout(() => {
			if (swipeState.current.direction !== "horizontal") {
				setMenuMessageId(message.id);
			}
		}, 500);
	}, []);

	const handleTouchMove = useCallback((e: React.TouchEvent) => {
		const s = swipeState.current;
		if (!s.messageEl) return;
		const touch = e.touches[0]!;
		const deltaX = touch.clientX - s.startX;
		const deltaY = touch.clientY - s.startY;

		if (s.direction === "none" && (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10)) {
			s.direction = Math.abs(deltaX) > Math.abs(deltaY) ? "horizontal" : "vertical";
			if (longPressTimer.current) {
				clearTimeout(longPressTimer.current);
				longPressTimer.current = null;
			}
		}

		if (s.direction === "horizontal" && deltaX > 0) {
			const clamped = Math.min(deltaX, 80);
			s.messageEl.style.transform = `translateX(${clamped}px)`;
			s.lastX = touch.clientX;
			if (s.hintEl) {
				const progress = Math.min(clamped / 50, 1);
				s.hintEl.style.opacity = String(progress);
				s.hintEl.style.transform = `translateY(-50%) scale(${progress})`;
			}
			if (clamped >= 60 && !s.vibrated) {
				s.vibrated = true;
				navigator.vibrate?.(10);
			}
		}
	}, []);

	const handleTouchEnd = useCallback(() => {
		if (longPressTimer.current) {
			clearTimeout(longPressTimer.current);
			longPressTimer.current = null;
		}
		const s = swipeState.current;
		if (s.messageEl && s.direction === "horizontal") {
			const deltaX = s.lastX - s.startX;
			s.messageEl.style.transition = "transform 0.2s ease-out";
			s.messageEl.style.transform = "";
			if (s.hintEl) {
				s.hintEl.style.transition = "opacity 0.2s ease-out, transform 0.2s ease-out";
				s.hintEl.style.opacity = "0";
				s.hintEl.style.transform = "translateY(-50%) scale(0)";
			}
			const el = s.messageEl;
			const hint = s.hintEl;
			setTimeout(() => {
				el.style.transition = "";
				if (hint) hint.style.transition = "";
			}, 200);
			if (deltaX >= 60 && s.message) {
				onReply(s.message);
			}
		}
		swipeState.current = {
			startX: 0, startY: 0, lastX: 0,
			message: null, messageEl: null, hintEl: null,
			direction: "none", vibrated: false,
		};
	}, [onReply]);

	const scrollToMessage = useCallback((id: string) => {
		const el = document.getElementById(`msg-${id}`);
		if (el) {
			el.scrollIntoView({ behavior: "smooth", block: "center" });
			el.classList.add("bg-[#f4a261]/10");
			setTimeout(() => el.classList.remove("bg-[#f4a261]/10"), 1500);
		}
	}, []);

	const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
		if (e.currentTarget.scrollTop < 100 && hasMoreMessages && !isLoadingOlder) {
			onLoadOlder();
		}
	};
	return (
		<div
			className="flex flex-col bg-[#1a1a2e]"
			style={{ height: "var(--app-height, 100dvh)" }}
		>
			{/* Header */}
			<div
				className="flex shrink-0 items-center gap-3 bg-[#22223a]"
				style={{
					paddingTop: "env(safe-area-inset-top)",
					paddingLeft: "max(0.75rem, env(safe-area-inset-left))",
					paddingRight: "max(0.75rem, env(safe-area-inset-right))",
					minHeight: "calc(3.5rem + env(safe-area-inset-top))",
				}}
			>
				<BackButton onClick={onBack} />
				<Avatar
					name={selectedPeer?.displayName ?? selectedChatUser}
					photoUrl={selectedPeer?.photoUrl}
				/>
				<div className="min-w-0 flex-1">
					<p className="truncate text-base font-medium text-[#f0e6d3]">
						{selectedPeer?.displayName ?? selectedChatUser}
					</p>
					{statusText && (
						<p className={`truncate text-xs ${
							statusText.includes("typing") || statusText.includes("recording")
								? "text-[#f4a261]"
								: statusText === "online"
									? "text-green-400"
									: "text-[#a89984]"
						}`}>{statusText}</p>
					)}
				</div>
				<button
					type="button"
					onClick={onStartCall}
					className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#a89984] transition hover:bg-[#2d2d44]"
				>
					<svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
						<path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z" />
					</svg>
				</button>
			</div>

			{/* Messages */}
			<div className="relative flex-1 overflow-hidden">
				{!isReady && messages.length > 0 && (
					<div className="absolute inset-0 z-10 flex items-center justify-center bg-[#1a1a2e]">
						<div className="h-10 w-10 animate-spin rounded-full border-2 border-[#2d2d44] border-t-[#f4a261]" />
					</div>
				)}
				<div
					ref={listRef}
					onScroll={handleScroll}
					className={`h-full overflow-y-auto px-3 py-2 transition-opacity duration-200 sm:px-[7%] ${isReady ? "opacity-100" : "opacity-0"}`}
				>
					{messages.length === 0 ? (
						<div className="flex h-full items-center justify-center">
							<div className="rounded-lg bg-[#22223a] px-4 py-2 text-center text-xs text-[#a89984] shadow">
								{t("chat.emptyState")}
							</div>
						</div>
					) : (
						<div className="space-y-1">
						{isLoadingOlder && (
							<div className="flex justify-center py-3">
								<div className="h-5 w-5 animate-spin rounded-full border-2 border-[#2d2d44] border-t-[#f4a261]" />
							</div>
						)}
						{messages.map((message, index) => {
							const isOwn = message.author === email;

							// Day separator
							const msgDate = new Date(message.timestamp);
							const prevDate = index > 0 ? new Date(messages[index - 1]!.timestamp) : null;
							const showDateSep = !prevDate ||
								msgDate.toDateString() !== prevDate.toDateString();

							const dateLabel = (() => {
								const today = new Date();
								const yesterday = new Date();
								yesterday.setDate(today.getDate() - 1);
								if (msgDate.toDateString() === today.toDateString()) return t("chat.today");
								if (msgDate.toDateString() === yesterday.toDateString()) return t("chat.yesterday");
								return msgDate.toLocaleDateString(undefined, {
									weekday: "long",
									day: "numeric",
									month: "long",
									year: msgDate.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
								});
							})();

							const reactionEntries = Object.entries(message.reactions ?? {}).filter(([, u]) => u.length > 0);

							return (
								<div key={message.id} id={`msg-${message.id}`} className="transition-colors duration-500">
									{showDateSep && (
										<div className="my-3 flex justify-center">
											<span className="rounded-lg bg-[#22223a] px-3 py-1 text-[0.7rem] font-medium text-[#a89984] shadow">
												{dateLabel}
											</span>
										</div>
									)}
									{unreadMessageIndex === index && (
										<div className="my-2 flex justify-center">
											<span className="rounded-lg bg-[#f4a261]/20 px-3 py-1 text-xs font-medium text-[#f4a261] shadow">
												{unreadMessageCount} {unreadMessageCount !== 1 ? t("chat.unreadMessages") : t("chat.unreadMessage")}
											</span>
										</div>
									)}
									<div
										className={`flex ${isOwn ? "justify-end" : "justify-start"} relative`}
									>
										<div className="swipe-reply-hint pointer-events-none absolute left-3 top-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-[#2d2d44] opacity-0" style={{ transform: "translateY(-50%) scale(0)" }}>
											<svg viewBox="0 0 24 24" className="h-4 w-4 fill-[#a89984]">
												<path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" />
											</svg>
										</div>
										<div
											className="relative max-w-[85%]"
											onTouchStart={(e) => handleTouchStart(e, message)}
											onTouchMove={handleTouchMove}
											onTouchEnd={handleTouchEnd}
											onTouchCancel={handleTouchEnd}
										>
											<div onContextMenu={(e) => { e.preventDefault(); setMenuMessageId(message.id); }}>
												<MessageBubble
													message={message}
													isOwn={isOwn}
													email={email}
													mediaDecryptionKey={mediaDecryptionKey}
													onReplyQuoteClick={scrollToMessage}
													onImageClick={(blobUrl) => setViewerImage({ src: blobUrl, caption: message.text })}
												/>
											</div>

											{/* Reaction badges */}
											{reactionEntries.length > 0 && (
												<div className={`mt-0.5 flex flex-wrap gap-1 ${isOwn ? "justify-end" : "justify-start"}`}>
													{reactionEntries.map(([emoji, users]) => (
														<button
															key={emoji}
															type="button"
															onClick={() => onReaction(message.id, emoji)}
															className={`flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs transition ${
																users.includes(email)
																	? "border-[#f4a261]/40 bg-[#f4a261]/15"
																	: "border-[#2d2d44] bg-[#22223a]"
															}`}
														>
															<span>{emoji}</span>
															{users.length > 1 && <span className="text-[#a89984]">{users.length}</span>}
														</button>
													))}
												</div>
											)}

										</div>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>
			</div>

			{/* Reply preview */}
			{replyingTo && (
				<div className="flex items-center gap-3 border-t border-[#2d2d44] bg-[#22223a] px-4 py-2">
					<div className="min-w-0 flex-1 border-l-2 border-[#f4a261] pl-2">
						<p className="text-xs font-medium text-[#f4a261]">
							{replyingTo.author === email ? t("chat.replyYou") : selectedPeer?.displayName}
						</p>
						<p className="truncate text-xs text-[#a89984]">
							{replyingTo.type === "image" ? t("chat.replyPhoto") : replyingTo.type === "audio" ? t("chat.replyVoice") : replyingTo.text}
						</p>
					</div>
					<button
						type="button"
						onClick={onCancelReply}
						className="shrink-0 text-[#a89984] hover:text-[#f0e6d3]"
					>
						<svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
							<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
						</svg>
					</button>
				</div>
			)}

			{/* Image preview */}
			{previewUrl && (
				<div className="border-t border-[#2d2d44] bg-[#22223a] px-4 py-3">
					<div className="flex items-start gap-3">
						<img
							src={previewUrl}
							alt="Preview"
							className="h-20 w-20 rounded-lg object-cover"
						/>
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm text-[#f0e6d3]">
								{selectedFile?.name}
							</p>
							{optimizationData && (
								<p className="mt-1 text-xs text-[#a89984]">
									{formatFileSize(optimizationData.sizeOriginal)} →{" "}
									{formatFileSize(optimizationData.sizeOptimized)} (
									{optimizationData.reduction}% saved)
								</p>
							)}
						</div>
						<button
							type="button"
							onClick={onClearFile}
							className="text-[#a89984] hover:text-[#f0e6d3]"
						>
							<svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
								<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
							</svg>
						</button>
					</div>
				</div>
			)}

			{/* Input bar */}
			{isRecording ? (
				<div
					className="flex shrink-0 items-center gap-2 bg-[#22223a]"
					style={{
						paddingTop: "0.5rem",
						paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
						paddingLeft: "max(0.75rem, env(safe-area-inset-left))",
						paddingRight: "max(0.75rem, env(safe-area-inset-right))",
					}}
				>
					<button
						type="button"
						onClick={onCancelRecording}
						className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#a89984] transition hover:bg-[#2d2d44]"
					>
						<svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
							<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
						</svg>
					</button>
					<div className="flex flex-1 items-center gap-2 rounded-lg bg-[#2d2d44] px-3 py-2.5">
						<span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 animate-pulse" />
						<span className="text-sm text-[#f0e6d3]">
							{formatDuration(recordingDuration)}
						</span>
						<span className="text-sm text-[#a89984]">{t("chat.recording")}</span>
					</div>
					<button
						type="button"
						onClick={onStopRecording}
						className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f4a261] text-[#1a1a2e] transition hover:bg-[#e76f51]"
					>
						<svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
							<path d="M1.101 21.757L23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z" />
						</svg>
					</button>
				</div>
			) : (
				<form
					onSubmit={handleSubmit}
					className="flex shrink-0 items-end gap-2 bg-[#22223a]"
					style={{
						paddingTop: "0.5rem",
						paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
						paddingLeft: "max(0.75rem, env(safe-area-inset-left))",
						paddingRight: "max(0.75rem, env(safe-area-inset-right))",
					}}
				>
					<label className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-[#a89984] transition hover:bg-[#2d2d44]">
						<svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
							<path d="M1.816 15.556v.002c0 1.502.584 2.912 1.646 3.972s2.472 1.647 3.974 1.647a5.58 5.58 0 003.972-1.645l9.547-9.548c.769-.768 1.147-1.767 1.058-2.817-.079-.968-.548-1.927-1.319-2.698-1.594-1.592-4.068-1.711-5.517-.262l-7.916 7.915c-.881.881-.792 2.25.214 3.261.501.501 1.084.798 1.645.798.429 0 .853-.171 1.224-.539l6.895-6.894.459.459-6.895 6.894c-.565.567-1.303.838-2.076.838-.941 0-1.864-.44-2.551-1.129-1.371-1.368-1.472-3.26-.238-4.499l7.916-7.916c1.837-1.837 4.876-1.699 6.775.2 1.019 1.019 1.586 2.258 1.677 3.508.099 1.393-.526 2.716-1.563 3.756l-9.551 9.548c-2.249 2.254-5.935 2.254-8.187.002-1.258-1.258-1.943-2.92-1.943-4.692v-.002z" />
						</svg>
						<input
							type="file"
							accept="image/*"
							className="sr-only"
							onChange={onImageSelect}
							disabled={isSending}
						/>
					</label>
					<input
						ref={inputRef}
						value={input}
						onChange={(e) => {
							onInputChange(e.target.value);
							if (e.target.value.trim()) onTyping(); else onIdle();
						}}
						onBlur={onIdle}
						className="min-h-[42px] flex-1 rounded-lg border-none bg-[#2d2d44] px-3 py-2.5 text-sm text-[#f0e6d3] placeholder-[#a89984] outline-none"
						placeholder={t("chat.inputPlaceholder")}
						autoComplete="off"
					/>
					{input.trim() || selectedFile ? (
						<button
							type="submit"
							disabled={isSending}
							onMouseDown={(e) => e.preventDefault()}
							className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f4a261] text-[#1a1a2e] transition hover:bg-[#e76f51] disabled:opacity-40"
						>
							<svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
								<path d="M1.101 21.757L23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z" />
							</svg>
						</button>
					) : (
						<button
							type="button"
							onClick={onStartRecording}
							disabled={isSending}
							className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f4a261] text-[#1a1a2e] transition hover:bg-[#e76f51] disabled:opacity-40"
						>
							<svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
								<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
							</svg>
						</button>
					)}
				</form>
			)}

			{viewerImage && (
				<ImageViewer
					src={viewerImage.src}
					caption={viewerImage.caption}
					onClose={() => setViewerImage(null)}
				/>
			)}

			{/* Message context menu dialog */}
			{menuMessageId && (() => {
				const menuMessage = messages.find((m) => m.id === menuMessageId);
				if (!menuMessage) return null;
				return (
					<MessageContextMenu
						message={menuMessage}
						email={email}
						mediaDecryptionKey={mediaDecryptionKey}
						onReaction={onReaction}
						onReply={onReply}
						onClose={() => setMenuMessageId(null)}
					/>
				);
			})()}
		</div>
	);
}
