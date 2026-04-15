import { en } from "./constants/en";
import { tr } from "./constants/tr";

const translations = { en, tr } as const;
export const LOCALIZED_NAME: Record<string, string> = {en: "English", tr: "Türkçe"};
export type Locale = keyof typeof translations;
type TranslationKey = keyof typeof en;

export const SUPPORTED_LOCALES = Object.keys(translations) as Locale[];
const DEFAULT_LOCALE: Locale = "en";
const STORAGE_KEY = "apelsin_locale";

const isLocale = (value: string | null | undefined): value is Locale =>
	!!value && SUPPORTED_LOCALES.includes(value as Locale);

const detectLocale = (): Locale => {
	if (typeof window === "undefined") return DEFAULT_LOCALE;
	const stored = window.localStorage?.getItem(STORAGE_KEY);
	if (isLocale(stored)) return stored;
	const lang = window.navigator?.language?.split("-")[0]?.toLowerCase();
	return SUPPORTED_LOCALES.find((l) => l === lang) ?? DEFAULT_LOCALE;
};

let currentLocale: Locale = detectLocale();

export const t = (
	key: TranslationKey,
	params?: Record<string, string | number>,
): string => {
	let text = translations[currentLocale][key] ?? translations.en[key] ?? key;
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			text = text.replace(`{${k}}`, String(v));
		}
	}
	return text;
};

// Persists the choice and reloads so all translation strings re-evaluate.
// Translations are read at call time from `currentLocale`, so without a reload
// already-rendered components would keep their old strings.
export const setLocale = (locale: Locale) => {
	if (locale === currentLocale) return;
	currentLocale = locale;
	if (typeof window !== "undefined") {
		window.localStorage?.setItem(STORAGE_KEY, locale);
		window.location.reload();
	}
};

export const getLocale = (): Locale => currentLocale;
