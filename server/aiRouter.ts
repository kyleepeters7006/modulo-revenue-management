import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

const CLAUDE_MODEL = 'claude-sonnet-4-6';
const GPT_MODEL = 'gpt-5.4';

// Prefer Replit AI Integrations (billed to the Replit account, no personal key
// needed); fall back to a personal ANTHROPIC_API_KEY if one is ever set.
const hasAIIntegrationsAnthropic = !!process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;

export const anthropicClient = hasAIIntegrationsAnthropic
  ? new Anthropic({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
    })
  : hasAnthropicKey
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

export const gptClient = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export const aiClient = gptClient;

/**
 * A call that ran out of its time budget rather than failing on its merits.
 * Distinguished from a provider error because the two need different words in
 * front of the operator: "the model is unreachable" vs "this scope is too big
 * to answer in the time we allow".
 */
export class AiTimeoutError extends Error {
  readonly budgetMs: number;
  constructor(message: string, budgetMs: number) {
    super(message);
    this.name = 'AiTimeoutError';
    this.budgetMs = budgetMs;
  }
}

/**
 * Build the per-request options handed to an SDK client.
 *
 * Both the OpenAI and Anthropic clients validate with `if ('timeout' in options)`
 * — the KEY's presence, not its value. So `{ timeout: undefined }` (what an
 * unbudgeted call produced) fails validation with "timeout must be an integer"
 * before a single byte goes out, and because the router applies the same object
 * to both providers, the primary and its fallback died identically. A float from
 * a computed remaining budget fails the same check.
 *
 * So the key is omitted entirely unless there is a real, positive, integral
 * number of milliseconds to ask for, and is floored rather than rounded so a
 * fractional remainder can never be rounded UP past the shared deadline.
 */
export function sdkRequestOptions(
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
): { timeout?: number; signal?: AbortSignal } {
  const opts: { timeout?: number; signal?: AbortSignal } = {};
  if (signal) opts.signal = signal;
  if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs)) {
    const whole = Math.floor(timeoutMs);
    // A 0ms timeout is not a request the SDK can honour; leaving the key off
    // lets the client's own default apply instead of failing the call outright.
    if (whole > 0) opts.timeout = whole;
  }
  return opts;
}

/** What a call actually did, as opposed to what it was asked to do. */
export interface AiCallResult {
  text: string;
  /** The model that produced `text` — not necessarily the one requested. */
  model: string;
  /** True when the primary model failed and the fallback answered instead. */
  usedFallback: boolean;
  /** Why the primary model was skipped or abandoned, when it was. */
  fallbackReason: string | null;
  elapsedMs: number;
}

/**
 * True when this rejection is the caller giving up (an aborted request), not
 * the provider failing. A cancelled call must never spend a second call's worth
 * of budget and tokens on a fallback nobody is waiting for.
 */
export function isAbortError(err: any, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  const name = err?.name ?? '';
  return name === 'AbortError' || name === 'APIUserAbortError';
}

/** A one-line reason suitable for a log line and an operator-facing note. */
function describeAiError(err: any): string {
  if (err?.name === 'APIConnectionTimeoutError') return 'timed out';
  if (err?.status) return `HTTP ${err.status}${err?.error?.type ? ` (${err.error.type})` : ''}`;
  const msg = String(err?.message ?? err ?? 'unknown error');
  return msg.length > 160 ? `${msg.slice(0, 157)}…` : msg;
}

// Falling back is only worth doing if the fallback has room to finish. Handing
// GPT two seconds produces a second timeout and doubles the wait for nothing.
const MIN_FALLBACK_BUDGET_MS = 20_000;

/**
 * Like `callClaude`, but reports which model actually answered.
 *
 * Anthropic errors fall back to GPT silently, which is the right availability
 * behaviour but leaves the caller unable to say who wrote the output. For
 * pricing suggestions that matters: the operator is approving rules and an
 * engineer diagnosing a bad run needs to know whether Opus was involved at all.
 *
 * `timeoutMs` is a budget for the WHOLE call, not per provider — otherwise a
 * primary that hangs for the full budget is followed by a fallback that hangs
 * for another one, and the caller waits twice as long as it agreed to.
 */
