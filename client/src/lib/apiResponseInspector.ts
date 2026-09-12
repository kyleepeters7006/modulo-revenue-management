/**
 * One place that sees every API response.
 *
 * A session that stopped revalidating is answered with 401 +
 * `code: "session_expired"` instead of demo-tenant data, but that signal only
 * helps if someone reads it. Most requests go through `apiRequest` / the shared
 * query function, which do — yet dozens of components call `fetch('/api/...')`
 * directly, several pages never mount the nav (so nothing there consults
 * `/api/auth/user`), and the dashboard prefetcher wraps its calls in
 * `Promise.allSettled`, which discards failures outright. On those routes the
 * user would get a page full of broken panels and no explanation.
 *
 * Wrapping `fetch` itself catches all of them, including code written later,
 * without asking every caller to remember. The wrapper only looks at 401
 * responses from this app's own `/api` routes, reads a clone so the caller's
 * body stays untouched, and otherwise returns the original response unchanged —
 * it never converts a failure into a success or vice versa.
 */

import { isSessionExpiredPayload, markSessionExpired } from "./sessionExpiry";

type FetchFn = typeof fetch;
type FetchScope = { fetch: FetchFn; location?: { origin?: string } };

const INSTALLED = Symbol.for("modulo.apiResponseInspector");

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return (input as Request)?.url ?? "";
}

/**
 * True for this app's own API routes. A relative `/api/...` path qualifies; an
 * absolute URL only when it points back at this origin, so a 401 from a
 * third-party API can never be mistaken for our session ending.
 */
export function isOwnApiUrl(url: string, origin?: string): boolean {
  if (!url) return false;
  if (url.startsWith("/api/") || url === "/api") return true;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return false;
  try {
    const parsed = new URL(url);
    if (origin && parsed.origin !== origin) return false;
    if (!origin) return false;
    return parsed.pathname === "/api" || parsed.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

/**
 * Wraps `scope.fetch` so every API 401 is inspected once. Returns a function
 * that restores the original, and is a no-op if already installed.
 */
export function installApiResponseInspector(
  scope: FetchScope = globalThis as unknown as FetchScope,
): () => void {
  const original = scope?.fetch;
  if (typeof original !== "function") return () => {};
  if ((original as unknown as Record<symbol, unknown>)[INSTALLED]) return () => {};

  const patched: FetchFn = async (input, init) => {
    const res = await original(input, init);
    if (res.status === 401 && isOwnApiUrl(requestUrl(input), scope.location?.origin)) {
      try {
        // A clone leaves the caller's body unread; without it the caller would
        // find an already-consumed stream.
        const body = await res.clone().text();
        if (isSessionExpiredPayload(res.status, body)) {
          markSessionExpired();
        }
      } catch {
        // An unreadable body is not worth failing the caller's request over.
      }
    }
    return res;
  };
  (patched as unknown as Record<symbol, unknown>)[INSTALLED] = true;

  scope.fetch = patched;
  return () => { scope.fetch = original; };
}
