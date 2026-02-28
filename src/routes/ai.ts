import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';

const YUTORI_KEY = process.env.YUTORI_API_KEY || 'yt_h02YWBeSpGjDpcv5rW8Ko_KnJn1qBaZgxWz0L35wSpk';

const aiRouter = new Hono();

// POST /api/ai/suggest — uses Yutori n1 browser agent to write a listing description
aiRouter.post('/suggest', requireAuth, async (c) => {
  const { provider, creditType, faceValue, askingPrice, title } = await c.req.json();

  const fv = faceValue ? `$${(Number(faceValue) / 100).toFixed(0)}` : 'unknown face value';
  const ap = askingPrice ? `$${(Number(askingPrice) / 100).toFixed(0)}` : 'unknown price';

  const prompt = `Write a 2-3 sentence listing description for selling API credits on a P2P marketplace. Keep it factual and concise — no fluff.

Listing details:
- Title: ${title || `${provider} credits`}
- Provider: ${provider}
- Credit Type: ${creditType}
- Face Value: ${fv}
- Asking Price: ${ap}

Cover: what the credits are for, how transfer works, why the price is fair.`;

  try {
    const res = await fetch('https://api.yutori.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${YUTORI_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'n1-20260203',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) return c.json({ error: 'Yutori unavailable' }, 502);

    const data = await res.json() as any;
    const message = data.choices?.[0]?.message;

    // If it returns direct text content
    if (message?.content && typeof message.content === 'string') {
      return c.json({ suggestion: message.content });
    }

    // n1 browser agent returns tool_calls — look for type_text or any text-bearing call
    const toolCalls: any[] = message?.tool_calls || [];

    for (const call of toolCalls) {
      const name: string = call.function?.name || '';
      if (name.includes('type') || name.includes('input') || name.includes('fill') || name.includes('write')) {
        try {
          const args = JSON.parse(call.function.arguments || '{}');
          const text = args.text || args.content || args.value || args.query || '';
          if (text && text.length > 15) return c.json({ suggestion: text });
        } catch {}
      }
    }

    // Fallback: any long string value in any tool_call args
    for (const call of toolCalls) {
      try {
        const args = JSON.parse(call.function?.arguments || '{}');
        for (const val of Object.values(args)) {
          if (typeof val === 'string' && val.length > 30) {
            return c.json({ suggestion: val });
          }
        }
      } catch {}
    }

    return c.json({ suggestion: null });
  } catch {
    return c.json({ error: 'Request failed' }, 500);
  }
});

export default aiRouter;
