/**
 * The primary→fallback policy in server/aiRouter.ts, exercised without a live model.
 *
 * This drives the real exported `runWithFallback` — the same function
 * callClaudeDetailed delegates to — with fake provider attempts and a fake
 * clock. A test that reimplemented the deadline arithmetic would guard nothing.
 *
 * The behaviours under test all have the same failure mode in production: they
 * are invisible. A doubled timeout, a fallback fired after a cancellation, or a
 * silently substituted model all look like "the AI is slow today" from the
 * outside.
 *
 * Run: npx tsx tests/aiRouterFallback.test.ts
 */

import { runWithFallback, AiTimeoutError, isAbortError, type AiAttempt } from '../server/aiRouter';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`✓ ${label}`); }
  else { failed++; console.log(`✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}

/** A clock the test moves by hand, so budget behaviour is exact, not timing-dependent. */
function fakeClock(startMs = 1_000_000) {
  let t = startMs;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

const PRIMARY = 'claude-opus-4-6';
const FALLBACK = 'gpt-5.4';

/** A provider that succeeds after consuming `costMs` of the shared budget. */
function succeedsAfter(clock: ReturnType<typeof fakeClock>, costMs: number, text: string) {
  const seen: Array<number | undefined> = [];
  const attempt: AiAttempt = async (timeoutMs) => {
    seen.push(timeoutMs);
    clock.advance(costMs);
    return text;
  };
  return { attempt, seen };
}

/** A provider that burns `costMs` and then fails the way the SDK reports a timeout. */
function timesOutAfter(clock: ReturnType<typeof fakeClock>, costMs: number) {
  const seen: Array<number | undefined> = [];
  const attempt: AiAttempt = async (timeoutMs) => {
    seen.push(timeoutMs);
    clock.advance(costMs);
    const err: any = new Error('Request timed out.');
    err.name = 'APIConnectionTimeoutError';
    throw err;
  };
  return { attempt, seen };
}

function neverCalled(label: string) {
  let calls = 0;
  const attempt: AiAttempt = async () => { calls++; return `${label} should not have run`; };
  return { attempt, calls: () => calls };
}

async function expectThrow(fn: () => Promise<unknown>): Promise<any> {
  try { await fn(); return null; } catch (e) { return e; }
}

async function main() {
  console.log('\n=== The happy path reports who answered ===\n');
  {
    const clock = fakeClock();
    const primary = succeedsAfter(clock, 40_000, '{"rules":[]}');
    const fallback = neverCalled('fallback');
    const r = await runWithFallback({
      label: 'test', primaryModel: PRIMARY, fallbackModel: FALLBACK,
      budgetMs: 180_000, primary: primary.attempt, fallback: fallback.attempt, now: clock.now,
    });
    ok('the primary model answers', r.text === '{"rules":[]}');
    ok('and is named in the result', r.model === PRIMARY, r.model);
    ok('no fallback is recorded', r.usedFallback === false && r.fallbackReason === null);
    ok('the fallback provider is never contacted', fallback.calls() === 0);
    ok('elapsed time is measured', r.elapsedMs === 40_000, String(r.elapsedMs));
    ok('the primary gets the full budget', primary.seen[0] === 180_000, String(primary.seen[0]));
  }

  console.log('\n=== A fallback is disclosed, never silent ===\n');
  {
    const clock = fakeClock();
    const primary = timesOutAfter(clock, 30_000);
    const fallback = succeedsAfter(clock, 20_000, 'from gpt');
    const r = await runWithFallback({
      label: 'test', primaryModel: PRIMARY, fallbackModel: FALLBACK,
      budgetMs: 180_000, primary: primary.attempt, fallback: fallback.attempt, now: clock.now,
    });
    ok('the fallback answer is returned', r.text === 'from gpt');
    ok('the result names the model that ACTUALLY answered', r.model === FALLBACK, r.model);
    ok('the substitution is flagged', r.usedFallback === true);
    ok('and the reason is carried, not swallowed', r.fallbackReason === 'timed out', String(r.fallbackReason));
  }
  {
    // A missing primary client is a configuration state, not a provider fault.
    const clock = fakeClock();
    const fallback = succeedsAfter(clock, 10_000, 'from gpt');
    const r = await runWithFallback({
      label: 'test', primaryModel: PRIMARY, fallbackModel: FALLBACK,
      budgetMs: 180_000, primary: null, fallback: fallback.attempt, now: clock.now,
    });
    ok('an unconfigured primary still routes to the fallback', r.model === FALLBACK && r.usedFallback);
    ok('...and says so plainly', /credentials/i.test(r.fallbackReason ?? ''), String(r.fallbackReason));
  }

  console.log('\n=== The budget covers BOTH attempts, not each one ===\n');
  {
    // The bug this prevents: a per-attempt timeout means a hung primary and a
    // hung fallback each get the full budget, and the caller waits twice as
    // long as it agreed to.
    const clock = fakeClock();
    const primary = timesOutAfter(clock, 100_000);
    const fallback = succeedsAfter(clock, 10_000, 'late but fine');
    const r = await runWithFallback({
      label: 'test', primaryModel: PRIMARY, fallbackModel: FALLBACK,
      budgetMs: 180_000, primary: primary.attempt, fallback: fallback.attempt, now: clock.now,
    });
    ok('the fallback is given only what the primary left', fallback.seen[0] === 80_000, String(fallback.seen[0]));
    ok('the whole call stays inside the budget', r.elapsedMs <= 180_000, String(r.elapsedMs));
  }
  {
    // Primary consumed everything: a fallback started here can only time out
    // again, so refuse rather than doubling the operator's wait.
    const clock = fakeClock();
    const primary = timesOutAfter(clock, 180_000);
    const fallback = neverCalled('fallback');
    const err = await expectThrow(() => runWithFallback({
      label: 'test', primaryModel: PRIMARY, fallbackModel: FALLBACK,
      budgetMs: 180_000, primary: primary.attempt, fallback: fallback.attempt, now: clock.now,
    }));
    ok('an exhausted budget throws AiTimeoutError', err instanceof AiTimeoutError, String(err?.name));
    ok('...and does NOT start a doomed fallback', fallback.calls() === 0);
    ok('the message says how long we waited', /180s/.test(err?.message ?? ''), err?.message);
    ok('the message names the model that consumed it', (err?.message ?? '').includes(PRIMARY), err?.message);
    ok('the budget is attached for the caller', err?.budgetMs === 180_000, String(err?.budgetMs));
  }
  {
    // Just under the minimum useful slice — still refused.
    const clock = fakeClock();
    const primary = timesOutAfter(clock, 165_000);
    const fallback = neverCalled('fallback');
    const err = await expectThrow(() => runWithFallback({
      label: 'test', primaryModel: PRIMARY, fallbackModel: FALLBACK,
      budgetMs: 180_000, primary: primary.attempt, fallback: fallback.attempt, now: clock.now,
    }));
    ok('a sliver of remaining budget is not enough to retry', err instanceof AiTimeoutError);
    ok('...so no second call is made', fallback.calls() === 0);
  }
  {
    // Comfortably above the minimum — the fallback is worth attempting.
    const clock = fakeClock();
    const primary = timesOutAfter(clock, 150_000);
    const fallback = succeedsAfter(clock, 5_000, 'squeaked in');
    const r = await runWithFallback({
      label: 'test', primaryModel: PRIMARY, fallbackModel: FALLBACK,
      budgetMs: 180_000, primary: primary.attempt, fallback: fallback.attempt, now: clock.now,
    });
    ok('a usable remainder still gets a fallback attempt', r.text === 'squeaked in');
    ok('and it is told how little time it has', fallback.seen[0] === 30_000, String(fallback.seen[0]));
  }
  {
    // Both failed on time: report a timeout, not a raw provider error.
    const clock = fakeClock();
    const primary = timesOutAfter(clock, 60_000);
    const fallback = timesOutAfter(clock, 120_000);
    const err = await expectThrow(() => runWithFallback({
      label: 'test', primaryModel: PRIMARY, fallbackModel: FALLBACK,
      budgetMs: 180_000, primary: primary.attempt, fallback: fallback.attempt, now: clock.now,
    }));
    ok('two timeouts surface as one timeout', err instanceof AiTimeoutError);
    ok('...naming both models', (err?.message ?? '').includes(PRIMARY) && (err?.message ?? '').includes(FALLBACK), err?.message);
  }
  {
    // No budget given: nothing is bounded, and no timeout is invented.
    const clock = fakeClock();
    const primary = timesOutAfter(clock, 600_000);
    const fallback = succeedsAfter(clock, 10_000, 'unbounded');
    const r = await runWithFallback({
      label: 'test', primaryModel: PRIMARY, fallbackModel: FALLBACK,
      primary: primary.attempt, fallback: fallback.attempt, now: clock.now,
    });
    ok('without a budget the fallback always runs', r.text === 'unbounded');
    ok('and no timeout is passed down', primary.seen[0] === undefined && fallback.seen[0] === undefined);
  }

  console.log('\n=== Cancelling stops work; it does not redirect it ===\n');
  {
    // The whole point of cancel is to stop spending. Falling back after an
    // abort would spend a second call on a run nobody is waiting for.
    const clock = fakeClock();
    const controller = new AbortController();
    const fallback = neverCalled('fallback');
    const primary: AiAttempt = async () => {
      controller.abort();
      const err: any = new Error('Request was aborted.');
      err.name = 'APIUserAbortError';
      throw err;
    };
    const err = await expectThrow(() => runWithFallback({
      label: 'test', primaryModel: PRIMARY, fallbackModel: FALLBACK,
      budgetMs: 180_000, signal: controller.signal,
      primary, fallback: fallback.attempt, now: clock.now,
    }));
    ok('an abort propagates to the caller', err?.name === 'APIUserAbortError', String(err?.name));
    ok('it is NOT reclassified as a timeout', !(err instanceof AiTimeoutError));
    ok('and it never triggers a fallback call', fallback.calls() === 0);
  }
  {
    // Aborting during the fallback must behave the same way.
    const clock = fakeClock();
    const controller = new AbortController();
    const primary = timesOutAfter(clock, 10_000);
    const fallback: AiAttempt = async () => {
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    };
    const err = await expectThrow(() => runWithFallback({
      label: 'test', primaryModel: PRIMARY, fallbackModel: FALLBACK,
      budgetMs: 180_000, signal: controller.signal,
      primary: primary.attempt, fallback, now: clock.now,
    }));
    ok('an abort in the fallback also propagates', err?.name === 'AbortError', String(err?.name));
    ok('...and is not dressed up as a timeout', !(err instanceof AiTimeoutError));
  }
  {
    // A signal already aborted before the call means every rejection is an abort.
    const controller = new AbortController();
    controller.abort();
    ok('a pre-aborted signal makes any error an abort', isAbortError(new Error('anything'), controller.signal));
    ok('a plain error with no signal is not an abort', !isAbortError(new Error('boom')));
    ok('AbortError is recognised without a signal', isAbortError({ name: 'AbortError' }));
    ok('the SDK user-abort name is recognised too', isAbortError({ name: 'APIUserAbortError' }));
  }

  console.log('\n=== A genuine provider error stays a provider error ===\n');
  {
    // A 500 from both providers is not a timeout — telling the operator to
    // narrow their scope would send them chasing the wrong problem.
    const clock = fakeClock();
    const boom: AiAttempt = async () => { const e: any = new Error('upstream exploded'); e.status = 500; throw e; };
    const err = await expectThrow(() => runWithFallback({
      label: 'test', primaryModel: PRIMARY, fallbackModel: FALLBACK,
      budgetMs: 180_000, primary: boom, fallback: boom, now: clock.now,
    }));
    ok('a fast double failure is not called a timeout', !(err instanceof AiTimeoutError), String(err?.name));
    ok('the provider error reaches the caller intact', /upstream exploded/.test(err?.message ?? ''), err?.message);
  }
  {
    // The reason string is what the operator eventually reads; it must describe
    // the failure rather than dumping an object.
    const clock = fakeClock();
    const http429: AiAttempt = async () => { const e: any = new Error('rate limited'); e.status = 429; e.error = { type: 'rate_limit_error' }; throw e; };
    const fallback = succeedsAfter(clock, 5_000, 'ok');
    const r = await runWithFallback({
      label: 'test', primaryModel: PRIMARY, fallbackModel: FALLBACK,
      budgetMs: 180_000, primary: http429, fallback: fallback.attempt, now: clock.now,
    });
    ok('an HTTP failure is described by status', r.fallbackReason === 'HTTP 429 (rate_limit_error)', String(r.fallbackReason));
    ok('the reason is never "[object Object]"', !/\[object/.test(r.fallbackReason ?? ''));
  }
  {
    const clock = fakeClock();
    const long = 'x'.repeat(500);
    const verbose: AiAttempt = async () => { throw new Error(long); };
    const fallback = succeedsAfter(clock, 5_000, 'ok');
    const r = await runWithFallback({
      label: 'test', primaryModel: PRIMARY, fallbackModel: FALLBACK,
      budgetMs: 180_000, primary: verbose, fallback: fallback.attempt, now: clock.now,
    });
    ok('a runaway error message is truncated', (r.fallbackReason ?? '').length <= 160, String((r.fallbackReason ?? '').length));
  }

  console.log('\n=== The deadline is enforced, not merely requested ===\n');
  {
    // The timeout handed to an SDK is a request the SDK may ignore or overrun
    // (internal retries are the usual culprit). If the budget were only that
    // hint, an attempt that never settles would hold the route open forever —
    // exactly the stuck spinner this work exists to remove. Real timers here.
    const started = Date.now();
    const stuck: AiAttempt = () => new Promise<string>(() => {}); // never settles
    const fallback = neverCalled('fallback');
    const err = await expectThrow(() => runWithFallback({
      label: 'test', primaryModel: PRIMARY, fallbackModel: FALLBACK,
      budgetMs: 300, primary: stuck, fallback: fallback.attempt,
    }));
    const waited = Date.now() - started;
    ok('an attempt that never settles still ends the call', err instanceof AiTimeoutError, String(err?.name));
    ok('...promptly, at roughly the budget', waited >= 250 && waited < 3000, `${waited}ms`);
    ok('...without burning a fallback call on the way out', fallback.calls() === 0);
  }
  {
    // The same guarantee has to hold on the second attempt.
    const started = Date.now();
    const failFast: AiAttempt = async () => { throw new Error('primary down'); };
    const stuck: AiAttempt = () => new Promise<string>(() => {});
    const err = await expectThrow(() => runWithFallback({
      label: 'test', primaryModel: PRIMARY, fallbackModel: FALLBACK,
      // The remainder must clear the "worth attempting" bar, or the gate — not
      // the deadline — is what ends the call, and this asserts nothing.
      budgetMs: 300, minFallbackBudgetMs: 50, primary: failFast, fallback: stuck,
    }));
    const waited = Date.now() - started;
    ok('a hung fallback is bounded too', err instanceof AiTimeoutError, String(err?.name));
    ok('...within the same shared budget', waited >= 250 && waited < 3000, `${waited}ms`);
  }
  {
    // The deadline must also reach the provider, so a hung call is actually
    // stopped rather than merely abandoned while it keeps spending.
    let sawAbort = false;
    const stuck: AiAttempt = (_t, signal) => new Promise<string>((_res, rej) => {
      signal?.addEventListener('abort', () => { sawAbort = true; rej(new Error('aborted by deadline')); });
    });
    await expectThrow(() => runWithFallback({
      label: 'test', primaryModel: PRIMARY, fallbackModel: FALLBACK,
      budgetMs: 300, primary: stuck, fallback: async () => 'never',
    }));
    ok('the expiring budget aborts the in-flight attempt', sawAbort);
  }
  {
    // A deadline-driven abort is a timeout, not an operator cancellation — the
    // two need different words in front of the user, so they must not merge.
    const controller = new AbortController();
    const stuck: AiAttempt = () => new Promise<string>(() => {});
    const err = await expectThrow(() => runWithFallback({
      label: 'test', primaryModel: PRIMARY, fallbackModel: FALLBACK,
      budgetMs: 300, signal: controller.signal, primary: stuck, fallback: async () => 'never',
    }));
    ok('an unaborted caller signal keeps it classified as a timeout', err instanceof AiTimeoutError, String(err?.name));
  }
  {
    // A caller abort during a hung attempt still reads as a cancellation.
    const controller = new AbortController();
    const stuck: AiAttempt = (_t, signal) => new Promise<string>((_res, rej) => {
      signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    });
    setTimeout(() => controller.abort(), 50);
    const err = await expectThrow(() => runWithFallback({
      label: 'test', primaryModel: PRIMARY, fallbackModel: FALLBACK,
      budgetMs: 10_000, signal: controller.signal, primary: stuck, fallback: async () => 'never',
    }));
    ok('a caller abort outranks the budget', err?.name === 'AbortError', String(err?.name));
    ok('...and is not reported as a timeout', !(err instanceof AiTimeoutError));
  }
  {
    // Regression: our own deadline aborts the attempt signal, and SDK clients
    // report that as APIUserAbortError — the same name the operator's Cancel
    // produces. Classified by name alone it reads as a cancellation, the route
    // treats it as a client disconnect, and it answers with silence instead of
    // the promised 504. Only the CALLER's signal may mean "cancelled".
    const abortOnDeadline: AiAttempt = (_t, signal) => new Promise<string>((_res, rej) => {
      signal?.addEventListener('abort', () => {
        const err: any = new Error('Request was aborted.');
        err.name = 'APIUserAbortError';
        rej(err);
      });
    });
    const err = await expectThrow(() => runWithFallback({
      label: 'test', primaryModel: PRIMARY, fallbackModel: FALLBACK,
      budgetMs: 200, primary: abortOnDeadline, fallback: async () => 'never',
    }));
    ok('a deadline-driven APIUserAbortError becomes a timeout', err instanceof AiTimeoutError, String(err?.name));
    ok('...not a cancellation', err?.name !== 'APIUserAbortError');
  }
  {
    // Same trap on the fallback attempt, and with the other abort name.
    const failFast: AiAttempt = async () => { throw new Error('primary down'); };
    const abortOnDeadline: AiAttempt = (_t, signal) => new Promise<string>((_res, rej) => {
      signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    });
    const err = await expectThrow(() => runWithFallback({
      label: 'test', primaryModel: PRIMARY, fallbackModel: FALLBACK,
      budgetMs: 200, minFallbackBudgetMs: 20, primary: failFast, fallback: abortOnDeadline,
    }));
    ok('a deadline-driven AbortError in the fallback is a timeout too', err instanceof AiTimeoutError, String(err?.name));
  }
  {
    // And when the caller DID pass a signal that it never aborted, the
    // distinction must still hold — a live signal is not an aborted one.
    const controller = new AbortController();
    const abortOnDeadline: AiAttempt = (_t, signal) => new Promise<string>((_res, rej) => {
      signal?.addEventListener('abort', () => {
        const err: any = new Error('Request was aborted.');
        err.name = 'APIUserAbortError';
        rej(err);
      });
    });
    const err = await expectThrow(() => runWithFallback({
      label: 'test', primaryModel: PRIMARY, fallbackModel: FALLBACK,
      budgetMs: 200, signal: controller.signal, primary: abortOnDeadline, fallback: async () => 'never',
    }));
    ok('an un-aborted caller signal does not disguise a timeout', err instanceof AiTimeoutError, String(err?.name));
  }
  {
    // No budget means no timer at all — a slow-but-fine call must not be killed.
    const slowButOk: AiAttempt = () => new Promise<string>(res => setTimeout(() => res('worth the wait'), 400));
    const r = await runWithFallback({
      label: 'test', primaryModel: PRIMARY, fallbackModel: FALLBACK,
      primary: slowButOk, fallback: async () => 'never',
    });
    ok('an unbudgeted slow call is left alone', r.text === 'worth the wait');
  }
  {
    // A run that finishes inside the budget must not be disturbed by the timer,
    // and the timer must not keep firing afterwards.
    let unhandled: unknown = null;
    const onUnhandled = (e: unknown) => { unhandled = e; };
    process.on('unhandledRejection', onUnhandled);
    const quick: AiAttempt = () => new Promise<string>(res => setTimeout(() => res('done'), 20));
    const r = await runWithFallback({
      label: 'test', primaryModel: PRIMARY, fallbackModel: FALLBACK,
      budgetMs: 200, primary: quick, fallback: async () => 'never',
    });
    await new Promise(res => setTimeout(res, 350)); // outlive the cleared deadline
    process.off('unhandledRejection', onUnhandled);
    ok('a run inside the budget returns normally', r.text === 'done');
    ok('the deadline timer is cleaned up, with no stray rejection', unhandled === null, String(unhandled));
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
