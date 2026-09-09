import { QueryClient, QueryFunction } from "@tanstack/react-query";

export const MFA_STEP_UP_REQUIRED_EVENT = "modulo:mfa-step-up-required";
let stepUpPromise: Promise<void> | null = null;
let resolveStepUp: (() => void) | null = null;

export function waitForMfaStepUp(): Promise<void> {
  if (stepUpPromise) return stepUpPromise;
  stepUpPromise = new Promise<void>((resolve) => {
    resolveStepUp = resolve;
    window.dispatchEvent(new Event(MFA_STEP_UP_REQUIRED_EVENT));
  });
  return stepUpPromise;
}

export function completeMfaStepUp(): void {
  resolveStepUp?.();
  resolveStepUp = null;
  stepUpPromise = null;
}

export function installMfaFetchGuard(): () => void {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const firstInput = input instanceof Request ? input.clone() : input;
    const response = await originalFetch(firstInput, init);
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    if (response.status !== 428 || path.includes("/api/auth/mfa/step-up")) return response;
    await waitForMfaStepUp();
    const retryInput = input instanceof Request ? input.clone() : input;
    return originalFetch(retryInput, init);
  };
  return () => {
    window.fetch = originalFetch;
  };
}

async function throwIfResNotOk(res: Response) {
  if (res.status === 428 && typeof window !== "undefined") {
    void waitForMfaStepUp();
  }
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  url: string,
  method: string,
  data?: unknown | undefined,
  // Long-running requests (AI runs) need to be cancellable and time-bounded,
  // or a hung socket leaves the caller on a spinner with no way out.
  opts?: { signal?: AbortSignal },
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
    signal: opts?.signal,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
