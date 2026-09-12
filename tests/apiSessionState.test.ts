/**
 * API session state classification — the branch that decides whether a request
 * is answered for the caller's tenant, for the demo tenant, or not at all.
 *
 * The bug being guarded: a session that could no longer be revalidated fell
 * through to the demo tenant and returned HTTP 200. Real work came back as a
 * well-formed "nothing here", so every page rendered empty states while the
 * user still looked signed in. Demo data is only an honest answer for someone
 * who never had a tenant, and these assertions pin that distinction down —
 * including the two ways it can quietly come back: a pending-MFA marker
 * skipping revalidation, and the sticky marker lapsing mid page-load.
 *
 * Run: npx tsx tests/apiSessionState.test.ts
 */

import {
  classifyApiAuthState,
  isSessionRecoveryPath,
  shouldRejectStaleSession,
  staleMarkerExpired,
  STALE_SESSION_NOTICE_WINDOW_MS,
} from '../server/services/apiSessionState';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`✓ ${label}`); }
  else { failed++; console.log(`✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function eq(label: string, actual: unknown, expected: unknown) {
  ok(label, actual === expected, `expected ${String(expected)}, got ${String(actual)}`);
}

const NOW = 1_700_000_000_000;

// ── A visitor who never signed in ───────────────────────────────────────────
eq('no markers at all → anonymous',
  classifyApiAuthState({ hasTenantMarkers: false, sessionRevalidated: false, hasPendingMfa: false, now: NOW }),
  'anonymous');

// ── A live session ──────────────────────────────────────────────────────────
eq('revalidated tenant markers → authenticated',
  classifyApiAuthState({ hasTenantMarkers: true, sessionRevalidated: true, hasPendingMfa: false, now: NOW }),
  'authenticated');

eq('a live session outranks a leftover stale marker',
  classifyApiAuthState({
    hasTenantMarkers: true, sessionRevalidated: true, hasPendingMfa: false,
    staleMarkedAt: NOW - 1_000, now: NOW,
  }),
  'authenticated');

// ── The reported failure ────────────────────────────────────────────────────
eq('tenant markers that no longer revalidate → session_expired, never demo',
  classifyApiAuthState({ hasTenantMarkers: true, sessionRevalidated: false, hasPendingMfa: false, now: NOW }),
  'session_expired');

eq('a pending-MFA marker cannot excuse unrevalidated tenant markers',
  classifyApiAuthState({ hasTenantMarkers: true, sessionRevalidated: false, hasPendingMfa: true, now: NOW }),
  'session_expired');

// ── Half-finished sign-in ───────────────────────────────────────────────────
eq('password verified, second factor outstanding → mfa_pending',
  classifyApiAuthState({ hasTenantMarkers: false, sessionRevalidated: false, hasPendingMfa: true, now: NOW }),
  'mfa_pending');

eq('a sign-in in progress outranks the stale marker it is clearing',
  classifyApiAuthState({
    hasTenantMarkers: false, sessionRevalidated: false, hasPendingMfa: true,
    staleMarkedAt: NOW - 1_000, now: NOW,
  }),
  'mfa_pending');

// ── Sticky marker: the rest of the page load must not revert to demo ────────
eq('stripped markers keep reporting session_expired inside the window',
  classifyApiAuthState({
    hasTenantMarkers: false, sessionRevalidated: false, hasPendingMfa: false,
    staleMarkedAt: NOW - (STALE_SESSION_NOTICE_WINDOW_MS - 1_000), now: NOW,
  }),
  'session_expired');

eq('once the window lapses the session is an ordinary anonymous visitor',
  classifyApiAuthState({
    hasTenantMarkers: false, sessionRevalidated: false, hasPendingMfa: false,
    staleMarkedAt: NOW - (STALE_SESSION_NOTICE_WINDOW_MS + 1), now: NOW,
  }),
  'anonymous');

eq('marker inside the window is not treated as expired', staleMarkerExpired(NOW - 1_000, NOW), false);
eq('marker past the window is expired', staleMarkerExpired(NOW - STALE_SESSION_NOTICE_WINDOW_MS, NOW), true);
eq('absent marker is never expired', staleMarkerExpired(null, NOW), false);

// ── Recovery routes stay reachable, or the user cannot get back in ──────────
for (const path of [
  '/auth/user', '/auth/csrf', '/auth/login', '/auth/logout',
  '/auth/mfa/setup', '/auth/mfa/setup/confirm', '/auth/mfa/challenge',
]) {
  eq(`recovery path answers while stale: ${path}`, shouldRejectStaleSession('session_expired', path), false);
}
eq('trailing slash does not defeat the recovery list', isSessionRecoveryPath('/auth/login/'), true);
eq('a query string does not defeat the recovery list', isSessionRecoveryPath('/auth/user?x=1'), true);
eq('an unrelated auth-prefixed path is not a recovery path', isSessionRecoveryPath('/auth/sessions'), false);

eq('a data read on a stale session is rejected', shouldRejectStaleSession('session_expired', '/ai/insights'), true);
eq('an export on a stale session is rejected', shouldRejectStaleSession('session_expired', '/export/rate-card'), true);

// ── Every other state is served, not rejected ───────────────────────────────
eq('anonymous reads are served', shouldRejectStaleSession('anonymous', '/ai/insights'), false);
eq('authenticated reads are served', shouldRejectStaleSession('authenticated', '/ai/insights'), false);
eq('pending-MFA reads are served (demo scope, named state)',
  shouldRejectStaleSession('mfa_pending', '/ai/insights'), false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
