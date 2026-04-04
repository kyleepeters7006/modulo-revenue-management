import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

const CLAUDE_MODEL = 'claude-opus-4-5';
const GPT_MODEL = 'gpt-5.4';

const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;

export const anthropicClient = hasAnthropicKey
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

export const gptClient = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export const aiClient = gptClient;

export async function callClaude(
  systemPrompt: string,
  userPrompt: string,
  opts?: { maxTokens?: number; temperature?: number; label?: string }
): Promise<string> {
  const label = opts?.label || 'claude';
  const maxTokens = opts?.maxTokens || 1024;
  const temperature = opts?.temperature ?? 0.3;

  if (anthropicClient) {
    console.log(`[aiRouter:${label}] Calling ${CLAUDE_MODEL} via Anthropic SDK...`);
    try {
      const response = await anthropicClient.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      const block = response.content[0];
      return block.type === 'text' ? block.text : '';
    } catch (err) {
      console.warn(`[aiRouter:${label}] Anthropic call failed, falling back to ${GPT_MODEL}:`, err);
    }
  } else {
    console.log(`[aiRouter:${label}] ANTHROPIC_API_KEY absent — routing to ${GPT_MODEL} via Replit AI Integrations...`);
  }

  const response = await gptClient.chat.completions.create({
    model: GPT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: maxTokens,
    temperature,
  });
  return response.choices[0].message.content || '';
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
  opts?: { claudeMaxTokens?: number; gptMaxTokens?: number; label?: string }
): Promise<string> {
  const label = opts?.label || 'claude→gpt';

  const claudeReasoning = await callClaude(systemPrompt, userPrompt, {
    maxTokens: opts?.claudeMaxTokens || 1024,
    label: `${label}:reasoning`,
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
