import type { ChatUser, Message } from "../../lib/api";
import { chatIdFromPair } from "../../lib/chatIdentity";
import { formatChatListDate } from "../../lib/formatters";
import { t } from "../../lib/i18n";
import { Avatar } from "./Avatar";

function messagePreview(msg: Message, myEmail: string): string {
	const prefix = msg.author === myEmail ? t("chatList.you") : "";
	if (msg.type === "audio") return `${prefix}${t("chatList.voiceMessage")}`;
	if (msg.type === "image") return `${prefix}${t("chatList.photo")}`;
	return `${prefix}${msg.text ?? ""}`;
}

interface ChatListViewProps {
	email: string;
	displayName: string;
	profilePhotoUrl?: string;
	chatUsers: ChatUser[];
	lastMessages: Record<string, Message>;
	unreadCounts: Record<string, number>;
	notificationPermission: NotificationPermission;
	onRequestNotifications: () => void;
	onOpenChat: (email: string) => void;
	onOpenProfile: () => void;
	onAddContact: () => void;
	onOpenPending: () => void;
	pendingCount: number;
}

export function ChatListView({
	email,
	displayName,
	profilePhotoUrl,
	chatUsers,
	lastMessages,
	unreadCounts,
	notificationPermission,
	onRequestNotifications,
	onOpenChat,
	onOpenProfile,
	onAddContact,
	onOpenPending,
	pendingCount,
}: ChatListViewProps) {
	return (
		<div className="flex h-dvh flex-col bg-[#1a1a2e]">
			{/* Header */}
			<div className="flex h-14 shrink-0 items-center justify-between bg-[#22223a] px-4">
				<img 
					src="images/web-app-manifest-192x192.png" 
					alt="Apelsin logo"
					className={"h-8 w-8 text-base shrink-0 rounded-full object-cover"}
				/>
				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={onAddContact}
						className="rounded-full p-2 text-[#a89984] transition hover:bg-[#2d2d44]"
						title={t("chatList.addContact")}
					>
						<svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
							<path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
						</svg>
					</button>
					<button
						type="button"
						onClick={onOpenProfile}
						className="rounded-full p-2 text-[#a89984] transition hover:bg-[#2d2d44]"
						title={t("chatList.profile")}
					>
						<Avatar
							name={displayName}
							photoUrl={profilePhotoUrl}
							size="sm"
						/>
					</button>
				</div>
			</div>

			{/* Search bar */}
			<div className="shrink-0 bg-[#1a1a2e] px-3 py-2">
				<div className="flex items-center gap-3 rounded-lg bg-[#22223a] px-4 py-2">
					<svg
						viewBox="0 0 24 24"
						className="h-4 w-4 shrink-0 fill-[#a89984]"
					>
						<path d="M15.009 13.805h-.636l-.22-.219a5.184 5.184 0 001.256-3.386 5.207 5.207 0 10-5.207 5.208 5.183 5.183 0 003.385-1.255l.221.22v.635l4.004 3.999 1.194-1.195-3.997-4.007zm-4.808 0a3.605 3.605 0 110-7.21 3.605 3.605 0 010 7.21z" />
					</svg>
					<span className="text-sm text-[#a89984]">
						{t("chatList.search")}
					</span>
				</div>
			</div>

			{/* Notification prompt */}
			{notificationPermission === "default" && (
				<div className="shrink-0 px-3 pb-2">
					<button
						type="button"
						onClick={onRequestNotifications}
						className="flex w-full items-center gap-3 rounded-lg bg-[#2d2d44] px-4 py-3 text-left transition hover:bg-[#363652]"
					>
						<span className="text-lg">🔔</span>
						<div className="min-w-0 flex-1">
							<p className="text-sm font-medium text-[#f0e6d3]">{t("chatList.enableNotifications")}</p>
							<p className="text-xs text-[#a89984]">{t("chatList.enableNotificationsDesc")}</p>
						</div>
					</button>
				</div>
			)}

			{/* Pending requests banner */}
			{pendingCount > 0 && (
				<div className="shrink-0 px-3 pb-2">
					<button
						type="button"
						onClick={onOpenPending}
						className="flex w-full items-center gap-3 rounded-lg bg-[#2d2d44] px-4 py-3 text-left transition hover:bg-[#363652]"
					>
						<span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f4a261] text-sm font-bold text-[#1a1a2e]">
							{pendingCount}
						</span>
						<div className="min-w-0 flex-1">
							<p className="text-sm font-medium text-[#f0e6d3]">
								{pendingCount > 1 ? t("chatList.pendingRequests") : t("chatList.pendingRequest")}
							</p>
							<p className="text-xs text-[#a89984]">{t("chatList.pendingTap")}</p>
						</div>
					</button>
				</div>
			)}

			{/* Chat list */}
			<div className="flex-1 overflow-y-auto">
				{chatUsers.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
						<div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#22223a]">
							<svg
								viewBox="0 0 24 24"
								className="h-8 w-8 fill-[#a89984]"
							>
								<path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
							</svg>
						</div>
						<p className="text-sm text-[#a89984]">{t("chatList.noContacts")}</p>
						<button
							type="button"
							onClick={onAddContact}
							className="mt-2 rounded-lg bg-[#f4a261] px-5 py-2 text-sm font-semibold text-[#1a1a2e] transition hover:bg-[#e76f51]"
						>
							{t("chatList.addAContact")}
						</button>
					</div>
				) : (
					chatUsers.map((user) => {
						const unread = unreadCounts[user.email] ?? 0;
						const chatId = chatIdFromPair(email, user.email);
						const lastMsg = lastMessages[chatId];
						return (
							<button
								key={user.email}
								type="button"
								onClick={() => onOpenChat(user.email)}
								className="flex w-full items-center gap-3 px-3 py-3 transition hover:bg-[#22223a] active:bg-[#2d2d44]"
							>
								<Avatar
									name={user.displayName ?? user.email}
									photoUrl={user.photoUrl}
									size="lg"
								/>
								<div className="min-w-0 flex-1 border-b border-[#2d2d44] py-1 text-left">
									<div className="flex items-center justify-between">
										<p className="truncate text-base text-[#f0e6d3]">
											{user.displayName ?? user.email}
										</p>
										<div className="flex shrink-0 items-center gap-2 ml-2">
											{lastMsg && (
												<span className="text-[0.7rem] text-[#a89984]">
													{formatChatListDate(lastMsg.timestamp)}
												</span>
											)}
											{unread > 0 && (
												<span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#f4a261] px-1.5 text-xs font-bold text-[#1a1a2e]">
													{unread > 99 ? "99+" : unread}
												</span>
											)}
										</div>
									</div>
									<p className={`truncate text-sm ${unread > 0 ? "text-[#f0e6d3]" : "text-[#a89984]"}`}>
										{lastMsg ? messagePreview(lastMsg, email) : user.email}
									</p>
								</div>
							</button>
						);
					})
				)}
			</div>
		</div>
	);
}
