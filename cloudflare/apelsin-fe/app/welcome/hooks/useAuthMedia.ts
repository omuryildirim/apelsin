import { useEffect, useState } from "react";
import { fetchMediaBlob } from "../../lib/api";

/**
 * Fetches a media URL with auth headers and returns a blob URL.
 * Caches results so repeated renders don't re-fetch.
 * Pass a CryptoKey to decrypt E2E-encrypted media after fetching.
 */
export function useAuthMedia(
	path: string | undefined,
	decryptionKey?: CryptoKey,
): string {
	const [blobUrl, setBlobUrl] = useState("");

	useEffect(() => {
		if (!path) {
			setBlobUrl("");
			return;
		}
		let cancelled = false;
		fetchMediaBlob(path, decryptionKey).then((url) => {
			if (!cancelled) setBlobUrl(url);
		});
		return () => {
			cancelled = true;
		};
	}, [path, decryptionKey]);

	return blobUrl;
}
