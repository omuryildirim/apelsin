import { useEffect, useRef, useState } from "react";
import { encode } from "uqr";
import { api } from "../../lib/api";
import { t } from "../../lib/i18n";
import type { UserSession } from "../../lib/auth";
import {
	generateKeyPair,
	exportPublicKey,
	importPublicKey,
	deriveSharedKey,
	decryptMessageSymmetric,
	storeUserKeyPair,
	storeKeyInIDB,
} from "../../lib/e2eEncryption";

interface DeviceLinkQRProps {
	session: UserSession;
	onLinkComplete: () => void;
	onCancel: () => void;
}

export function DeviceLinkQR({
	session,
	onLinkComplete,
	onCancel,
}: DeviceLinkQRProps) {
	const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
	const [status, setStatus] = useState<"generating" | "waiting" | "linking" | "error">("generating");
	const [errorMsg, setErrorMsg] = useState("");
	const cancelledRef = useRef(false);
	const tempPrivateKeyRef = useRef<CryptoKey | null>(null);

	useEffect(() => {
		cancelledRef.current = false;

		(async () => {
			try {
				// 1. Generate ephemeral ECDH keypair
				const tempKp = await generateKeyPair();
				tempPrivateKeyRef.current = tempKp.privateKey;
				const tempPubJwk = await exportPublicKey(tempKp.publicKey);

				// 2. Create pairing session on server
				const { sessionId } = await api.createPairingSession(tempPubJwk);

				// 3. Generate QR code
				const payload = JSON.stringify({ sessionId, tempPublicKeyJwk: tempPubJwk });
				const { data: modules } = encode(payload);
				const size = modules.length;
				const scale = Math.floor(280 / size);
				const canvas = document.createElement("canvas");
				canvas.width = size * scale;
				canvas.height = size * scale;
				const ctx = canvas.getContext("2d")!;
				ctx.fillStyle = "#f0e6d3";
				ctx.fillRect(0, 0, canvas.width, canvas.height);
				ctx.fillStyle = "#1a1a2e";
				for (let y = 0; y < size; y++) {
					for (let x = 0; x < size; x++) {
						if (modules[y]![x]) {
							ctx.fillRect(x * scale, y * scale, scale, scale);
						}
					}
				}
				const dataUrl = canvas.toDataURL();

				if (cancelledRef.current) return;
				setQrDataUrl(dataUrl);
				setStatus("waiting");

				// 4. Poll for completion
				const maxAttempts = 150; // 5 minutes at 2s intervals
				for (let i = 0; i < maxAttempts; i++) {
					if (cancelledRef.current) return;
					await new Promise((r) => setTimeout(r, 2000));

					const result = await api.pollPairingSession(sessionId);
					if (result.status === "completed" && result.encryptedKeyBlob) {
						setStatus("linking");

						// 5. Fetch our own public key from server
						const realPubJwk = await api.getPublicKey(session.email);
						if (!realPubJwk) throw new Error("Could not fetch public key");

						const realPubKey = await importPublicKey(realPubJwk);

						// 6. Derive shared key: ECDH(tempPrivate, realPublic)
						const sharedKey = await deriveSharedKey(
							tempPrivateKeyRef.current!,
							realPubKey,
						);

						// 7. Decrypt the private key blob
						const decrypted = await decryptMessageSymmetric(
							result.encryptedKeyBlob,
							sharedKey,
						);
						const privateKeyJwk = JSON.parse(decrypted) as JsonWebKey;

						// 8. Store in IndexedDB
						await storeUserKeyPair(session.email, privateKeyJwk);
						await storeKeyInIDB("currentUser", { email: session.email } as unknown as JsonWebKey);

						if (!cancelledRef.current) onLinkComplete();
						return;
					}
				}

				if (!cancelledRef.current) {
					setStatus("error");
					setErrorMsg(t("deviceLink.expired"));
				}
			} catch (e) {
				if (!cancelledRef.current) {
					setStatus("error");
					setErrorMsg(e instanceof Error ? e.message : "Pairing failed");
				}
			}
		})();

		return () => {
			cancelledRef.current = true;
		};
	}, [session, onLinkComplete]);

	return (
		<div className="flex h-dvh flex-col bg-[#1a1a2e]">
			<div className="flex h-14 shrink-0 items-center gap-3 bg-[#22223a] px-4">
				<button
					type="button"
					onClick={onCancel}
					className="text-sm text-[#a89984] hover:text-[#f0e6d3]"
				>
					{t("deviceLink.cancel")}
				</button>
				<h2 className="text-base font-semibold text-[#f0e6d3]">
					{t("deviceLink.title")}
				</h2>
			</div>

			<div className="flex flex-1 flex-col items-center justify-center gap-6 px-8">
				{status === "generating" && (
					<p className="text-sm text-[#a89984]">{t("deviceLink.generating")}</p>
				)}

				{status === "waiting" && qrDataUrl && (
					<>
						<div className="rounded-2xl bg-[#f0e6d3] p-4">
							<img src={qrDataUrl} alt="Link device QR" className="h-[280px] w-[280px]" />
						</div>
						<div className="max-w-xs text-center">
							<p className="text-base font-medium text-[#f0e6d3]">
								{t("deviceLink.scanTitle")}
							</p>
							<p className="mt-2 text-sm text-[#a89984]">
								{t("deviceLink.scanDesc")}
							</p>
						</div>
						<div className="flex items-center gap-2">
							<span className="h-2 w-2 rounded-full bg-[#f4a261] animate-pulse" />
							<span className="text-xs text-[#a89984]">{t("deviceLink.waiting")}</span>
						</div>
					</>
				)}

				{status === "linking" && (
					<p className="text-sm text-[#f4a261]">{t("deviceLink.receiving")}</p>
				)}

				{status === "error" && (
					<>
						<p className="text-sm text-red-400">{errorMsg}</p>
						<button
							type="button"
							onClick={() => window.location.reload()}
							className="rounded-lg bg-[#f4a261] px-6 py-2 text-sm font-semibold text-[#1a1a2e]"
						>
							{t("deviceLink.tryAgain")}
						</button>
					</>
				)}
			</div>
		</div>
	);
}
