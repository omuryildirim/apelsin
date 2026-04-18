import { useCallback, useEffect, useRef, useState } from "react";
import { api, VAPID_PUBLIC_KEY } from "../../lib/api";
import type { UserSession } from "../../lib/auth";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
	const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
	const raw = atob(base64);
	const arr = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) {
		arr[i] = raw.charCodeAt(i);
	}
	return arr;
}

export function useNotifications(session: UserSession | null) {
	const subscribedRef = useRef(false);
	const [permission, setPermission] = useState<NotificationPermission>(
		typeof Notification !== "undefined" ? Notification.permission : "default",
	);

	// Sync permission state
	useEffect(() => {
		if (typeof Notification !== "undefined") {
			setPermission(Notification.permission);
		}
	}, []);

	// Auto-subscribe if permission was already granted (from a previous session)
	useEffect(() => {
		if (!session || subscribedRef.current || permission !== "granted") return;
		if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

		(async () => {
			try {
				const registration = await navigator.serviceWorker.ready;
				let subscription = await registration.pushManager.getSubscription();

				if (!subscription) {
					subscription = await registration.pushManager.subscribe({
						userVisibleOnly: true,
						applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
					});
				}

				await api.pushSubscribe(subscription.toJSON());
				subscribedRef.current = true;
			} catch (error) {
				console.error("Push subscription failed:", error);
			}
		})();
	}, [session, permission]);

	// Manual request — call this from a button click
	const requestPermission = useCallback(async () => {
		if (!session) return;
		if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

		try {
			const result = await Notification.requestPermission();
			setPermission(result);

			if (result !== "granted") return;

			const registration = await navigator.serviceWorker.ready;
			let subscription = await registration.pushManager.getSubscription();

			if (!subscription) {
				subscription = await registration.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
				});
			}

			await api.pushSubscribe(subscription.toJSON());
			subscribedRef.current = true;
		} catch (error) {
			console.error("Push subscription failed:", error);
		}
	}, [session]);

	return { permission, requestPermission };
}
