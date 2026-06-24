import 'server-only';
import { serverEnv, publicEnv } from './env';

/**
 * OpenRouter chat-completions wrapper (server-only). Generates the personalized
 * draft for Gate 1. Grounded on the lead's role/company + recent posts and the
 * sender's value-prop. Enforces the hard character cap before returning.
 */

const MESSAGE_HARD_CAP = 900; // spec §0: hard cap
const MESSAGE_TARGET_MAX = 600; // spec §8: target ceiling

export interface GroundingContext {
  firstName?: string | null;
  lastName?: string | null;
  currentTitle?: string | null;
  currentCompany?: string | null;
  industry?: string | null;
  recentPosts?: string[]; // already-trimmed snippets, 1–3
  companyAbout?: string | null;
  senderValueProp: string;
  senderGoal: string;
}

const SYSTEM_PROMPT =
  'Write a short, warm, specific LinkedIn message to a 1st-degree connection. ' +
  'Reference one concrete detail from their recent activity or role. No clichés, ' +
  'no hard pitch. Keep it under 600 characters, plain text. Output only the message body.';

export interface GenerateResult {
  body: string;
  model: string;
}

export async function generateMessage(
  ctx: GroundingContext,
  modelOverride?: string | null
): Promise<GenerateResult> {
  const model = modelOverride?.trim() || serverEnv.openRouterModel();

  const userPayload = {
    recipient: {
      firstName: ctx.firstName ?? null,
      currentTitle: ctx.currentTitle ?? null,
      currentCompany: ctx.currentCompany ?? null,
      industry: ctx.industry ?? null,
      recentPosts: (ctx.recentPosts ?? []).slice(0, 3),
      companyAbout: ctx.companyAbout ?? null,
    },
    sender: { valueProp: ctx.senderValueProp, goal: ctx.senderGoal },
    constraints: { maxChars: MESSAGE_TARGET_MAX, tone: 'warm, specific, no hard pitch' },
  };

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serverEnv.openRouterApiKey()}`,
      'content-type': 'application/json',
      // Optional attribution headers recommended by OpenRouter.
      'HTTP-Referer': publicEnv.appBaseUrl(),
      'X-Title': 'LinkedIn Outreach',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
      temperature: 0.7,
      max_tokens: 400,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  let body = json.choices?.[0]?.message?.content?.trim() ?? '';
  if (!body) throw new Error('OpenRouter returned an empty message');

  // Enforce the hard cap server-side before persisting (spec §8).
  if (body.length > MESSAGE_HARD_CAP) body = body.slice(0, MESSAGE_HARD_CAP).trim();

  return { body, model };
}

export { MESSAGE_HARD_CAP, MESSAGE_TARGET_MAX };
