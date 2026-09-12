/**
 * Session-expiry signal.
 *
 * The API answers a request whose session no longer revalidates with a 401
 * carrying `code: "session_expired"` rather than demo-tenant data dressed up
 * as a successful read. Any request that sees that marker flips this flag, and
 * the app shows a sign-in prompt instead of leaving the user staring at empty
 * panels that look like their data is gone.
 *
 * Kept as a tiny external store rather than React state because the signal
 * originates in the fetch layer, outside any component tree.
 */

import { useSyncExternalStore } from "react";

export const SESSION_EXPIRED_CODE = "session_expired";

let expired = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach(listener => listener());
}

export function isSessionExpired(): boolean {
  return expired;
}

export function markSessionExpired(): void {
  if (expired) return;
  expired = true;
  emit();
}

export function clearSessionExpired(): void {
  if (!expired) return;
  expired = false;
  emit();
}

export function subscribeSessionExpiry(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const subscribe = subscribeSessionExpiry;

export function useSessionExpired(): boolean {
  return useSyncExternalStore(subscribe, isSessionExpired, () => false);
}

/**
 * True when a 401 body identifies a session that stopped revalidating, as
 * opposed to an endpoint that simply requires sign-in for a visitor who never
 * had a session.
 */
export function isSessionExpiredPayload(status: number, body: string): boolean {
  if (status !== 401) return false;
  try {
    return JSON.parse(body)?.code === SESSION_EXPIRED_CODE;
  } catch {
    return false;
  }
}
