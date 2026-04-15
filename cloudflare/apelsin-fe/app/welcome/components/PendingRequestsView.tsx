import { useEffect, useState } from "react";
import { api, type ContactRequest } from "../../lib/api";
import { t } from "../../lib/i18n";
import { Avatar } from "./Avatar";
import { BackButton } from "./BackButton";

interface PendingRequestsViewProps {
	onBack: () => void;
	onAccepted: () => void;
}

export function PendingRequestsView({ onBack, onAccepted }: PendingRequestsViewProps) {
	const [requests, setRequests] = useState<ContactRequest[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		api.getPendingRequests().then((r) => {
			setRequests(r);
			setLoading(false);
		});
	}, []);

	const handleAction = async (email: string, action: "accept" | "decline") => {
		const success = await api.respondToRequest(email, action);
		if (success) {
			setRequests((prev) => prev.filter((r) => r.email !== email));
			if (action === "accept") onAccepted();
		}
	};

	return (
		<div className="flex h-dvh flex-col bg-[#1a1a2e]">
			<div className="flex h-14 shrink-0 items-center gap-3 bg-[#22223a] px-3">
				<BackButton onClick={onBack} />
				<h2 className="text-base font-semibold text-[#f0e6d3]">{t("pending.title")}</h2>
			</div>

			<div className="flex-1 overflow-y-auto">
				{loading ? (
					<div className="flex h-32 items-center justify-center">
						<div className="h-6 w-6 animate-spin rounded-full border-2 border-[#2d2d44] border-t-[#f4a261]" />
					</div>
				) : requests.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
						<p className="text-sm text-[#a89984]">{t("pending.empty")}</p>
					</div>
				) : (
					requests.map((req) => (
						<div
							key={req.email}
							className="flex items-center gap-3 border-b border-[#2d2d44] px-4 py-3"
						>
							<Avatar
								name={req.displayName ?? req.email}
								photoUrl={req.photoUrl}
								size="lg"
							/>
							<div className="min-w-0 flex-1">
								<p className="truncate text-base text-[#f0e6d3]">
									{req.displayName ?? req.email}
								</p>
								<p className="truncate text-sm text-[#a89984]">{req.email}</p>
							</div>
							<div className="flex shrink-0 gap-2">
								<button
									type="button"
									onClick={() => handleAction(req.email, "accept")}
									className="rounded-lg bg-[#f4a261] px-3 py-1.5 text-xs font-semibold text-[#1a1a2e] transition hover:bg-[#e76f51]"
								>
									{t("pending.accept")}
								</button>
								<button
									type="button"
									onClick={() => handleAction(req.email, "decline")}
									className="rounded-lg border border-[#2d2d44] px-3 py-1.5 text-xs text-[#a89984] transition hover:bg-[#2d2d44]"
								>
									{t("pending.decline")}
								</button>
							</div>
						</div>
					))
				)}
			</div>
		</div>
	);
}
