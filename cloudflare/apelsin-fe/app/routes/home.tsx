import { Welcome } from "../welcome/welcome";
import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
	return [
		{ title: "Apelsin" },
		{
			name: "description",
			content:
				"Secure instant messaging app with end-to-end encryption and local caching.",
		},
	];
}

export default function Home() {
	return <Welcome />;
}
