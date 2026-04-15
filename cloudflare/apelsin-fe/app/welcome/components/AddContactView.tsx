import { type FormEvent, useState } from "react";
import { api } from "../../lib/api";
import { t } from "../../lib/i18n";
import { BackButton } from "./BackButton";

interface AddContactViewProps {
	onBack: () => void;
	onAdded: () => void;
}

export function AddContactView({ onBack, onAdded }: AddContactViewProps) {
	const [email, setEmail] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		if (!email.trim()) return;

		setIsLoading(true);
		setMessage(null);
		try {
			const result = await api.sendContactRequest(email.trim().toLowerCase());
			setMessage({ text: result.message, isError: false });
			setEmail("");
			if (result.status === "accepted") {
				setTimeout(onAdded, 1000);
			}
		} catch (err) {
			setMessage({
				text: err instanceof Error ? err.message : t("error.failedToSendRequest"),
				isError: true,
			});
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="flex h-dvh flex-col bg-[#1a1a2e]">
			<div className="flex h-14 shrink-0 items-center gap-3 bg-[#22223a] px-3">
				<BackButton onClick={onBack} />
				<h2 className="text-base font-semibold text-[#f0e6d3]">{t("addContact.title")}</h2>
			</div>

			<div className="flex-1 overflow-y-auto px-4 pt-6">
				<p className="mb-4 text-sm text-[#a89984]">
					{t("addContact.description")}
				</p>

				<form onSubmit={handleSubmit} className="space-y-4">
					<input
						type="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						required
						placeholder={t("addContact.placeholder")}
						className="w-full rounded-lg border border-[#2d2d44] bg-[#2d2d44] px-4 py-3 text-sm text-[#f0e6d3] placeholder-[#a89984] outline-none transition focus:border-[#f4a261]"
					/>

					{message && (
						<div className={`rounded-lg px-4 py-2.5 text-sm ${
							message.isError
								? "bg-red-900/30 text-red-300"
								: "bg-green-900/30 text-green-300"
						}`}>
							{message.text}
						</div>
					)}

					<button
						type="submit"
						disabled={!email.trim() || isLoading}
						className="w-full rounded-lg bg-[#f4a261] py-3 text-sm font-semibold text-[#1a1a2e] transition hover:bg-[#e76f51] disabled:opacity-40 disabled:cursor-not-allowed"
					>
						{isLoading ? t("addContact.sending") : t("addContact.send")}
					</button>
				</form>
			</div>
		</div>
	);
}
