export interface OptimizationResult {
	blob: Blob;
	dataUrl: string;
	sizeOriginal: number;
	sizeOptimized: number;
	format: string;
	width: number;
	height: number;
	reduction: number;
}

interface OptimizeOptions {
	maxDimension: number;
	quality: number;
	targetSize: number;
}

const CHAT_OPTIONS: OptimizeOptions = {
	maxDimension: 1920,
	quality: 0.7,
	targetSize: 300 * 1024, // 300 KB
};
const PROFILE_OPTIONS: OptimizeOptions = {
	maxDimension: 512,
	quality: 0.75,
	targetSize: Number.POSITIVE_INFINITY,
};

const QUALITY_FLOOR = 0.4;
const DIMENSION_FALLBACKS = [1600, 1280, 1024];

function isSafari(): boolean {
	if (typeof navigator === "undefined") return false;
	const ua = navigator.userAgent;
	// Exclude Chrome (incl. CriOS), Firefox (FxIOS), Edge, and Android browsers
	return /^((?!chrome|crios|fxios|edg|android).)*safari/i.test(ua);
}

function buildQualitySteps(start: number): number[] {
	const steps: number[] = [];
	for (let q = start; q >= QUALITY_FLOOR - 1e-6; q -= 0.15) {
		steps.push(Math.max(QUALITY_FLOOR, Math.round(q * 100) / 100));
	}
	return steps;
}

function buildDimensionSteps(maxDimension: number): number[] {
	const steps = [maxDimension];
	for (const d of DIMENSION_FALLBACKS) {
		if (d < maxDimension) steps.push(d);
	}
	return steps;
}

function scaleToFit(
	srcWidth: number,
	srcHeight: number,
	maxDim: number,
): { width: number; height: number } {
	if (srcWidth <= maxDim && srcHeight <= maxDim) {
		return { width: srcWidth, height: srcHeight };
	}
	const scale = Math.min(maxDim / srcWidth, maxDim / srcHeight);
	return {
		width: Math.round(srcWidth * scale),
		height: Math.round(srcHeight * scale),
	};
}

async function encode(
	bitmap: ImageBitmap,
	width: number,
	height: number,
	type: string,
	quality: number,
): Promise<Blob> {
	const canvas = new OffscreenCanvas(width, height);
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Failed to get canvas context");
	ctx.drawImage(bitmap, 0, 0, width, height);
	return canvas.convertToBlob({ type, quality });
}

async function optimize(
	file: File,
	opts: OptimizeOptions,
): Promise<OptimizationResult> {
	const originalSize = file.size;
	const bitmap = await createImageBitmap(file, {
		imageOrientation: "from-image",
	});
	const { width: srcWidth, height: srcHeight } = bitmap;

	const useJpeg = isSafari();
	const type = useJpeg ? "image/jpeg" : "image/webp";
	const format = useJpeg ? "jpeg" : "webp";

	const dimensionSteps = buildDimensionSteps(opts.maxDimension);
	const qualitySteps = buildQualitySteps(opts.quality);

	let best: { blob: Blob; width: number; height: number } | null = null;

	outer: for (const maxDim of dimensionSteps) {
		const { width, height } = scaleToFit(srcWidth, srcHeight, maxDim);

		for (const quality of qualitySteps) {
			const blob = await encode(bitmap, width, height, type, quality);

			if (!best || blob.size < best.blob.size) {
				best = { blob, width, height };
			}
			if (blob.size <= opts.targetSize) break outer;
		}
	}

	bitmap.close?.();

	if (!best) throw new Error("Image optimization produced no output");

	const dataUrl = await blobToDataUrl(best.blob);
	const reduction = Math.round(
		((originalSize - best.blob.size) / originalSize) * 100,
	);

	return {
		blob: best.blob,
		dataUrl,
		sizeOriginal: originalSize,
		sizeOptimized: best.blob.size,
		format,
		width: best.width,
		height: best.height,
		reduction,
	};
}

export function optimizeImage(file: File): Promise<OptimizationResult> {
	return optimize(file, CHAT_OPTIONS);
}

export function optimizeProfilePhoto(file: File): Promise<OptimizationResult> {
	return optimize(file, PROFILE_OPTIONS);
}

function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			if (typeof reader.result === "string") {
				resolve(reader.result);
			} else {
				reject(new Error("Failed to read blob"));
			}
		};
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
