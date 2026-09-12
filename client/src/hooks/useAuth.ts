import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { tenantShortName } from "@/lib/tenant";
import { markSessionExpired } from "@/lib/sessionExpiry";

/**
 * `authState` names why a request is not authenticated, which
 * `isAuthenticated: false` alone cannot:
 *
 *   anonymous       — never signed in; demo data is the honest answer.
 *   mfa_pending     — password accepted, second factor outstanding.
 *   session_expired — was signed in, session no longer revalidates.
 */
export type AuthState = "authenticated" | "anonymous" | "mfa_pending" | "session_expired";

export interface AuthUser {
  isAuthenticated: boolean;
  authState?: AuthState;
  id?: string;
  username?: string;
  clientId: string;
  clientName: string;
  isAdmin?: boolean;
  role?: string;
  mfaEnabled?: boolean;
}

export function useAuth() {
  const { data: user, isLoading } = useQuery<AuthUser>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  // /api/auth/user keeps answering 200 while a session is stale — it is one of
  // the routes the client needs in order to recover — so the expiry signal
  // that other endpoints raise through their 401 has to be raised here from
  // the reported state instead. Without this, a reload landing on a stale
  // cookie would strip the session and then look merely anonymous.
  const authState = user?.authState;
  useEffect(() => {
    if (authState === "session_expired") markSessionExpired();
  }, [authState]);

  return {
    user,
    isLoading,
    isAuthenticated: user?.isAuthenticated ?? false,
    authState: authState ?? "anonymous",
    clientId: user?.clientId ?? 'demo',
    clientName: user?.clientName ?? 'Demo',
    // Brand-only label for table column headers — see tenantShortName().
    clientShortName: tenantShortName(user?.clientName),
    isAdmin: user?.isAdmin ?? false,
  };
}
