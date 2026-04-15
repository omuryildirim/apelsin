import { useRef, useCallback, useEffect } from "react";
import { useAuthMedia } from "../hooks/useAuthMedia";

export const AuthImage = ({ path, alt, className, onClick, decryptionKey }: { path: string; alt: string; className?: string; onClick?: (blobUrl: string) => void; decryptionKey?: CryptoKey }) => {
    const src = useAuthMedia(path, decryptionKey);
    if (!src) return null;
    return (
        <img
            src={src}
            alt={alt}
            className={className}
            onClick={onClick ? () => onClick(src) : undefined}
        />
    );
}

export const ImageViewer = ({ src, caption, onClose }: { src: string; caption?: string; onClose: () => void }) => {
    const backdropRef = useRef<HTMLDivElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);

    // Transform state
    const scale = useRef(1);
    const translateX = useRef(0);
    const translateY = useRef(0);

    // Pinch state
    const pinch = useRef<{ startDist: number; startScale: number } | null>(null);

    // Drag (pan) state
    const drag = useRef<{ startX: number; startY: number; startTx: number; startTy: number; moved: boolean } | null>(null);

    // Swipe-to-dismiss state (vertical drag at scale=1)
    const dismiss = useRef<{ startY: number; currentY: number } | null>(null);

    const applyTransform = useCallback(() => {
        const el = imgRef.current;
        if (!el) return;
        el.style.transform = `translate(${translateX.current}px, ${translateY.current}px) scale(${scale.current})`;
    }, []);

    const resetTransform = useCallback(() => {
        scale.current = 1;
        translateX.current = 0;
        translateY.current = 0;
        applyTransform();
    }, [applyTransform]);

    const dist = (a: React.Touch, b: React.Touch) =>
        Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        if (e.touches.length === 2) {
            // Pinch start
            dismiss.current = null;
            drag.current = null;
            pinch.current = {
                startDist: dist(e.touches[0]!, e.touches[1]!),
                startScale: scale.current,
            };
        } else if (e.touches.length === 1) {
            pinch.current = null;
            const t = e.touches[0]!;
            if (scale.current > 1.05) {
                // Pan mode
                drag.current = {
                    startX: t.clientX, startY: t.clientY,
                    startTx: translateX.current, startTy: translateY.current,
                    moved: false,
                };
            } else {
                // Dismiss mode
                dismiss.current = { startY: t.clientY, currentY: t.clientY };
            }
        }
    }, []);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        if (pinch.current && e.touches.length === 2) {
            e.preventDefault();
            const d = dist(e.touches[0]!, e.touches[1]!);
            const newScale = Math.min(5, Math.max(0.5, pinch.current.startScale * (d / pinch.current.startDist)));
            scale.current = newScale;
            applyTransform();
        } else if (drag.current && e.touches.length === 1) {
            const t = e.touches[0]!;
            translateX.current = drag.current.startTx + (t.clientX - drag.current.startX);
            translateY.current = drag.current.startTy + (t.clientY - drag.current.startY);
            drag.current.moved = true;
            applyTransform();
        } else if (dismiss.current && e.touches.length === 1) {
            const t = e.touches[0]!;
            dismiss.current.currentY = t.clientY;
            const dy = t.clientY - dismiss.current.startY;
            translateY.current = dy;
            applyTransform();
            // Fade backdrop
            const progress = Math.min(Math.abs(dy) / 300, 1);
            if (backdropRef.current) {
                backdropRef.current.style.opacity = String(1 - progress * 0.6);
            }
        }
    }, [applyTransform]);

    const handleTouchEnd = useCallback(() => {
        if (pinch.current) {
            pinch.current = null;
            if (scale.current < 1) {
                scale.current = 1;
                translateX.current = 0;
                translateY.current = 0;
                const el = imgRef.current;
                if (el) el.style.transition = "transform 200ms ease-out";
                applyTransform();
                setTimeout(() => { if (el) el.style.transition = ""; }, 200);
            }
            return;
        }
        if (drag.current) {
            const wasTap = !drag.current.moved;
            drag.current = null;
            if (wasTap) {
                onClose();
            }
            return;
        }
        if (dismiss.current) {
            const dy = dismiss.current.currentY - dismiss.current.startY;
            dismiss.current = null;
            if (Math.abs(dy) > 120) {
                onClose();
            } else {
                translateY.current = 0;
                const el = imgRef.current;
                if (el) el.style.transition = "transform 200ms ease-out";
                applyTransform();
                if (backdropRef.current) {
                    backdropRef.current.style.transition = "opacity 200ms ease-out";
                    backdropRef.current.style.opacity = "1";
                }
                setTimeout(() => {
                    if (el) el.style.transition = "";
                    if (backdropRef.current) backdropRef.current.style.transition = "";
                }, 200);
            }
            return;
        }
    }, [applyTransform, onClose]);

    // Double-tap to zoom
    const lastTap = useRef(0);
    const handleClick = useCallback((e: React.MouseEvent) => {
        // Desktop: click backdrop to close
        if (e.target === backdropRef.current) {
            onClose();
            return;
        }
        const now = Date.now();
        if (now - lastTap.current < 300) {
            // Double-tap toggle
            if (scale.current > 1.05) {
                resetTransform();
                const el = imgRef.current;
                if (el) {
                    el.style.transition = "transform 200ms ease-out";
                    setTimeout(() => { el.style.transition = ""; }, 200);
                }
            } else {
                scale.current = 2.5;
                translateX.current = 0;
                translateY.current = 0;
                const el = imgRef.current;
                if (el) el.style.transition = "transform 200ms ease-out";
                applyTransform();
                setTimeout(() => { if (el) el.style.transition = ""; }, 200);
            }
            lastTap.current = 0;
        } else {
            lastTap.current = now;
        }
    }, [applyTransform, onClose, resetTransform]);

    // Close on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-50 flex flex-col">
            {/* Backdrop */}
            <div
                ref={backdropRef}
                className="absolute inset-0 bg-black/95"
                onClick={onClose}
            />

            {/* Header */}
            <div className="relative z-10 flex shrink-0 items-center justify-end px-3 py-2"
                style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
            >
                <button
                    type="button"
                    onClick={onClose}
                    className="flex h-10 w-10 items-center justify-center rounded-full text-white/80 transition hover:bg-white/10"
                >
                    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                    </svg>
                </button>
            </div>

            {/* Image */}
            <div
                className="relative z-10 flex min-h-0 flex-1 items-center justify-center overflow-hidden"
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchEnd}
                onClick={handleClick}
            >
                <img
                    ref={imgRef}
                    src={src}
                    alt={caption || "Image"}
                    className="max-h-full max-w-full select-none object-contain"
                    style={{ touchAction: "none" }}
                    draggable={false}
                />
            </div>

            {/* Caption */}
            {caption && (
                <div className="relative z-10 shrink-0 px-4 pb-3 pt-2 text-center"
                    style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
                >
                    <p className="text-sm text-white/80">{caption}</p>
                </div>
            )}
        </div>
    );
}
