import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';

const YUTORI_KEY = process.env.YUTORI_API_KEY || 'yt_h02YWBeSpGjDpcv5rW8Ko_KnJn1qBaZgxWz0L35wSpk';

const aiRouter = new Hono();

// POST /api/ai/suggest — uses Yutori n1 browser agent to write a listing description
aiRouter.post('/suggest', requireAuth, async (c) => {
  const { provider, creditType, faceValue, askingPrice, title } = await c.req.json();

  const fv = faceValue ? `$${(Number(faceValue) / 100).toFixed(0)}` : 'unknown face value';
  const ap = askingPrice ? `$${(Number(askingPrice) / 100).toFixed(0)}` : 'unknown price';

  // Frame as a browser form-filling task so n1 returns type_text with the content
  const prompt = `You are a browser agent on a P2P API credit marketplace. Your task is to fill in the "details" textarea with a compelling listing description.

Form currently shows:
- Title: ${title || `${provider} credits`}
- Provider: ${provider}
- Credit Type: ${creditType}
- Face Value: ${fv}
- Asking Price: ${ap}
- Details textarea: [empty — needs filling]

Use the type_text action to fill the details field with a 2-3 sentence description covering: what the credits are good for, how the transfer will work, and why the discount is fair. Keep it honest and hacker-toned. No fluff.`;

  try {
    const res = await fetch('https://api.yutori.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${YUTORI_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'n1-latest',
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
