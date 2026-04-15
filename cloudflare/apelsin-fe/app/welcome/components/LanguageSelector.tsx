import { getLocale, LOCALIZED_NAME, type Locale, setLocale, SUPPORTED_LOCALES, t } from "../../lib/i18n";

interface LanguageSelectorProps {
	// Visual variant: "compact" for tight spaces (login), "card" for settings rows.
	variant?: "compact" | "card";
}

const labelKey = (locale: Locale) => `language.${locale}` as const;

export const LanguageSelector = ({ variant = "compact" }: LanguageSelectorProps) => {
	const current = getLocale();

	if (variant === "card") {
		return (
			<div className="rounded-lg bg-[#22223a] px-4 py-3">
				<label className="text-xs text-[#a89984]">{t("language.title")}</label>
				<div className="mt-2 flex gap-2">
					{SUPPORTED_LOCALES.map((locale) => (
						<button
							key={locale}
							type="button"
							onClick={() => setLocale(locale)}
							className={`flex-1 rounded-md py-2 text-sm font-medium transition ${
								current === locale
									? "bg-[#f4a261] text-[#1a1a2e]"
									: "bg-[#2d2d44] text-[#a89984] hover:text-[#f0e6d3]"
							}`}
						>
							{LOCALIZED_NAME[locale]}
						</button>
					))}
				</div>
			</div>
		);
	}

	return (
		<div className="flex items-center justify-center gap-2 text-xs">
			{SUPPORTED_LOCALES.map((locale, idx) => (
				<span key={locale} className="flex items-center gap-2">
					{idx > 0 && <span className="text-[#665c54]">·</span>}
					<button
						type="button"
						onClick={() => setLocale(locale)}
						className={`transition ${
							current === locale
								? "font-semibold text-[#f4a261]"
								: "text-[#a89984] hover:text-[#f0e6d3]"
						}`}
					>
						{LOCALIZED_NAME[locale]}
					</button>
				</span>
			))}
		</div>
	);
};
