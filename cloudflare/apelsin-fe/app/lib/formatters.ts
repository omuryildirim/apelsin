export function formatDuration(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatTime(timestamp: number) {
	return new Intl.DateTimeFormat(undefined, {
		hour: "numeric",
		minute: "2-digit",
	}).format(new Date(timestamp));
}

/** "14:32" today, "Yesterday 14:32" yesterday, "11 Apr 14:32" older, "11 Apr 2025 14:32" different year */
export function formatLastSeen(timestamp: number): string {
	const date = new Date(timestamp);
	const now = new Date();
	const time = formatTime(timestamp);

	if (date.toDateString() === now.toDateString()) {
		return `today at ${time}`;
	}

	const yesterday = new Date();
	yesterday.setDate(now.getDate() - 1);
	if (date.toDateString() === yesterday.toDateString()) {
		return `yesterday at ${time}`;
	}

	const sameYear = date.getFullYear() === now.getFullYear();
	const dateStr = date.toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
		...(sameYear ? {} : { year: "numeric" }),
	});
	return `${dateStr} at ${time}`;
}

/** "14:32" today, "Yesterday" yesterday, "11 Apr" older, "11 Apr 2025" different year */
export function formatChatListDate(timestamp: number): string {
	const date = new Date(timestamp);
	const now = new Date();

	if (date.toDateString() === now.toDateString()) {
		return formatTime(timestamp);
	}

	const yesterday = new Date();
	yesterday.setDate(now.getDate() - 1);
	if (date.toDateString() === yesterday.toDateString()) {
		return "Yesterday";
	}

	const sameYear = date.getFullYear() === now.getFullYear();
	return date.toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
		...(sameYear ? {} : { year: "numeric" }),
	});
}
