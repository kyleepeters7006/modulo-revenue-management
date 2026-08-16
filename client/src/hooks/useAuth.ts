import { useQuery } from "@tanstack/react-query";
import { tenantShortName } from "@/lib/tenant";

export interface AuthUser {
  isAuthenticated: boolean;
  id?: string;
  username?: string;
  clientId: string;
  clientName: string;
  isAdmin?: boolean;
}

export function useAuth() {
  const { data: user, isLoading } = useQuery<AuthUser>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  return {
    user,
    isLoading,
    isAuthenticated: user?.isAuthenticated ?? false,
    clientId: user?.clientId ?? 'demo',
    clientName: user?.clientName ?? 'Demo',
    // Brand-only label for table column headers — see tenantShortName().
    clientShortName: tenantShortName(user?.clientName),
    isAdmin: user?.isAdmin ?? false,
  };
}