export async function callClaudeDetailed(
  systemPrompt: string,
  userPrompt: string,
  opts?: { maxTokens?: number; temperature?: number; label?: string; model?: string; timeoutMs?: number; signal?: AbortSignal }
): Promise<AiCallResult> {
  const maxTokens = opts?.maxTokens || 1024;
  const temperature = opts?.temperature ?? 0.3;
  const claudeModel = opts?.model || CLAUDE_MODEL;

  return runWithFallback({
    label: opts?.label || 'claude',
    primaryModel: claudeModel,
    fallbackModel: GPT_MODEL,
    budgetMs: opts?.timeoutMs,
    signal: opts?.signal,
    // A missing client is not a failure to report as one — it is a
    // configuration state, and the orchestrator words it differently.
    primary: anthropicClient
      ? async (timeoutMs, signal) => {
          const response = await anthropicClient!.messages.create(
            {
              model: claudeModel,
              max_tokens: maxTokens,
              system: systemPrompt,
              messages: [{ role: 'user', content: userPrompt }],
            },
            sdkRequestOptions(timeoutMs, signal),
          );
          const block = response.content[0];
          return block.type === 'text' ? block.text : '';
        }
      : null,
    fallback: async (timeoutMs, signal) => {
      const response = await gptClient.chat.completions.create(
        {
          model: GPT_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_completion_tokens: maxTokens,
          temperature,
        },
        sdkRequestOptions(timeoutMs, signal),
      );
      return response.choices[0].message.content || '';
    },
  });
}

/** One attempt at one provider, given whatever time is left. */
export type AiAttempt = (timeoutMs: number | undefined, signal: AbortSignal | undefined) => Promise<string>;

/**
 * Primary-then-fallback with a single shared deadline, kept separate from the
 * SDK plumbing so the policy can be exercised without a live model.
 *
 * The rules it enforces, in order of how badly each one bit before:
 *  - The budget spans BOTH attempts. A per-attempt timeout lets a hung primary
 *    and a hung fallback add up to double the wait the caller agreed to.
 *  - An abort is never converted into a fallback. Cancelling must stop work,
 *    not redirect it to a second provider nobody is waiting for.
 *  - Running out of budget is its own error type, because "the model is
 *    unreachable" and "this scope is too big to answer in time" need different
 *    words in front of an operator.
 *  - Which provider answered is always reported, never inferred.
 */
