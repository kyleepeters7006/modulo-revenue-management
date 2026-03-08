import { useQuery } from "@tanstack/react-query";

export interface AuthUser {
  isAuthenticated: boolean;
  id?: string;
  username?: string;
  clientId: string;
  clientName: string;
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
  };
}
