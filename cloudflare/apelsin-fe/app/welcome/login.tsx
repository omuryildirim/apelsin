import { type FormEvent, useState } from "react";
import { isMobileDevice } from "../lib/api";
import type { UserSession } from "../lib/auth";
import { loginUser, registerUser } from "../lib/auth";
import { t } from "../lib/i18n";
import { LanguageSelector } from "./components/LanguageSelector";

interface LoginProps {
	onLoginSuccess: (session: UserSession) => void;
}

export function Login({ onLoginSuccess }: LoginProps) {
	const [mode, setMode] = useState<"login" | "register">("login");
	const [displayName, setDisplayName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!email || !password) return;
		if (mode === "register" && (!displayName || password !== confirmPassword)) {
			setError(
				password !== confirmPassword
					? t("login.error.passwordMismatch")
					: t("login.error.nameRequired"),
			);
			return;
		}

		setIsLoading(true);
		setError(null);

		try {
			const session =
				mode === "register"
					? await registerUser(email, displayName, password)
					: await loginUser(email, password);
			onLoginSuccess(session);
		} catch (error) {
			console.error("Login failed:", error);
			setError(
				error instanceof Error ? error.message : "Authentication failed",
			);
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="flex h-dvh flex-col bg-[#1a1a2e] text-[#f0e6d3]">
			<div className="flex h-14 shrink-0 items-center justify-center bg-[#22223a] px-4">
				<img
					src="images/web-app-manifest-192x192.png"
					alt="Apelsin"
					className="h-12 w-12 text-base shrink-0 rounded-full object-cover"
				/>
			</div>

			<div className="flex flex-1 items-center justify-center overflow-y-auto px-4 py-8">
				<div className="w-full max-w-sm">
					<div className="mb-6 text-center">
						<div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-[#f4a261]">
							<svg
								viewBox="0 0 24 24"
								className="h-10 w-10 fill-[#1a1a2e]"
							>
								<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
							</svg>
						</div>
						<p className="text-sm text-[#a89984]">
							{t("login.encrypted")}
						</p>
					</div>

					{isMobileDevice() && (
					<div className="mb-5 flex rounded-lg bg-[#22223a] p-1">
						<button
							type="button"
							onClick={() => setMode("login")}
							className={`flex-1 rounded-md py-2 text-sm font-medium transition ${
								mode === "login"
									? "bg-[#f4a261] text-[#1a1a2e]"
									: "text-[#a89984] hover:text-[#f0e6d3]"
							}`}
						>
							{t("login.tab.login")}
						</button>
						<button
							type="button"
							onClick={() => setMode("register")}
							className={`flex-1 rounded-md py-2 text-sm font-medium transition ${
								mode === "register"
									? "bg-[#f4a261] text-[#1a1a2e]"
									: "text-[#a89984] hover:text-[#f0e6d3]"
							}`}
						>
							{t("login.tab.register")}
						</button>
					</div>
					)}

					<form onSubmit={handleSubmit} className="space-y-4">
						{mode === "register" && (
							<input
								type="text"
								value={displayName}
								onChange={(e) => setDisplayName(e.target.value)}
								required
								className="w-full rounded-lg border border-[#2d2d44] bg-[#2d2d44] px-4 py-3 text-sm text-[#f0e6d3] placeholder-[#a89984] outline-none transition focus:border-[#f4a261]"
								placeholder={t("login.placeholder.name")}
								autoComplete="name"
							/>
						)}

						<input
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							required
							className="w-full rounded-lg border border-[#2d2d44] bg-[#2d2d44] px-4 py-3 text-sm text-[#f0e6d3] placeholder-[#a89984] outline-none transition focus:border-[#f4a261]"
							placeholder={t("login.placeholder.email")}
							autoComplete="email"
						/>

						<input
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							required
							className="w-full rounded-lg border border-[#2d2d44] bg-[#2d2d44] px-4 py-3 text-sm text-[#f0e6d3] placeholder-[#a89984] outline-none transition focus:border-[#f4a261]"
							placeholder={t("login.placeholder.password")}
							autoComplete={
								mode === "register" ? "new-password" : "current-password"
							}
						/>

						{mode === "register" && (
							<input
								type="password"
								value={confirmPassword}
								onChange={(e) => setConfirmPassword(e.target.value)}
								required
								className="w-full rounded-lg border border-[#2d2d44] bg-[#2d2d44] px-4 py-3 text-sm text-[#f0e6d3] placeholder-[#a89984] outline-none transition focus:border-[#f4a261]"
								placeholder={t("login.placeholder.confirmPassword")}
								autoComplete="new-password"
							/>
						)}

						{error && (
							<div className="rounded-lg bg-red-900/30 px-4 py-2.5 text-sm text-red-300">
								{error}
							</div>
						)}

						<button
							type="submit"
							disabled={
								!email ||
								!password ||
								(mode === "register" && (!displayName || !confirmPassword)) ||
								isLoading
							}
							className="w-full rounded-lg bg-[#f4a261] py-3 text-sm font-semibold text-[#1a1a2e] transition hover:bg-[#e76f51] disabled:opacity-40 disabled:cursor-not-allowed"
						>
							{isLoading
								? mode === "register"
									? t("login.button.creating")
									: t("login.button.loggingIn")
								: mode === "register"
									? t("login.button.create")
									: t("login.button.login")}
						</button>
					</form>

					<div className="mt-6">
						<LanguageSelector />
					</div>

					<p className="mt-4 text-center text-xs text-[#a89984]">
						{t("login.footer")}
					</p>
				</div>
			</div>
		</div>
	);
}
