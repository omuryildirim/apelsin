import { type RefObject, useEffect, useState } from "react";

interface UseChatReadyArgs {
	scrollerRef: RefObject<HTMLElement | null>;
	// Changes when a new chat is opened — triggers re-evaluation.
	resetKey: string | null;
	// Hard ceiling for the wait, in ms. Snaps and reveals after this elapses
	// even if some images are still loading or never finish.
	maxWait?: number;
}

// Waits for all <img> elements inside the scroller to settle (loaded or
// failed), then snaps to the bottom and reveals the chat. Returns `isReady`
// so the parent can show a spinner overlay until everything fits.
//
// For text-only chats the snap + reveal happen on the first frame, so there
// is no flicker. For image-heavy chats the spinner stays visible until either
// every image reports `.complete` or `maxWait` ms elapses.
export const useChatReady = ({
	scrollerRef,
	resetKey,
	maxWait = 1500,
}: UseChatReadyArgs) => {
	const [isReady, setIsReady] = useState(false);

	useEffect(() => {
		setIsReady(false);
		const scroller = scrollerRef.current;
		if (!scroller || !resetKey) return;

		let done = false;

		const allImagesSettled = () => {
			const imgs = scroller.querySelectorAll("img");
			// `.complete` is true for both loaded and errored images, so failed
			// loads don't block readiness.
			return Array.from(imgs).every((img) => img.complete);
		};

		const finish = () => {
			if (done) return;
			done = true;
			clearTimeout(timeoutId);
			mo.disconnect();
			scroller.removeEventListener("load", trySettle, true);
			scroller.removeEventListener("error", trySettle, true);
			// Snap and reveal in the same frame to avoid any unscrolled flash.
			requestAnimationFrame(() => {
				scroller.scrollTop = scroller.scrollHeight;
				setIsReady(true);
			});
		};

		const trySettle = () => {
			if (allImagesSettled()) finish();
		};

		// `load` and `error` don't bubble, so we listen in the capture phase.
		scroller.addEventListener("load", trySettle, true);
		scroller.addEventListener("error", trySettle, true);

		// New <img> nodes mount asynchronously (after media decryption); re-check
		// whenever the subtree changes.
		const mo = new MutationObserver(trySettle);
		mo.observe(scroller, { childList: true, subtree: true });

		const timeoutId = setTimeout(finish, maxWait);

		// Initial check on the next frame — text-only chats finish here.
		requestAnimationFrame(trySettle);

		return () => {
			done = true;
			clearTimeout(timeoutId);
			mo.disconnect();
			scroller.removeEventListener("load", trySettle, true);
			scroller.removeEventListener("error", trySettle, true);
		};
	}, [resetKey, scrollerRef, maxWait]);

	return isReady;
};
