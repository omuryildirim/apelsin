import { useEffect, useState } from "react";
import {
	getCurrentSession,
	initializeAuth,
	logoutUser,
	type UserSession,
} from "../../lib/auth";

export function useAuth() {
	const [session, setSession] = useState<UserSession | null>(null);
	const [isAuthReady, setIsAuthReady] = useState(false);

	useEffect(() => {
		initializeAuth();
		const currentSession = getCurrentSession();
		setSession(currentSession);
		setIsAuthReady(true);
	}, []);

	const handleLoginSuccess = (newSession: UserSession) => {
		setSession(newSession);
	};

	const handleLogout = async () => {
		await logoutUser();
		setSession(null);
	};

	return { session, isAuthReady, handleLoginSuccess, handleLogout };
}
