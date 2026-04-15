export function BackButton({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex h-10 w-10 items-center justify-center rounded-full text-[#a89984] transition hover:bg-[#2d2d44]"
		>
			<svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
				<path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
			</svg>
		</button>
	);
}
