import type { Message } from "./api";

const DB_NAME = "apelsin_db";
const DB_VERSION = 3;
const STORE_NAME = "messages";
const INDEX_TS = "timestamp";
const INDEX_CHAT = "chatId";
const INDEX_CHAT_TS = "chatId_timestamp";

export const PAGE_SIZE = 100;

export interface CacheStats {
	messageCount: number;
	oldestMessage: number | null;
	newestMessage: number | null;
}

function initDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);

		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;
			const tx = (event.target as IDBOpenDBRequest).transaction;

			let store: IDBObjectStore;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
				store.createIndex(INDEX_TS, "timestamp", { unique: false });
				store.createIndex(INDEX_CHAT, "chatId", { unique: false });
			} else {
				store = tx!.objectStore(STORE_NAME);
				if (!store.indexNames.contains(INDEX_CHAT)) {
					store.createIndex(INDEX_CHAT, "chatId", { unique: false });
				}
			}
			// Compound index for efficient paginated queries
			if (!store.indexNames.contains(INDEX_CHAT_TS)) {
				store.createIndex(INDEX_CHAT_TS, ["chatId", "timestamp"], { unique: false });
			}
		};
	});
}

/** Store messages in IndexedDB (upsert). */
export async function cacheMessages(messages: Message[]): Promise<void> {
	if (messages.length === 0) return;
	try {
		const db = await initDB();
		const tx = db.transaction(STORE_NAME, "readwrite");
		const store = tx.objectStore(STORE_NAME);

		for (const message of messages) {
			if (!message.chatId) continue;
			store.put(message);
		}

		await new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
		db.close();
	} catch (error) {
		console.error("Error caching messages:", error);
	}
}

/**
 * Get the latest N messages for a chat using a cursor (efficient, no full scan).
 * Walks backward from the newest message, collects `limit`, returns in chronological order.
 */
export async function getCachedMessagesForChat(
	chatId: string,
	limit: number = PAGE_SIZE,
): Promise<Message[]> {
	try {
		const db = await initDB();
		const tx = db.transaction(STORE_NAME, "readonly");
		const store = tx.objectStore(STORE_NAME);
		const index = store.index(INDEX_CHAT_TS);

		// Range: all entries for this chatId (any timestamp)
		const range = IDBKeyRange.bound([chatId, 0], [chatId, Number.MAX_SAFE_INTEGER]);

		const results: Message[] = [];
		await new Promise<void>((resolve, reject) => {
			// Walk backward (prev) from the highest timestamp
			const req = index.openCursor(range, "prev");
			req.onsuccess = () => {
				const cursor = req.result;
				if (cursor && results.length < limit) {
					results.push(cursor.value as Message);
					cursor.continue();
				} else {
					resolve();
				}
			};
			req.onerror = () => reject(req.error);
		});

		db.close();
		return results.reverse(); // chronological order
	} catch (error) {
		console.error("Error retrieving cached messages for chat:", error);
		return [];
	}
}

/**
 * Load older messages before a timestamp using a cursor (efficient pagination).
 * Walks backward from `beforeTimestamp`, collects `limit`, returns in chronological order.
 */
export async function getOlderCachedMessages(
	chatId: string,
	beforeTimestamp: number,
	limit: number = PAGE_SIZE,
): Promise<Message[]> {
	try {
		const db = await initDB();
		const tx = db.transaction(STORE_NAME, "readonly");
		const store = tx.objectStore(STORE_NAME);
		const index = store.index(INDEX_CHAT_TS);

		// Range: this chatId, timestamp from 0 to just before beforeTimestamp
		const range = IDBKeyRange.bound(
			[chatId, 0],
			[chatId, beforeTimestamp],
			false,
			true, // exclude upper bound (strict less than)
		);

		const results: Message[] = [];
		await new Promise<void>((resolve, reject) => {
			const req = index.openCursor(range, "prev");
			req.onsuccess = () => {
				const cursor = req.result;
				if (cursor && results.length < limit) {
					results.push(cursor.value as Message);
					cursor.continue();
				} else {
					resolve();
				}
			};
			req.onerror = () => reject(req.error);
		});

		db.close();
		return results.reverse(); // chronological order
	} catch (error) {
		console.error("Error retrieving older cached messages:", error);
		return [];
	}
}

/** All cached messages (cross-chat), sorted by timestamp. */
export async function getCachedMessages(): Promise<Message[]> {
	try {
		const db = await initDB();
		const tx = db.transaction(STORE_NAME, "readonly");
		const store = tx.objectStore(STORE_NAME);

		return new Promise((resolve, reject) => {
			const request = store.getAll();
			request.onsuccess = () => {
				const result = request.result as Message[];
				db.close();
				resolve(result.sort((a, b) => a.timestamp - b.timestamp));
			};
			request.onerror = () => {
				db.close();
				reject(request.error);
			};
		});
	} catch (error) {
		console.error("Error retrieving cached messages:", error);
		return [];
	}
}

export async function clearCache(): Promise<void> {
	try {
		const db = await initDB();
		const tx = db.transaction(STORE_NAME, "readwrite");
		const store = tx.objectStore(STORE_NAME);

		return new Promise((resolve, reject) => {
			const request = store.clear();
			request.onsuccess = () => {
				db.close();
				resolve();
			};
			request.onerror = () => {
				db.close();
				reject(request.error);
			};
		});
	} catch (error) {
		console.error("Error clearing cache:", error);
	}
}

export async function getCacheStatsForChat(
	chatId: string,
): Promise<CacheStats> {
	try {
		const db = await initDB();
		const tx = db.transaction(STORE_NAME, "readonly");
		const store = tx.objectStore(STORE_NAME);
		const index = store.index(INDEX_CHAT_TS);

		const range = IDBKeyRange.bound([chatId, 0], [chatId, Number.MAX_SAFE_INTEGER]);

		// Count
		const count = await new Promise<number>((resolve, reject) => {
			const req = index.count(range);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});

		if (count === 0) {
			db.close();
			return { messageCount: 0, oldestMessage: null, newestMessage: null };
		}

		// Oldest (first in range)
		const oldest = await new Promise<number | null>((resolve, reject) => {
			const req = index.openCursor(range, "next");
			req.onsuccess = () => {
				const cursor = req.result;
				resolve(cursor ? (cursor.value as Message).timestamp : null);
			};
			req.onerror = () => reject(req.error);
		});

		// Newest (last in range)
		const newest = await new Promise<number | null>((resolve, reject) => {
			const req = index.openCursor(range, "prev");
			req.onsuccess = () => {
				const cursor = req.result;
				resolve(cursor ? (cursor.value as Message).timestamp : null);
			};
			req.onerror = () => reject(req.error);
		});

		db.close();
		return { messageCount: count, oldestMessage: oldest, newestMessage: newest };
	} catch {
		return { messageCount: 0, oldestMessage: null, newestMessage: null };
	}
}

/** Get the last (most recent) cached message for each chat. */
export async function getLastCachedMessagePerChat(): Promise<Record<string, Message>> {
	try {
		const all = await getCachedMessages();
		const result: Record<string, Message> = {};
		for (const msg of all) {
			result[msg.chatId] = msg;
		}
		return result;
	} catch {
		return {};
	}
}
