self.addEventListener("install", () => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

// ── Unread count storage ────────────────────────────────────────────────────

function openUnreadDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open("apelsin_sw_unread", 1);
        req.onupgradeneeded = () => {
            req.result.createObjectStore("counts");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function incrementUnread(author) {
    try {
        const db = await openUnreadDB();
        const tx = db.transaction("counts", "readwrite");
        const store = tx.objectStore("counts");

        const current = await new Promise((resolve) => {
            const req = store.get(author);
            req.onsuccess = () => resolve(req.result || 0);
            req.onerror = () => resolve(0);
        });

        store.put(current + 1, author);
        await new Promise((resolve) => { tx.oncomplete = resolve; });
        db.close();
    } catch (e) {
        // best-effort
    }
}

async function clearUnreadFor(author) {
    try {
        const db = await openUnreadDB();
        const tx = db.transaction("counts", "readwrite");
        tx.objectStore("counts").delete(author);
        await new Promise((resolve) => { tx.oncomplete = resolve; });
        db.close();
    } catch {
        // best-effort
    }
}

async function getTotalUnread() {
    try {
        const db = await openUnreadDB();
        const tx = db.transaction("counts", "readonly");
        const store = tx.objectStore("counts");
        let total = 0;

        await new Promise((resolve) => {
            const cursor = store.openCursor();
            cursor.onsuccess = () => {
                const c = cursor.result;
                if (c) {
                    total += c.value || 0;
                    c.continue();
                }
            };
            tx.oncomplete = resolve;
        });

        db.close();
        return total;
    } catch {
        return 0;
    }
}

// ── Key storage (shared with main app via IndexedDB) ────────────────────────

function openKeyDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open("apelsin_keys", 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("keys")) {
                db.createObjectStore("keys");
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function getKeyFromIDB(key) {
    try {
        const db = await openKeyDB();
        const tx = db.transaction("keys", "readonly");
        const result = await new Promise((resolve) => {
            const req = tx.objectStore("keys").get(key);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => resolve(null);
        });
        db.close();
        return result;
    } catch {
        return null;
    }
}

// ── E2E Decryption ──────────────────────────────────────────────────────────

const ECDH_PARAMS = { name: "ECDH", namedCurve: "P-256" };

async function decryptNotificationText(encryptedText, author) {
    try {
        // 1. Get current user email
        const currentUser = await getKeyFromIDB("currentUser");
        if (!currentUser?.email) return null;

        // 2. Load our private key
        const privateKeyJwk = await getKeyFromIDB(`private:${currentUser.email}`);
        if (!privateKeyJwk) return null;

        // 3. Load the sender's public key
        const publicKeyJwk = await getKeyFromIDB(`public:${author}`);
        if (!publicKeyJwk) return null;

        // 4. Import keys
        const privateKey = await crypto.subtle.importKey(
            "jwk", privateKeyJwk, ECDH_PARAMS, false, ["deriveKey"]
        );
        const publicKey = await crypto.subtle.importKey(
            "jwk", publicKeyJwk, ECDH_PARAMS, false, []
        );

        // 5. ECDH → shared AES key
        const sharedKey = await crypto.subtle.deriveKey(
            { name: "ECDH", public: publicKey },
            privateKey,
            { name: "AES-GCM", length: 256 },
            false,
            ["decrypt"]
        );

        // 6. Decode base64 → IV + ciphertext
        const combined = Uint8Array.from(atob(encryptedText), (c) => c.charCodeAt(0));
        const iv = combined.slice(0, 12);
        const ciphertext = combined.slice(12);

        // 7. AES-GCM decrypt
        const decrypted = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv },
            sharedKey,
            ciphertext
        );

        return new TextDecoder().decode(decrypted);
    } catch (e) {
        console.warn("SW decryption failed:", e);
        return null;
    }
}

// ── Active-page detection ───────────────────────────────────────────────────

// Ask each open client whether it considers itself focused. We can't trust
// `client.focused` / `client.visibilityState` alone — they can lag or be
// stale, especially on iOS PWAs after a SW update. Asking the page directly
// gets the truth from the only reliable source (document.visibilityState in
// the page itself). If the page is frozen or closed, no reply arrives and
// we correctly fall through to showing a notification.
async function isAppFocused() {
    try {
        const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        if (all.length === 0) return false;

        // Fast path: trust the SW's own view if it already says focused
        if (all.some((c) => c.focused)) return true;

        const replies = await Promise.all(all.map((client) =>
            new Promise((resolve) => {
                const ch = new MessageChannel();
                const timer = setTimeout(() => resolve(false), 300);
                ch.port1.onmessage = (e) => {
                    clearTimeout(timer);
                    resolve(e.data?.focused === true);
                };
                try {
                    client.postMessage({ type: "apelsin:ping" }, [ch.port2]);
                } catch {
                    clearTimeout(timer);
                    resolve(false);
                }
            })
        ));
        return replies.some(Boolean);
    } catch {
        return false;
    }
}

// ── Push handler ────────────────────────────────────────────────────────────

self.addEventListener("push", (event) => {
    if (!event.data) return;

    const data = event.data.json();

    event.waitUntil(
        (async () => {
            const pushType = data.data?.type;

            // ── Incoming call notification ────────────────────────────────
            if (pushType === "call") {
                // Always show call notifications, even if app is focused —
                // the WS handler shows the in-app UI, but if the app was
                // closed the push is the only way to reach the user.
                if (await isAppFocused()) return;

                await self.registration.showNotification(data.title || "Apelsin", {
                    body: data.body || "Incoming call",
                    icon: "/images/web-app-manifest-192x192.png",
                    badge: "/images/web-app-manifest-192x192.png",
                    data: data.data || {},
                    tag: `call-${data.data?.from || "unknown"}`,
                    requireInteraction: true,
                    renotify: true,
                    vibrate: [200, 100, 200, 100, 200, 100, 200],
                });
                return;
            }

            // ── Missed call notification ──────────────────────────────────
            if (pushType === "missed-call") {
                // Dismiss any active call notification from this caller
                const existing = await self.registration.getNotifications({ tag: `call-${data.data?.from}` });
                existing.forEach((n) => n.close());

                await self.registration.showNotification(data.title || "Apelsin", {
                    body: data.body || "Missed call",
                    icon: "/images/web-app-manifest-192x192.png",
                    badge: "/images/web-app-manifest-192x192.png",
                    data: data.data || {},
                    tag: `missed-call-${data.data?.from || "unknown"}`,
                    renotify: true,
                });
                return;
            }

            // ── Regular message notification ──────────────────────────────
            // If the app is open and visible, the WS handler in the main
            // thread already tracks this message and updates the badge.
            // Doing it again here would double-count and over-badge.
            if (await isAppFocused()) return;

            // Track unread count
            if (data.data?.author) {
                await incrementUnread(data.data.author);
            }

            // Update app badge
            const total = await getTotalUnread();
            // setAppBadge exists in navigator prototype not registration
            if (self.navigator.setAppBadge) {
                await self.navigator.setAppBadge(total);
            }

            // Try to decrypt the message text
            let body = data.body || "New message";
            if (data.data?.encryptedText && data.data?.author) {
                const decrypted = await decryptNotificationText(
                    data.data.encryptedText,
                    data.data.author
                );
                if (decrypted) {
                    body = decrypted;
                }
            }

            await self.registration.showNotification(data.title || "Apelsin", {
                body,
                icon: "/images/web-app-manifest-192x192.png",
                badge: "/images/web-app-manifest-192x192.png",
                data: data.data || {},
                tag: `chat-${data.data?.author || "unknown"}`,
                renotify: true,
            });
        })()
    );
});

function chatHashSync(chatId) {
    let h = 5381;
    for (let i = 0; i < chatId.length; i++) {
        h = ((h << 5) + h + chatId.charCodeAt(i)) >>> 0;
    }
    return h.toString(36);
}

self.addEventListener("notificationclick", (event) => {
    event.notification.close();

    const pushType = event.notification.data?.type;
    const chatId = event.notification.data?.chatId;
    const author = event.notification.data?.author;

    const isCallNotification = pushType === "call" || pushType === "missed-call";
    const caller = event.notification.data?.from;
    const targetPath = pushType === "call" && caller
        ? `/?call=${encodeURIComponent(caller)}`
        : isCallNotification
            ? "/"
            : chatId ? `/chat/${chatHashSync(chatId)}` : "/";

    event.waitUntil(
        (async () => {
            // Clear this author's unread count so the badge reflects truth
            // immediately, without waiting for the app to boot and sync.
            if (author && !isCallNotification) {
                await clearUnreadFor(author);
                const total = await getTotalUnread();
                if (self.navigator.setAppBadge) {
                    if (total > 0) await self.navigator.setAppBadge(total);
                    else if (self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
                }
            }

            const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
            for (const client of clients) {
                if (client.url.includes(self.location.origin) && "focus" in client) {
                    client.navigate(targetPath);
                    return client.focus();
                }
            }
            return self.clients.openWindow(targetPath);
        })()
    );
});
