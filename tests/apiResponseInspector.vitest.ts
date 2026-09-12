/**
 * The client-side half of the stale-session contract.
 *
 * The server answers an unrevalidatable session with 401 + `session_expired`,
 * but the user only learns about it if something in the browser notices. Most
 * of the app's requests do not go through the shared query helpers — raw
 * `fetch` calls, pages that never mount the nav, and a dashboard prefetcher
 * that discards failures with `Promise.allSettled` — so the notice is wired to
 * a `fetch` wrapper instead. These assertions pin down that it catches those
 * requests, leaves the caller's response untouched, and does not mistake an
 * unrelated 401 for the session ending.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  installApiResponseInspector,
  isOwnApiUrl,
} from '../client/src/lib/apiResponseInspector';
import {
  clearSessionExpired,
  isSessionExpired,
} from '../client/src/lib/sessionExpiry';

const EXPIRED_BODY = JSON.stringify({
  error: 'Your session has ended. Sign in again to see your data.',
  code: 'session_expired',
  authState: 'session_expired',
});

function scopeReturning(response: () => Response, origin = 'https://app.example') {
  const calls: string[] = [];
  const scope = {
    fetch: (async (input: any) => { calls.push(String(input)); return response(); }) as typeof fetch,
    location: { origin },
  };
  return { scope, calls };
}

afterEach(() => {
  clearSessionExpired();
});

describe('api response inspector', () => {
  it('raises the signal for a raw fetch that never touches the query helpers', async () => {
    const { scope } = scopeReturning(() => new Response(EXPIRED_BODY, { status: 401 }));
    const restore = installApiResponseInspector(scope);

    await scope.fetch('/api/overview');

    expect(isSessionExpired()).toBe(true);
    restore();
  });

  it('leaves the response body readable by the caller', async () => {
    const { scope } = scopeReturning(() => new Response(EXPIRED_BODY, { status: 401 }));
    const restore = installApiResponseInspector(scope);

    const res = await scope.fetch('/api/overview');
    // The caller must still be able to read its own body; the inspector reads a
    // clone precisely so this does not throw on a consumed stream.
    await expect(res.text()).resolves.toContain('session_expired');
    expect(res.status).toBe(401);
    restore();
  });

  it('passes a successful response through unchanged', async () => {
    const { scope } = scopeReturning(() => new Response('{"rows":[]}', { status: 200 }));
    const restore = installApiResponseInspector(scope);

    const res = await scope.fetch('/api/reference-data');

    expect(res.status).toBe(200);
    expect(isSessionExpired()).toBe(false);
    restore();
  });

  it('ignores a 401 that is not the session expiring', async () => {
    // An endpoint that requires sign-in for a visitor who never had a session
    // is a different situation and must not claim the session "ended".
    const { scope } = scopeReturning(
      () => new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401 }),
    );
    const restore = installApiResponseInspector(scope);

    await scope.fetch('/api/admin/users');

    expect(isSessionExpired()).toBe(false);
    restore();
  });

  it('survives an unreadable body without failing the caller', async () => {
    const { scope } = scopeReturning(() => new Response('<html>gateway</html>', { status: 401 }));
    const restore = installApiResponseInspector(scope);

    const res = await scope.fetch('/api/overview');

    expect(res.status).toBe(401);
    expect(isSessionExpired()).toBe(false);
    restore();
  });

  it('restores the original fetch and installs only once', async () => {
    const { scope } = scopeReturning(() => new Response(EXPIRED_BODY, { status: 401 }));
    const original = scope.fetch;

    const restore = installApiResponseInspector(scope);
    const patched = scope.fetch;
    const secondRestore = installApiResponseInspector(scope);

    expect(scope.fetch).toBe(patched);
    secondRestore();
    restore();
    expect(scope.fetch).toBe(original);
  });
});

describe('which URLs count as our own API', () => {
  const origin = 'https://app.example';

  it('accepts a relative API path', () => {
    expect(isOwnApiUrl('/api/overview', origin)).toBe(true);
  });

  it('accepts an absolute URL on this origin', () => {
    expect(isOwnApiUrl(`${origin}/api/overview?x=1`, origin)).toBe(true);
  });

  it('rejects a third-party 401 so it cannot be read as our session ending', () => {
    expect(isOwnApiUrl('https://maps.example/api/tiles', origin)).toBe(false);
  });

  it('rejects non-API paths on this origin', () => {
    expect(isOwnApiUrl('/assets/logo.svg', origin)).toBe(false);
    expect(isOwnApiUrl(`${origin}/login`, origin)).toBe(false);
  });

  it('does not treat a lookalike prefix as the API', () => {
    expect(isOwnApiUrl('/apikeys', origin)).toBe(false);
  });
});
