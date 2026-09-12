import { QueryClient, QueryFunction } from "@tanstack/react-query";
import {
  isSessionExpired,
  isSessionExpiredPayload,
  markSessionExpired,
  subscribeSessionExpiry,
} from "./sessionExpiry";

/**
 * A failed API response, carrying the status alongside the message.
 *
 * Callers used to re-parse `"401: ..."` out of the message string to tell an
 * auth failure from any other error. The status is kept as a field so that
 * guesswork is unnecessary, while the message keeps its original
 * `"<status>: <body>"` shape for existing consumers.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`${status}: ${body}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Reads a failed response body once and, when the server reports that the
 * session stopped revalidating, raises the app-wide signal.
 *
 * A stale session is answered with a 401 rather than demo-tenant data, so this
 * is where a query or mutation learns that the user is no longer signed in.
 * Requests that bypass this helper are covered by the `fetch` wrapper in
 * `apiResponseInspector`; both funnel into the same signal, which is
 * idempotent.
 */
async function readFailure(res: Response): Promise<string> {
  const body = (await res.text()) || res.statusText;
  if (isSessionExpiredPayload(res.status, body)) {
    markSessionExpired();
  }
  return body;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    throw new ApiError(res.status, await readFailure(res));
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
      // Still inspected: a caller that tolerates 401 must not also swallow the
      // fact that the whole session went stale.
      await readFailure(res);
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

// The cached `/api/auth/user` answer has to be refetched the moment the session
// is known to be gone, or the nav keeps showing the old tenant's brand and a
// Logout button for a session that no longer exists. Wiring it here — rather
// than at each place that raises the signal — means requests that never touch
// this module (raw `fetch` callers caught by the response inspector) get the
// same correction.
subscribeSessionExpiry(() => {
  if (isSessionExpired()) {
    void queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
  }
});
