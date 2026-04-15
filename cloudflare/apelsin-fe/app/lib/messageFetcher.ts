import { api, type Message } from "./api";
import {
	loadUserKeyPair,
	loadKeyFromIDB,
	importPublicKey,
	deriveSharedKey,
	decryptMessageSymmetric,
	storePeerPublicKeyForSW,
} from "./e2eEncryption";
import { cacheMessages } from "./messageCache";

/**
 * Fetch new messages for a chat since a timestamp, decrypt them, and update the cache.
 * Returns the decrypted messages (empty array on failure).
 */
export async function fetchAndDecryptNewMessages(
	myEmail: string,
	peerEmail: string,
	chatId: string,
	since: number,
): Promise<Message[]> {
	try {
		const msgs = since > 0
			? await api.getNewMessages(chatId, since)
			: await api.getMessages(chatId);

		if (msgs.length === 0) return [];

		// Derive or retrieve the shared key
		const kp = await loadUserKeyPair(myEmail);
		if (!kp) return msgs; // can't decrypt without keypair

		let peerPubJwk = await loadKeyFromIDB(`public:${peerEmail.trim().toLowerCase()}`);
		if (!peerPubJwk) {
			peerPubJwk = await api.getPublicKey(peerEmail);
			if (peerPubJwk) await storePeerPublicKeyForSW(peerEmail, peerPubJwk);
		}
		if (!peerPubJwk) return msgs;

		const peerPubKey = await importPublicKey(peerPubJwk);
		const sharedKey = await deriveSharedKey(kp.privateKey, peerPubKey);

		// Decrypt
		const decrypted = await Promise.all(
			msgs.map(async (msg) => {
				try {
					if (msg.text) {
						const text = await decryptMessageSymmetric(msg.text, sharedKey);
						return { ...msg, text };
					}
					return msg;
				} catch {
					return { ...msg, text: "[Decryption failed]" };
				}
			}),
		);

		// Update cache
		await cacheMessages(decrypted);

		return decrypted;
	} catch {
		return [];
	}
}
