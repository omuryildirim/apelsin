/**
 * End-to-End Encryption using ECDH key agreement + AES-GCM symmetric encryption.
 *
 * 1. Each user generates an ECDH P-256 keypair at registration.
 * 2. Private key is encrypted with the user's password and stored on the server
 *    (so any device can recover it on login).
 * 3. To chat, both users perform ECDH(myPrivate, theirPublic) → shared AES-256 key.
 * 4. Messages are encrypted/decrypted with AES-GCM using that shared key.
 */

function getCryptoSubtle(): SubtleCrypto {
	if (typeof window !== "undefined" && window.crypto && window.crypto.subtle) {
		return window.crypto.subtle as SubtleCrypto;
	}
	if (
		typeof globalThis !== "undefined" &&
		globalThis.crypto &&
		globalThis.crypto.subtle
	) {
		return globalThis.crypto.subtle as SubtleCrypto;
	}
	try {
		if (typeof crypto !== "undefined" && crypto.subtle) {
			return crypto.subtle;
		}
	} catch (_e) {
		// crypto might not be accessible
	}
	throw new Error(
		"Web Crypto API is not available. Use a modern browser with HTTPS or localhost.",
	);
}

function getRandomValues(buffer: Uint8Array): Uint8Array {
	if (typeof window !== "undefined" && window?.crypto?.getRandomValues) {
		window.crypto.getRandomValues(buffer as ArrayBufferView<ArrayBuffer>);
		return buffer;
	}
	throw new Error("crypto.getRandomValues is not available.");
}

export interface UserKeyPair {
	publicKey: CryptoKey;
	privateKey: CryptoKey;
}

const ECDH_PARAMS = { name: "ECDH", namedCurve: "P-256" };

// ── Key generation & import/export ──────────────────────────────────────────

export async function generateKeyPair(): Promise<UserKeyPair> {
	const keyPair = await getCryptoSubtle().generateKey(ECDH_PARAMS, true, [
		"deriveKey",
	]);
	return { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey };
}

export async function exportPublicKey(
	publicKey: CryptoKey,
): Promise<JsonWebKey> {
	return getCryptoSubtle().exportKey("jwk", publicKey);
}

export async function exportPrivateKey(
	privateKey: CryptoKey,
): Promise<JsonWebKey> {
	return getCryptoSubtle().exportKey("jwk", privateKey);
}

export async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
	return getCryptoSubtle().importKey("jwk", jwk, ECDH_PARAMS, true, []);
}

export async function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
	return getCryptoSubtle().importKey("jwk", jwk, ECDH_PARAMS, true, [
		"deriveKey",
	]);
}

// ── ECDH shared key derivation ──────────────────────────────────────────────

