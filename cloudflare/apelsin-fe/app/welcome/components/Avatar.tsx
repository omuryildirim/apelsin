import { useAuthMedia } from "../hooks/useAuthMedia";

const DIMS = {
	sm: "h-8 w-8 text-xs",
	md: "h-10 w-10 text-sm",
	lg: "h-12 w-12 text-base",
	xl: "h-24 w-24 text-3xl",
};

export function Avatar({
	name,
	photoUrl,
	size = "md",
}: {
	name: string;
	photoUrl?: string;
	size?: "sm" | "md" | "lg" | "xl";
}) {
	const src = useAuthMedia(photoUrl);

	if (src) {
		return (
			<img
				src={src}
				alt={name}
				className={`${DIMS[size]} shrink-0 rounded-full object-cover`}
			/>
		);
	}
	return (
		<div
			className={`${DIMS[size]} flex shrink-0 items-center justify-center rounded-full bg-[#e76f51] font-semibold text-white`}
		>
			{(name[0] ?? "?").toUpperCase()}
		</div>
	);
}