export async function runWithFallback(args: {
  label: string;
  primaryModel: string;
  fallbackModel: string;
  budgetMs?: number;
  signal?: AbortSignal;
  /** null when the primary provider is not configured at all. */
  primary: AiAttempt | null;
  fallback: AiAttempt;
  now?: () => number;
  /** Smallest remainder worth spending on a fallback attempt. Overridable so the policy can be tested without real-time waits. */
  minFallbackBudgetMs?: number;
}): Promise<AiCallResult> {
  const { label, primaryModel, fallbackModel, budgetMs, signal, primary, fallback } = args;
  const now = args.now ?? Date.now;
  const startedAt = now();
  const deadline = budgetMs ? startedAt + budgetMs : null;
  const remaining = () => (deadline === null ? undefined : Math.max(0, deadline - now()));
  const budgetSecs = Math.round((budgetMs ?? 0) / 1000);
  const timedOut = (message: string) => new AiTimeoutError(message, budgetMs ?? 0);

  // The per-attempt timeout handed to an SDK is only a request; a client that
  // retries internally, or ignores the option, can overrun it and leave the
  // caller on the spinner this whole change exists to remove. So the deadline is
  // also enforced here: a timer aborts the attempt AND settles the wait, so an
  // attempt that never returns still cannot hold the route open.
  const attemptAbort = new AbortController();
  /** Only the caller's own signal means the operator cancelled. */
  const callerCancelled = () => !!signal?.aborted;
  const propagateCallerAbort = () => attemptAbort.abort();
  if (signal) {
    if (signal.aborted) attemptAbort.abort();
    else signal.addEventListener('abort', propagateCallerAbort, { once: true });
  }

  let deadlineHit = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let expired: Promise<never> | null = null;
  if (budgetMs) {
    expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        deadlineHit = true;
        attemptAbort.abort();
        reject(timedOut(`No model answered within the ${budgetSecs}s budget.`));
      }, budgetMs);
      // Deliberately NOT unref'd: an unref'd deadline is not a deadline, since
      // an event loop with nothing else pending will exit before it fires. The
      // `finally` below always clears it, so it cannot outlive the call.
    });
    // Between the two attempts nothing is racing this promise; without an inert
    // handler its rejection would surface as an unhandled rejection.
    expired.catch(() => {});
  }
  const withDeadline = <T,>(p: Promise<T>): Promise<T> => (expired ? Promise.race([p, expired]) : p);

  try {
    let fallbackReason: string | null = null;

    if (primary) {
      console.log(`[aiRouter:${label}] Calling ${primaryModel}...`);
      try {
        const text = await withDeadline(primary(remaining(), attemptAbort.signal));
        return { text, model: primaryModel, usedFallback: false, fallbackReason: null, elapsedMs: now() - startedAt };
      } catch (err) {
        // Order matters. Our own deadline aborts the attempt signal, and SDKs
        // report that as APIUserAbortError — indistinguishable by name from the
        // operator pressing Cancel. Only the CALLER's signal can say the
        // operator cancelled; anything abort-shaped after our timer fired is a
        // timeout, and must reach the route as one or it gets mistaken for a
        // client disconnect and answered with silence instead of a 504.
        if (callerCancelled()) throw err;
        if (deadlineHit || err instanceof AiTimeoutError) {
          throw timedOut(`${primaryModel} used the entire ${budgetSecs}s budget with no time left to fall back to ${fallbackModel}.`);
        }
        if (isAbortError(err)) throw err; // aborted by something neither we nor the caller asked for
        fallbackReason = describeAiError(err);
        console.warn(`[aiRouter:${label}] ${primaryModel} failed (${fallbackReason}), falling back to ${fallbackModel}`);
      }
    } else {
      fallbackReason = 'no Anthropic credentials configured';
      console.log(`[aiRouter:${label}] no primary client configured — routing to ${fallbackModel}...`);
    }

    const left = remaining();
    if (left !== undefined && left < (args.minFallbackBudgetMs ?? MIN_FALLBACK_BUDGET_MS)) {
      throw timedOut(
        `${primaryModel} used the entire ${budgetSecs}s budget (${fallbackReason}) with no time left to fall back to ${fallbackModel}.`,
      );
    }

    try {
      const text = await withDeadline(fallback(left, attemptAbort.signal));
      return { text, model: fallbackModel, usedFallback: true, fallbackReason, elapsedMs: now() - startedAt };
    } catch (err: any) {
      // Same precedence as above: only the caller's signal means "cancelled".
      if (callerCancelled()) throw err;
      if (err instanceof AiTimeoutError) throw err;
      if (deadlineHit || err?.name === 'APIConnectionTimeoutError' || (deadline !== null && now() >= deadline)) {
        throw timedOut(`Both ${primaryModel} and ${fallbackModel} failed to answer within ${budgetSecs}s.`);
      }
      throw err;
    }
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', propagateCallerAbort);
  }
}

export async function callClaude(
  systemPrompt: string,
  userPrompt: string,
  opts?: { maxTokens?: number; temperature?: number; label?: string; model?: string; timeoutMs?: number; signal?: AbortSignal }
): Promise<string> {
  return (await callClaudeDetailed(systemPrompt, userPrompt, opts)).text;
}

export async function callGPT(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  opts?: { maxTokens?: number; temperature?: number; jsonMode?: boolean; label?: string }
): Promise<string> {
  const label = opts?.label || 'gpt';
  console.log(`[aiRouter:${label}] Calling ${GPT_MODEL} via Replit AI Integrations...`);
  const response = await gptClient.chat.completions.create({
    model: GPT_MODEL,
    messages,
    max_completion_tokens: opts?.maxTokens || 800,
    temperature: opts?.temperature ?? 0.3,
    ...(opts?.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
  });
  return response.choices[0].message.content || '';
}

export async function callClaudeThenGPT(
  systemPrompt: string,
  userPrompt: string,
  formatInstruction: string,
  opts?: { claudeMaxTokens?: number; gptMaxTokens?: number; label?: string; claudeModel?: string }
): Promise<string> {
  const label = opts?.label || 'claude→gpt';

  const claudeReasoning = await callClaude(systemPrompt, userPrompt, {
    maxTokens: opts?.claudeMaxTokens || 1024,
    label: `${label}:reasoning`,
    model: opts?.claudeModel,
  });

  console.log(`[aiRouter:${label}] Reasoning complete, formatting with ${GPT_MODEL}...`);

  const isJson = formatInstruction.toLowerCase().includes('json');
  return callGPT(
    [{ role: 'user', content: `${formatInstruction}\n\nAnalysis:\n${claudeReasoning}` }],
    {
      maxTokens: opts?.gptMaxTokens || 800,
      jsonMode: isJson,
      label: `${label}:format`,
    }
  );
}
