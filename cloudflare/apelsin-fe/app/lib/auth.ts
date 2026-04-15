import { api } from "./api";
import {
	exportPublicKey,
	exportPrivateKey,
	generateKeyPair,
	storeUserKeyPair,
	loadUserKeyPair,
	clearNonPrivateKeys,
} from "./e2eEncryption";

export interface UserSession {
	userId: string;
	email: string;
	displayName: string;
	token: string;
	sessionId: string;
	loginTime: number;
}

const SESSION_STORAGE_KEY = "apelsin_session";

function generateSessionId(): string {
	return `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function initializeAuth(): void {
	// no-op
}

export async function registerUser(
	email: string,
	displayName: string,
	password: string,
): Promise<UserSession> {
	const keyPair = await generateKeyPair();
	const publicKeyJwk = await exportPublicKey(keyPair.publicKey);
	const privateKeyJwk = await exportPrivateKey(keyPair.privateKey);

	const result = await api.register(email, displayName, password, publicKeyJwk);

	await storeUserKeyPair(result.email, privateKeyJwk);

	const session = buildSession(result.userId, result.email, result.displayName, result.token);
	localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
	return session;
}

export async function loginUser(
	email: string,
	password: string,
): Promise<UserSession> {
	const result = await api.login(email, password);

	const session = buildSession(result.userId, result.email, result.displayName, result.token);
	localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
	return session;
}

/** Check if this device has the private key in IndexedDB */
export async function hasLocalPrivateKey(email: string): Promise<boolean> {
	const kp = await loadUserKeyPair(email);
	return kp !== null;
}

function buildSession(
	userId: string,
	email: string,
	displayName: string,
	token: string,
): UserSession {
	return {
		userId,
		email,
		displayName,
		token,
		sessionId: generateSessionId(),
		loginTime: Date.now(),
	};
}

export function getCurrentSession(): UserSession | null {
	const stored = localStorage.getItem(SESSION_STORAGE_KEY);
	if (!stored) return null;

	try {
		return JSON.parse(stored) as UserSession;
	} catch (error) {
		console.error("Failed to parse session:", error);
		return null;
	}
}

export async function logoutUser(): Promise<void> {
	const session = getCurrentSession();
	if (session?.token) {
		await api.revokeDevice(session.token).catch(() => {});
	}

	localStorage.clear();

	// Clear IndexedDB databases + cached keys (keep private keys)
	await Promise.allSettled([
		...["apelsin_db", "apelsin_sw_unread"].map(
			(name) => new Promise<void>((resolve) => {
				const req = indexedDB.deleteDatabase(name);
				req.onsuccess = () => resolve();
				req.onerror = () => resolve();
				req.onblocked = () => resolve();
			}),
		),
		clearNonPrivateKeys(),
	]);
}

export function isLoggedIn(): boolean {
	return getCurrentSession() !== null;
}

export function clearAllAuthData(): void {
	localStorage.removeItem(SESSION_STORAGE_KEY);
}
