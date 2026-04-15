import type { Message } from "../../lib/api";
import { formatTime } from "../../lib/formatters";
import { t } from "../../lib/i18n";
import { AudioMessage } from "./AudioMessage";
import { AuthImage } from "./ImageViewer";

interface MessageBubbleProps {
	message: Message;
	isOwn: boolean;
	email: string;
	mediaDecryptionKey?: CryptoKey;
	onReplyQuoteClick?: (messageId: string) => void;
	onImageClick?: (blobUrl: string) => void;
}

export const MessageBubble = ({
	message,
	isOwn,
	email,
	mediaDecryptionKey,
	onReplyQuoteClick,
	onImageClick,
}: MessageBubbleProps) => (
	<div
		className={`select-none rounded-lg px-2.5 pb-1.5 pt-1.5 shadow ${
			isOwn
				? "bg-[#6d4c3d] text-[#f0e6d3]"
				: "bg-[#22223a] text-[#f0e6d3]"
		}`}
	>
		{message.replyTo && (
			<button
				type="button"
				onClick={() => onReplyQuoteClick?.(message.replyTo!.id)}
				className={`mb-1.5 w-full rounded border-l-2 border-[#f4a261] px-2 py-1 text-left ${
					isOwn ? "bg-[#5a3d30]" : "bg-[#1a1a2e]"
				}`}
			>
				<p className="text-[0.7rem] font-medium text-[#f4a261]">
					{message.replyTo.author === email ? t("chat.replyYou") : message.replyTo.author}
				</p>
				<p className="truncate text-[0.7rem] text-[#a89984]">
					{message.replyTo.text || t("chat.replyPhoto")}
				</p>
			</button>
		)}

		{message.type === "audio" ? (
			<AudioMessage audioUrl={message.audioUrl ?? ""} decryptionKey={mediaDecryptionKey} />
		) : message.type === "image" ? (
			<>
				<div className="overflow-hidden rounded-md">
					<AuthImage
						path={message.imageUrl ?? ""}
						alt={message.text || "Sent image"}
						className="h-auto max-h-80 w-full cursor-pointer object-cover"
						onClick={onImageClick}
						decryptionKey={mediaDecryptionKey}
					/>
				</div>
				{message.text && (
					<p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5">
						{message.text}
					</p>
				)}
			</>
		) : (
			<p className="whitespace-pre-wrap break-words text-sm leading-5">
				{message.text}
			</p>
		)}
		<p className="mt-0.5 text-right text-[0.6875rem] leading-none text-[#a89984]">
			{formatTime(message.timestamp)}
		</p>
	</div>
);
