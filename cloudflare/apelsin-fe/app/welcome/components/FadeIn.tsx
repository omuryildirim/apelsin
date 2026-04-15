import { useEffect, useState, type ReactNode } from "react";

export function FadeIn({ children }: { children: ReactNode }) {
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		requestAnimationFrame(() => setVisible(true));
	}, []);

	return (
		<div
			style={{
				opacity: visible ? 1 : 0,
				transition: "opacity 200ms ease",
			}}
		>
			{children}
		</div>
	);
}
