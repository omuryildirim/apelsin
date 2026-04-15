import { useEffect } from "react";
import { getLocale, LOCALIZED_NAME } from "./i18n";

const APP_NAME = "Apelsin";

const localizedName = (locale: string) => LOCALIZED_NAME[locale] ?? APP_NAME;

const setMetaContent = (name: string, content: string) => {
	let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
	if (!el) {
		el = document.createElement("meta");
		el.name = name;
		document.head.appendChild(el);
	}
	el.content = content;
};

const setManifestHref = (href: string) => {
	const link = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
	if (link) link.href = href;
};

// Updates document title, the iOS home-screen title meta, and the manifest URL
// to match the user's selected locale. Browsers freeze these values into the
// installed PWA at install time, so users who install in their language will
// see the correct app name on their home screen.
export const usePwaIdentity = () => {
	useEffect(() => {
		const locale = getLocale();
		const name = localizedName(locale);
		document.title = name;
		setMetaContent("apple-mobile-web-app-title", name);
		setManifestHref(locale === "en" ? "/site.webmanifest" : `/site.${locale}.webmanifest`);
	}, []);
};
