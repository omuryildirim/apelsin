import { type ChangeEvent, useEffect, useState } from "react";
import { api, type DeviceSession } from "../../lib/api";
import { t } from "../../lib/i18n";
import { Avatar } from "./Avatar";
import { BackButton } from "./BackButton";
import { LanguageSelector } from "./LanguageSelector";

function formatDate(ts: number) {
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(ts));
}

interface ProfileViewProps {
	email: string;
	displayName: string;
	photoUrl?: string;
	isUploadingPhoto: boolean;
	isSaving: boolean;
	onBack: () => void;
	onDisplayNameChange: (value: string) => void;
	onPhotoUpload: (e: ChangeEvent<HTMLInputElement>) => void;
	onSave: () => void;
	onLinkDevice: () => void;
	onLogout: () => void;
}

export function ProfileView({
	email,
	displayName,
	photoUrl,
	isUploadingPhoto,
	isSaving,
	onBack,
	onDisplayNameChange,
	onPhotoUpload,
	onSave,
	onLinkDevice,
	onLogout,
}: ProfileViewProps) {
	const [devices, setDevices] = useState<DeviceSession[]>([]);

	useEffect(() => {
		api.getDevices().then(setDevices);
	}, []);

	const revokeDevice = async (token: string) => {
		await api.revokeDevice(token);
		setDevices((prev) => prev.filter((d) => d.deviceToken !== token));
	};
	return (
		<div className="flex h-dvh flex-col bg-[#1a1a2e]">
			<div className="flex h-14 shrink-0 items-center gap-3 bg-[#22223a] px-3">
				<BackButton onClick={onBack} />
				<h2 className="text-base font-semibold text-[#f0e6d3]">{t("profile.title")}</h2>
			</div>

			<div className="flex-1 overflow-y-auto">
				<div className="flex flex-col items-center bg-[#22223a] pb-6 pt-8">
					<div className="relative">
						<Avatar
							name={displayName || email}
							photoUrl={photoUrl}
							size="xl"
						/>
						<label className="absolute bottom-0 right-0 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-[#f4a261] text-[#1a1a2e] shadow-lg transition hover:bg-[#e76f51]">
							<svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
								<path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
							</svg>
							<input
								type="file"
								accept="image/*"
								className="sr-only"
								onChange={onPhotoUpload}
								disabled={isUploadingPhoto}
							/>
						</label>
					</div>
					{isUploadingPhoto && (
						<p className="mt-3 text-xs text-[#a89984]">{t("profile.uploading")}</p>
					)}
				</div>

				<div className="mt-4 space-y-1 px-4">
					<div className="rounded-lg bg-[#22223a] px-4 py-3">
						<label className="text-xs text-[#a89984]">{t("profile.displayName")}</label>
						<input
							type="text"
							value={displayName}
							onChange={(e) => onDisplayNameChange(e.target.value)}
							className="mt-1 w-full bg-transparent text-base text-[#f0e6d3] outline-none placeholder-[#665c54]"
							placeholder={t("profile.namePlaceholder")}
						/>
					</div>

					<div className="rounded-lg bg-[#22223a] px-4 py-3">
						<label className="text-xs text-[#a89984]">{t("profile.email")}</label>
						<p className="mt-1 text-base text-[#a89984]">{email}</p>
					</div>

					<button
						type="button"
						onClick={onSave}
						disabled={isSaving}
						className="mt-4 w-full rounded-lg bg-[#f4a261] py-3 text-sm font-semibold text-[#1a1a2e] transition hover:bg-[#e76f51] disabled:opacity-40"
					>
						{isSaving ? t("profile.saving") : t("profile.save")}
					</button>

					<div className="mt-3">
						<LanguageSelector variant="card" />
					</div>

					<button
						type="button"
						onClick={onLinkDevice}
						className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-[#2d2d44] bg-[#22223a] py-3 text-sm font-medium text-[#f0e6d3] transition hover:bg-[#2d2d44]"
					>
						<svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
							<path d="M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z" />
						</svg>
						{t("profile.linkDevice")}
					</button>

					{/* Active Devices */}
					{devices.length > 0 && (
						<div className="mt-6">
							<h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#a89984]">
								{t("profile.activeDevices")}
							</h3>
							<div className="space-y-1">
								{devices.map((device) => (
									<div
										key={device.deviceToken}
										className="flex items-center justify-between rounded-lg bg-[#22223a] px-4 py-3"
									>
										<div className="min-w-0 flex-1">
											<p className="text-sm text-[#f0e6d3]">
												{device.deviceInfo}
												{device.isCurrent && (
													<span className="ml-2 text-xs text-[#f4a261]">
														{t("profile.thisDevice")}
													</span>
												)}
											</p>
											<p className="mt-0.5 text-xs text-[#a89984]">
												{t("profile.lastActive", { date: formatDate(device.lastActiveAt) })}
											</p>
										</div>
										{!device.isCurrent && (
											<button
												type="button"
												onClick={() => revokeDevice(device.deviceToken)}
												className="ml-3 shrink-0 text-xs text-red-400 hover:text-red-300"
											>
												{t("profile.revoke")}
											</button>
										)}
									</div>
								))}
							</div>
						</div>
					)}

					<button
						type="button"
						onClick={onLogout}
						className="mt-6 mb-8 w-full rounded-lg border border-red-900/40 bg-red-950/20 py-3 text-sm font-medium text-red-400 transition hover:bg-red-950/40"
					>
						{t("profile.logout")}
					</button>
				</div>
			</div>
		</div>
	);
}
