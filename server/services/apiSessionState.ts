/**
 * API session state classification.
 *
 * Every `/api` request is answered for some tenant. The default is the demo
 * tenant, which is correct for a genuinely anonymous visitor and catastrophic
 * for anyone else: a session that can no longer be revalidated (revoked row,
 * deactivated account) used to fall back to demo and return HTTP 200 with
 * perfectly well-formed demo data. The client could not tell that apart from
 * "your tenant has nothing saved", so real work came back as empty states and
 * zero counts while the user still looked signed in.
 *
 * The four states below are mutually exclusive and are what the middleware
 * acts on:
 *
 *   authenticated   — session revalidated; serve the session's tenant.
 *   anonymous       — no session markers at all; serve demo. This is the only
 *                     state in which demo data is an honest answer.
 *   session_expired — the session carried a tenant and no longer revalidates.
 *                     Must be rejected, never silently downgraded to demo.
 *   mfa_pending     — password accepted, second factor not yet supplied. No
 *                     tenant has been granted yet, so demo data is served, but
 *                     the state is named rather than folded into `anonymous`
 *                     so the client can tell a half-finished sign-in from a
 *                     visitor who never started one.
 *
 * Kept free of Express types so the decision is unit-testable on its own.
 */

export type ApiAuthState =
  | "anonymous"
  | "authenticated"
  | "session_expired"
  | "mfa_pending";

/** Machine-readable marker on the 401 body, so the client is not parsing prose. */
export const SESSION_EXPIRED_CODE = "session_expired";

export const SESSION_EXPIRED_MESSAGE =
  "Your session has ended. Sign in again to see your data.";

/**
 * Paths that must keep answering while a session is stale.
 *
 * Rejecting these would lock the user out of the only routes that can clear
 * the condition: the client needs `/auth/user` to discover it is signed out,
 * a CSRF token to post anything, and the login and MFA endpoints to get back
 * in. `/auth/logout` is included so a stale cookie can still be cleaned up.
 */
const SESSION_RECOVERY_PATHS = new Set([
  "/auth/user",
  "/auth/csrf",
  "/auth/login",
  "/auth/forgot-password",
  "/auth/password-reset",
  "/auth/logout",
  "/auth/mfa/setup",
  "/auth/mfa/setup/confirm",
  "/auth/mfa/challenge",
]);

function normalizePath(path: string): string {
  const withoutQuery = String(path || "").split("?")[0];
  const trimmed = withoutQuery.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export function isSessionRecoveryPath(path: string): boolean {
  const normalized = normalizePath(path);
  return SESSION_RECOVERY_PATHS.has(normalized) || normalized.startsWith("/auth/password-reset/");
}

/**
 * How long a session keeps reporting `session_expired` after its tenant
 * markers were stripped.
 *
 * The markers have to go immediately — leaving them would let any code reading
 * `session.clientId` keep serving another tenant's scope. But once they are
 * gone the session is indistinguishable from a brand-new visitor, so the very
 * next request would be answered with demo data and 200, which is the failure
 * this whole module exists to prevent. A page load fires many requests at
 * once; without a sticky marker some would be rejected and the rest would
 * quietly render demo content in the same view.
 *
 * The window is bounded so an abandoned tab does not lock the demo experience
 * out forever: after it lapses the session is anonymous again, and the demo
 * banner (which says so in plain words) is an honest answer once more.
 */
export const STALE_SESSION_NOTICE_WINDOW_MS = 30 * 60_000;

export interface ApiAuthStateInput {
  /** Session carries tenant markers (userId / clientId / authenticatedAt). */
  hasTenantMarkers: boolean;
  /** The tenant markers were confirmed against auth_sessions + users. */
  sessionRevalidated: boolean;
  /** A password-verified sign-in is waiting on its second factor. */
  hasPendingMfa: boolean;
  /** When this session's markers were stripped for failing revalidation. */
  staleMarkedAt?: number | null;
  /** Injectable clock for tests. */
  now?: number;
}

export function classifyApiAuthState({
  hasTenantMarkers,
  sessionRevalidated,
  hasPendingMfa,
  staleMarkedAt = null,
  now = Date.now(),
}: ApiAuthStateInput): ApiAuthState {
  if (hasTenantMarkers) {
    // Tenant markers decide first even when MFA markers are also present: a
    // session claiming a tenant it can no longer prove is expired, and letting
    // a leftover pending-MFA marker skip that check is exactly how the silent
    // demo fallback survived.
    return sessionRevalidated ? "authenticated" : "session_expired";
  }
  // A sign-in already in progress outranks the stale marker it is on its way
  // to clearing; rejecting those requests would fight the recovery.
  if (hasPendingMfa) return "mfa_pending";
  if (staleMarkedAt && now - staleMarkedAt < STALE_SESSION_NOTICE_WINDOW_MS) {
    return "session_expired";
  }
  return "anonymous";
}

/** True once the sticky marker has lapsed and should be dropped. */
export function staleMarkerExpired(staleMarkedAt: number | null | undefined, now = Date.now()): boolean {
  return Boolean(staleMarkedAt) && now - Number(staleMarkedAt) >= STALE_SESSION_NOTICE_WINDOW_MS;
}

/**
 * A stale session gets a 401 everywhere except the routes that let the user
 * recover. Anonymous and pending-MFA requests are served the demo tenant.
 */
export function shouldRejectStaleSession(state: ApiAuthState, path: string): boolean {
  return state === "session_expired" && !isSessionRecoveryPath(path);
}
