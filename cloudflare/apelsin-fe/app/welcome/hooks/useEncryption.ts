import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { UserSession } from "../../lib/auth";
import {
	deriveSharedKey,
	importPublicKey,
	loadKeyFromIDB,
	loadUserKeyPair,
	storeKeyInIDB,
	storePeerPublicKeyForSW,
	type UserKeyPair,
} from "../../lib/e2eEncryption";

// In-memory cache: peer email → derived CryptoKey
const sharedKeyCache = new Map<string, CryptoKey>();

export function useEncryption(
	session: UserSession | null,
	selectedChatUser: string | null,
) {
	const [keyPair, setKeyPair] = useState<UserKeyPair | null>(null);
	const [sharedKey, setSharedKey] = useState<CryptoKey | null>(null);
	const [isEncryptionReady, setIsEncryptionReady] = useState(false);
	const sharedKeyPeerRef = useRef<string | null>(null);
	const sharedKeyRef = useRef<CryptoKey | null>(null);
	const keyPairRef = useRef<UserKeyPair | null>(null);

	useEffect(() => {
		sharedKeyRef.current = sharedKey;
	}, [sharedKey]);

	// Load our keypair once on login
	useEffect(() => {
		if (!session) {
			setKeyPair(null);
			keyPairRef.current = null;
			return;
		}

		(async () => {
			const kp = await loadUserKeyPair(session.email);
			if (kp) {
				setKeyPair(kp);
				keyPairRef.current = kp;
				// Store email for SW notification decryption
				await storeKeyInIDB("currentUser", { email: session.email } as unknown as JsonWebKey);
			} else {
				console.warn("No keypair found — please log in again");
			}
		})();
	}, [session]);

	// Derive shared key when chat changes — use cache first
	useEffect(() => {
		if (!session || !selectedChatUser) {
			sharedKeyPeerRef.current = null;
			setSharedKey(null);
			setIsEncryptionReady(!selectedChatUser);
			return;
		}

		const kp = keyPairRef.current;
		if (!kp) {
			setIsEncryptionReady(true);
			return;
		}

		// Check in-memory cache
		const cached = sharedKeyCache.get(selectedChatUser);
		if (cached) {
			sharedKeyPeerRef.current = selectedChatUser;
			setSharedKey(cached);
			setIsEncryptionReady(true);
			return;
		}

		let cancelled = false;

		(async () => {
			try {
				// Try loading peer's public key from IDB first (cached from previous session)
				let peerPubJwk = await loadKeyFromIDB(`public:${selectedChatUser.trim().toLowerCase()}`);

				// If not in IDB, fetch from API
				if (!peerPubJwk) {
					let retries = 0;
					while (retries < 10) {
						if (cancelled) return;
						peerPubJwk = await api.getPublicKey(selectedChatUser);
						if (peerPubJwk) break;
						retries++;
						await new Promise((r) => setTimeout(r, 1000));
					}
				}

				if (!peerPubJwk || cancelled) {
					if (!cancelled) setIsEncryptionReady(true);
					return;
				}

				// Store in IDB for next time
				await storePeerPublicKeyForSW(selectedChatUser, peerPubJwk);

				const peerPubKey = await importPublicKey(peerPubJwk);
				if (cancelled) return;

				const shared = await deriveSharedKey(kp.privateKey, peerPubKey);
				if (cancelled) return;

				// Cache in memory
				sharedKeyCache.set(selectedChatUser, shared);

				sharedKeyPeerRef.current = selectedChatUser;
				setSharedKey(shared);
				setIsEncryptionReady(true);
			} catch (error) {
				console.error("Error setting up encryption:", error);
				if (!cancelled) setIsEncryptionReady(true);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [session, selectedChatUser]);

	return {
		keyPair,
		sharedKey,
		isEncryptionReady,
		sharedKeyPeerRef,
		sharedKeyRef,
	};
}
