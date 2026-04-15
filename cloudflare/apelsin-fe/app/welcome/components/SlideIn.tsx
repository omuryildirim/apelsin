import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const EDGE_THRESHOLD = 30;
const DISMISS_THRESHOLD = 0.3;
const VELOCITY_THRESHOLD = 0.5;

export function SlideIn({
	children,
	show,
	onSwipeClose,
}: {
	children: ReactNode;
	show: boolean;
	onSwipeClose?: () => void;
}) {
	const [mounted, setMounted] = useState(show);
	const childrenRef = useRef<ReactNode>(children);
	const containerRef = useRef<HTMLDivElement>(null);
	const showRef = useRef(show);

	// Swipe state
	const dragging = useRef(false);
	const startX = useRef(0);
	const startTime = useRef(0);
	const currentX = useRef(0);

	if (show) {
		childrenRef.current = children;
	}
	showRef.current = show;

	useEffect(() => {
		if (show) {
			// Mount first, then animate in on next frame
			setMounted(true);
		} else if (containerRef.current) {
			// Animate out
			containerRef.current.style.transition = "transform 250ms cubic-bezier(0.4, 0, 0.2, 1)";
			containerRef.current.style.transform = "translateX(100%)";
		}
	}, [show]);

	// When mounted changes to true, kick off the slide-in
	useEffect(() => {
		if (!mounted || !show) return;
		const el = containerRef.current;
		if (!el) return;

		// Ensure it starts off-screen
		el.style.transition = "none";
		el.style.transform = "translateX(100%)";

		// Force layout, then animate in
		el.getBoundingClientRect();
		el.style.transition = "transform 250ms cubic-bezier(0.4, 0, 0.2, 1)";
		el.style.transform = "translateX(0)";
	}, [mounted, show]);

	// Block iOS Safari's native back-swipe gesture when the user starts a
	// touch in the left-edge area. Without this, the browser tries to
	// navigate back while our SlideIn animates — causing the "double swipe"
	// effect and a ~5s frozen UI while iOS plays its page-snapshot animation.
	//
	// React attaches onTouchStart as a passive listener (preventDefault is a
	// no-op there), so we must attach a native non-passive listener directly.
	useEffect(() => {
		if (!mounted) return;
		const el = containerRef.current;
		if (!el) return;

		const blockEdgeSwipe = (e: TouchEvent) => {
			const touch = e.touches[0];
			if (touch && touch.clientX <= EDGE_THRESHOLD) {
				e.preventDefault();
			}
		};

		el.addEventListener("touchstart", blockEdgeSwipe, { passive: false });
		return () => el.removeEventListener("touchstart", blockEdgeSwipe);
	}, [mounted]);

	const handleTransitionEnd = () => {
		if (!showRef.current) {
			setMounted(false);
		}
	};

	const onTouchStart = useCallback((e: React.TouchEvent) => {
		if (!("ontouchstart" in window)) return;
		const touch = e.touches[0];
		if (!touch || touch.clientX > EDGE_THRESHOLD) return;
		dragging.current = true;
		startX.current = touch.clientX;
		startTime.current = Date.now();
		currentX.current = 0;
		if (containerRef.current) {
			containerRef.current.style.transition = "none";
		}
	}, []);

	const onTouchMove = useCallback((e: React.TouchEvent) => {
		if (!dragging.current) return;
		const touch = e.touches[0];
		if (!touch) return;
		const dx = Math.max(0, touch.clientX - startX.current);
		currentX.current = dx;
		if (containerRef.current) {
			containerRef.current.style.transform = `translateX(${dx}px)`;
		}
	}, []);

	const onTouchEnd = useCallback(() => {
		if (!dragging.current) return;
		dragging.current = false;

		const el = containerRef.current;
		if (!el) return;

		const width = el.offsetWidth;
		const dx = currentX.current;
		const dt = Date.now() - startTime.current;
		const velocity = dx / (dt || 1);

		el.style.transition = "transform 250ms cubic-bezier(0.4, 0, 0.2, 1)";

		if (dx / width > DISMISS_THRESHOLD || velocity > VELOCITY_THRESHOLD) {
			el.style.transform = "translateX(100%)";
			onSwipeClose?.();
		} else {
			el.style.transform = "translateX(0)";
		}
	}, [onSwipeClose]);

	if (!mounted) return null;

	return (
		<div
			ref={containerRef}
			onTransitionEnd={handleTransitionEnd}
			onTouchStart={onTouchStart}
			onTouchMove={onTouchMove}
			onTouchEnd={onTouchEnd}
			className="fixed inset-0 z-10"
		>
			{childrenRef.current}
		</div>
	);
}
