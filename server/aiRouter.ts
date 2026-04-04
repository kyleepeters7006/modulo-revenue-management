import OpenAI from 'openai';

const CLAUDE_MODEL = 'claude-opus-4-5';
const GPT_MODEL = 'gpt-5.4';

export const aiClient = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export async function callClaude(
  systemPrompt: string,
  userPrompt: string,
  opts?: { maxTokens?: number; temperature?: number; label?: string }
): Promise<string> {
  const label = opts?.label || 'claude';
  console.log(`[aiRouter:${label}] Calling ${CLAUDE_MODEL} via Replit AI Integrations...`);
  const response = await aiClient.chat.completions.create({
    model: CLAUDE_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: opts?.maxTokens || 1024,
    temperature: opts?.temperature ?? 0.3,
  });
  return response.choices[0].message.content || '';
}

export async function callGPT(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  opts?: { maxTokens?: number; temperature?: number; jsonMode?: boolean; label?: string }
): Promise<string> {
  const label = opts?.label || 'gpt';
  console.log(`[aiRouter:${label}] Calling ${GPT_MODEL} via Replit AI Integrations...`);
  const response = await aiClient.chat.completions.create({
    model: GPT_MODEL,
    messages,
    max_tokens: opts?.maxTokens || 800,
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

  console.log(`[aiRouter:${label}] Claude reasoning complete, formatting with ${GPT_MODEL}...`);

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
