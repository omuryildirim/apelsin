import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { t } from "../../lib/i18n";

declare global {
	class BarcodeDetector {
		constructor(opts: { formats: string[] });
		detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
	}
}
import type { UserSession } from "../../lib/auth";
import {
	loadUserKeyPair,
	exportPrivateKey,
	importPublicKey,
	deriveSharedKey,
	encryptMessageSymmetric,
} from "../../lib/e2eEncryption";
import { BackButton } from "./BackButton";

interface QRScannerProps {
	session: UserSession;
	onComplete: () => void;
	onCancel: () => void;
}

export function QRScanner({ session, onComplete, onCancel }: QRScannerProps) {
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const scanningRef = useRef(true);
	const [status, setStatus] = useState<"scanning" | "processing" | "success" | "error">("scanning");
	const [errorMsg, setErrorMsg] = useState("");

	const stopCamera = useCallback(() => {
		scanningRef.current = false;
		if (streamRef.current) {
			streamRef.current.getTracks().forEach((t) => t.stop());
			streamRef.current = null;
		}
	}, []);

	useEffect(() => {
		let animFrame: number;

		(async () => {
			try {
				const stream = await navigator.mediaDevices.getUserMedia({
					video: { facingMode: "environment" },
				});
				streamRef.current = stream;
				if (videoRef.current) {
					videoRef.current.srcObject = stream;
					await videoRef.current.play();
				}

				const useBarcodeDetector = "BarcodeDetector" in window;
				let detector: BarcodeDetector | null = null;
				let canvas: HTMLCanvasElement | null = null;
				let ctx: CanvasRenderingContext2D | null = null;

				let jsQR: ((data: Uint8ClampedArray, width: number, height: number) => { data: string } | null) | null = null;

				if (useBarcodeDetector) {
					detector = new BarcodeDetector({ formats: ["qr_code"] });
				} else {
					jsQR = (await import("jsqr")).default;
					canvas = document.createElement("canvas");
					ctx = canvas.getContext("2d");
				}

				const scan = async () => {
					if (!scanningRef.current) return;

					const video = videoRef.current;
					if (!video || video.readyState < 2) {
						animFrame = requestAnimationFrame(scan);
						return;
					}

					try {
						let data: string | null = null;

						if (detector) {
							const codes = await detector.detect(video);
							if (codes.length > 0) data = codes[0]!.rawValue;
						} else if (canvas && ctx && jsQR) {
							canvas.width = video.videoWidth;
							canvas.height = video.videoHeight;
							ctx.drawImage(video, 0, 0);
							const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
							const code = jsQR(imageData.data, canvas.width, canvas.height);
							if (code) data = code.data;
						}

						if (data) {
							handleQRData(data);
							return;
						}
					} catch {
						// scan error — continue
					}

					animFrame = requestAnimationFrame(scan);
				};

				animFrame = requestAnimationFrame(scan);
			} catch {
				setStatus("error");
				setErrorMsg(t("qrScanner.cameraError"));
			}
		})();

		return () => {
			scanningRef.current = false;
			cancelAnimationFrame(animFrame);
			stopCamera();
		};
	}, [stopCamera]);

	const handleQRData = async (data: string) => {
		scanningRef.current = false;
		stopCamera();
		setStatus("processing");

		try {
			const { sessionId, tempPublicKeyJwk } = JSON.parse(data) as {
				sessionId: string;
				tempPublicKeyJwk: JsonWebKey;
			};

			const kp = await loadUserKeyPair(session.email);
			if (!kp) throw new Error("No private key found on this device");

			const privateKeyJwk = await exportPrivateKey(kp.privateKey);
			const tempPubKey = await importPublicKey(tempPublicKeyJwk);
			const sharedKey = await deriveSharedKey(kp.privateKey, tempPubKey);

			const encryptedBlob = await encryptMessageSymmetric(
				JSON.stringify(privateKeyJwk),
				sharedKey,
			);

			const success = await api.completePairingSession(sessionId, encryptedBlob);
			if (!success) throw new Error("Failed to complete pairing");

			setStatus("success");
			setTimeout(onComplete, 1500);
		} catch (e) {
			setStatus("error");
			setErrorMsg(e instanceof Error ? e.message : "Pairing failed");
		}
	};

	return (
		<div className="flex h-dvh flex-col bg-[#1a1a2e]">
			<div className="flex h-14 shrink-0 items-center gap-3 bg-[#22223a] px-3">
				<BackButton onClick={onCancel} />
				<h2 className="text-base font-semibold text-[#f0e6d3]">
					{t("qrScanner.title")}
				</h2>
			</div>

			<div className="flex flex-1 flex-col items-center justify-center gap-4 px-8">
				{status === "scanning" && (
					<>
						<div className="relative overflow-hidden rounded-2xl border-2 border-[#f4a261]">
							<video
								ref={videoRef}
								className="h-[300px] w-[300px] object-cover"
								playsInline
								muted
							/>
							<div className="absolute inset-0 border-[40px] border-[#1a1a2e]/60" />
						</div>
						<p className="max-w-xs text-center text-sm text-[#a89984]">
							{t("qrScanner.instruction")}
						</p>
					</>
				)}

				{status === "processing" && (
					<>
						<div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#22223a]">
							<span className="h-3 w-3 rounded-full bg-[#f4a261] animate-pulse" />
						</div>
						<p className="text-sm text-[#f4a261]">{t("qrScanner.transferring")}</p>
					</>
				)}

				{status === "success" && (
					<>
						<div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#22223a] text-2xl text-[#f4a261]">
							✓
						</div>
						<p className="text-sm text-[#f0e6d3]">{t("qrScanner.success")}</p>
					</>
				)}

				{status === "error" && (
					<>
						<p className="text-sm text-red-400">{errorMsg}</p>
						<button
							type="button"
							onClick={onCancel}
							className="rounded-lg bg-[#f4a261] px-6 py-2 text-sm font-semibold text-[#1a1a2e]"
						>
							{t("qrScanner.goBack")}
						</button>
					</>
				)}
			</div>
		</div>
	);
}
