import { type ChangeEvent, useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { UserSession } from "../../lib/auth";
import { optimizeProfilePhoto } from "../../lib/imageOptimizer";

export function useProfile(session: UserSession | null) {
	const [displayName, setDisplayName] = useState("");
	const [photoUrl, setPhotoUrl] = useState<string | undefined>();
	const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
	const [isSaving, setIsSaving] = useState(false);

	useEffect(() => {
		if (!session) return;
		api.getProfile(session.email).then((p) => {
			if (p) {
				setDisplayName(p.displayName ?? session.email);
				setPhotoUrl(p.photoUrl);
			}
		});
	}, [session]);

	const handlePhotoUpload = async (e: ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file || !session) return;
		setIsUploadingPhoto(true);
		try {
			const optimized = await optimizeProfilePhoto(file);
			const urls = await api.getPhotoUploadUrl(session.email, "image/webp");
			if (!urls) throw new Error("Failed to get upload URL");

			await fetch(urls.uploadUrl, {
				method: "PUT",
				headers: { "Content-Type": "image/webp" },
				body: optimized.blob,
			});
			setPhotoUrl(urls.readUrl);
		} catch (error) {
			console.error("Photo upload failed:", error);
		} finally {
			setIsUploadingPhoto(false);
		}
	};

	const handleSave = async () => {
		if (!session) return;
		setIsSaving(true);
		try {
			await api.updateProfile(session.email, displayName);
		} catch (error) {
			console.error("Profile update failed:", error);
		} finally {
			setIsSaving(false);
		}
	};

	return {
		displayName,
		setDisplayName,
		photoUrl,
		isUploadingPhoto,
		isSaving,
		handlePhotoUpload,
		handleSave,
	};
}