export async function deriveSharedKey(
	myPrivateKey: CryptoKey,
	theirPublicKey: CryptoKey,
): Promise<CryptoKey> {
	return getCryptoSubtle().deriveKey(
		{ name: "ECDH", public: theirPublicKey },
		myPrivateKey,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

// ── IndexedDB key storage (shared between main thread and service worker) ───

const IDB_NAME = "apelsin_keys";
const IDB_VERSION = 1;

function openKeyDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(IDB_NAME, IDB_VERSION);
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

export async function storeKeyInIDB(
	key: string,
	value: JsonWebKey,
): Promise<void> {
	try {
		const db = await openKeyDB();
		const tx = db.transaction("keys", "readwrite");
		tx.objectStore("keys").put(value, key);
		await new Promise<void>((resolve) => {
			tx.oncomplete = () => resolve();
		});
		db.close();
	} catch {
		// best-effort
	}
}

export async function loadKeyFromIDB(
	key: string,
): Promise<JsonWebKey | null> {
	try {
		const db = await openKeyDB();
		const tx = db.transaction("keys", "readonly");
		const result = await new Promise<JsonWebKey | null>((resolve) => {
			const req = tx.objectStore("keys").get(key);
			req.onsuccess = () => resolve((req.result as JsonWebKey) ?? null);
			req.onerror = () => resolve(null);
		});
		db.close();
		return result;
	} catch {
		return null;
	}
}

export async function storeUserKeyPair(
	email: string,
	privateKeyJwk: JsonWebKey,
): Promise<void> {
	await storeKeyInIDB(`private:${email.trim().toLowerCase()}`, privateKeyJwk);
}

export async function loadUserKeyPair(
	email: string,
): Promise<UserKeyPair | null> {
	const privateKeyJwk = await loadKeyFromIDB(
		`private:${email.trim().toLowerCase()}`,
	);
	if (!privateKeyJwk) return null;

	try {
		const privateKey = await importPrivateKey(privateKeyJwk);
		const publicKeyJwk: JsonWebKey = {
			kty: privateKeyJwk.kty,
			crv: privateKeyJwk.crv,
			x: privateKeyJwk.x,
			y: privateKeyJwk.y,
			ext: privateKeyJwk.ext,
		};
		const publicKey = await importPublicKey(publicKeyJwk);
		return { publicKey, privateKey };
	} catch (error) {
		console.error("Failed to load keypair:", error);
		return null;
	}
}

export async function clearUserKeys(email: string): Promise<void> {
	try {
		const db = await openKeyDB();
		const tx = db.transaction("keys", "readwrite");
		tx.objectStore("keys").delete(`private:${email.trim().toLowerCase()}`);
		await new Promise<void>((resolve) => {
			tx.oncomplete = () => resolve();
		});
		db.close();
	} catch {
		// best-effort
	}
}

/** Clear all keys except private keys (peer public keys + currentUser marker). */
export async function clearNonPrivateKeys(): Promise<void> {
	try {
		const db = await openKeyDB();
		const tx = db.transaction("keys", "readwrite");
		const store = tx.objectStore("keys");
		const req = store.openCursor();
		req.onsuccess = () => {
			const cursor = req.result;
			if (cursor) {
				if (typeof cursor.key === "string" && !cursor.key.startsWith("private:")) {
					cursor.delete();
				}
				cursor.continue();
			}
		};
		await new Promise<void>((resolve) => {
			tx.oncomplete = () => resolve();
		});
		db.close();
	} catch {
		// best-effort
	}
}

export async function storePeerPublicKeyForSW(
	peerEmail: string,
	publicKeyJwk: JsonWebKey,
): Promise<void> {
	await storeKeyInIDB(
		`public:${peerEmail.trim().toLowerCase()}`,
		publicKeyJwk,
	);
}

// ── AES-GCM binary encryption (for media: images, audio) ───────────────────

export async function encryptBlob(
	data: ArrayBuffer,
	sharedKey: CryptoKey,
): Promise<ArrayBuffer> {
	const iv = getRandomValues(new Uint8Array(12));
	const encrypted = await getCryptoSubtle().encrypt(
		{ name: "AES-GCM", iv: iv as BufferSource },
		sharedKey,
		data,
	);
	const combined = new Uint8Array(iv.length + encrypted.byteLength);
	combined.set(iv);
	combined.set(new Uint8Array(encrypted), iv.length);
	return combined.buffer as ArrayBuffer;
}

export async function decryptBlob(
	data: ArrayBuffer,
	sharedKey: CryptoKey,
): Promise<ArrayBuffer> {
	const combined = new Uint8Array(data);
	const iv = combined.slice(0, 12);
	const encrypted = combined.slice(12);
	return getCryptoSubtle().decrypt(
		{ name: "AES-GCM", iv },
		sharedKey,
		encrypted,
	);
}

// ── AES-GCM symmetric message encryption ────────────────────────────────────

export async function encryptMessageSymmetric(
	message: string,
	sharedKey: CryptoKey,
): Promise<string> {
	if (!message) return message;

	const messageData = new TextEncoder().encode(message);
	const iv = getRandomValues(new Uint8Array(12));

	const encryptedData = await getCryptoSubtle().encrypt(
		{ name: "AES-GCM", iv: iv as BufferSource },
		sharedKey,
		messageData,
	);

	const combined = new Uint8Array(iv.length + encryptedData.byteLength);
	combined.set(iv);
	combined.set(new Uint8Array(encryptedData), iv.length);

	return btoa(String.fromCharCode(...combined));
}

export async function decryptMessageSymmetric(
	encryptedMessage: string,
	sharedKey: CryptoKey,
): Promise<string> {
	try {
		const combined = Uint8Array.from(atob(encryptedMessage), (c) =>
			c.charCodeAt(0),
		);
		const iv = combined.slice(0, 12);
		const encryptedData = combined.slice(12);

		const decryptedData = await getCryptoSubtle().decrypt(
			{ name: "AES-GCM", iv },
			sharedKey,
			encryptedData,
		);

		return new TextDecoder().decode(decryptedData);
	} catch (error) {
		console.error("Symmetric decryption failed:", error);
		throw new Error("Failed to decrypt message");
	}
}
