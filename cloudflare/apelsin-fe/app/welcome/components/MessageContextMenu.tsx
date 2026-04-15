import type { Message } from "../../lib/api";
import { t } from "../../lib/i18n";
import { MessageBubble } from "./MessageBubble";

const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

interface MessageContextMenuProps {
	message: Message;
	email: string;
	mediaDecryptionKey?: CryptoKey;
	onReaction: (messageId: string, emoji: string) => void;
	onReply: (message: Message) => void;
	onClose: () => void;
}

export const MessageContextMenu = ({
	message,
	email,
	mediaDecryptionKey,
	onReaction,
	onReply,
	onClose,
}: MessageContextMenuProps) => {
	const isOwn = message.author === email;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
			<div className="absolute inset-0 bg-black/90" />
			<div
				className="relative z-10 flex max-w-[85%] flex-col gap-2"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Message preview */}
				<div className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
					<div className="max-w-full">
						<MessageBubble
							message={message}
							isOwn={isOwn}
							email={email}
							mediaDecryptionKey={mediaDecryptionKey}
						/>
					</div>
				</div>

				{/* Actions card */}
				<div className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
					<div className="rounded-2xl bg-[#22223a] p-2 shadow-xl border border-[#2d2d44]">
						<div className="flex gap-1 mb-1">
							{REACTION_EMOJIS.map((emoji) => (
								<button
									key={emoji}
									type="button"
									onClick={() => { onReaction(message.id, emoji); onClose(); }}
									className="h-11 w-11 rounded-xl text-xl transition hover:bg-[#2d2d44] active:scale-110"
								>
									{emoji}
								</button>
							))}
						</div>
						<button
							type="button"
							onClick={() => { onReply(message); onClose(); }}
							className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-[#f0e6d3] transition hover:bg-[#2d2d44]"
						>
							<svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
								<path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" />
							</svg>
							{t("chat.reply")}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
};
