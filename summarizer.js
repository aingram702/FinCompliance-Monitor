// agent/summarizer.js
// Uses Claude to synthesize raw scraped items into a structured,
// analyst-quality briefing tailored to financial institution compliance teams.

const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a senior compliance and cybersecurity analyst specializing in U.S. financial institutions. 
Your audience is compliance officers, IT security leads, and risk managers at banks, credit unions, and fintechs.

When given raw regulatory and security intelligence items, you:
1. Synthesize and prioritize by relevance and urgency for financial institutions
2. Write in clear, professional language — no fluff, no jargon for its own sake
3. Group items logically: Cybersecurity Threats, Regulatory Updates, AML/BSA, Enforcement Actions, Industry News
4. For each item, provide: a crisp 2-3 sentence summary and a clear "Action Required" note (even if it's "Monitor Only")
5. Add a brief "Editor's Take" at the top — 3-4 sentences summarizing the most critical themes of this briefing
6. Flag anything that requires immediate attention with ⚠️ URGENT

Output ONLY valid JSON — no markdown, no preamble, no trailing text. 
Follow this exact schema:
{
  "subject": "string (compelling email subject line, include date range)",
  "editorsTake": "string (3-4 sentence executive summary of the week's most important themes)",
  "sections": [
    {
      "title": "string (section name)",
      "items": [
        {
          "title": "string",
          "source": "string",
          "url": "string",
          "summary": "string (2-3 sentences, plain language)",
          "actionRequired": "string (what compliance/IT teams should do or watch for)",
          "urgent": boolean
        }
      ]
    }
  ],
  "closingNote": "string (1-2 sentences, forward-looking, what to watch next period)"
}`;

/**
 * @param {Array} items - Raw items from scrapers
 * @returns {Object} Structured newsletter object
 */
async function generateNewsletter(items) {
  if (items.length === 0) {
    return null;
  }

  // Trim descriptions to avoid blowing the context window
  const truncated = items.map(item => ({
    source:      item.source,
    title:       item.title,
    url:         item.url,
    description: (item.description || '').slice(0, 600),
    category:    item.category || '',
    publishedAt: item.publishedAt || '',
    ...(item.cvssScore ? { cvssScore: item.cvssScore, severity: item.severity } : {}),
  }));

  const userPrompt = `
Today's date: ${new Date().toDateString()}

Here are ${truncated.length} new items collected from CISA, NVD, OCC, FinCEN, and FFIEC. 
Synthesize these into a professional compliance briefing newsletter for financial institution staff.

RAW ITEMS:
${JSON.stringify(truncated, null, 2)}

Remember: output ONLY valid JSON, nothing else.
`;

  console.log(`[Agent] Sending ${items.length} items to Claude for synthesis...`);

  const message = await client.messages.create({
    model:      'claude-opus-4-5',
    max_tokens: 4096,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: userPrompt }],
  });

  const raw = message.content[0]?.text?.trim() || '';

  try {
    // Strip any accidental markdown fences
    const clean = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const newsletter = JSON.parse(clean);
    console.log(`[Agent] Newsletter generated: "${newsletter.subject}"`);
    return newsletter;
  } catch (err) {
    console.error('[Agent] Failed to parse Claude response as JSON:', err.message);
    console.error('[Agent] Raw response snippet:', raw.slice(0, 500));
    throw new Error('Claude returned invalid JSON — check prompt or response');
  }
}

module.exports = { generateNewsletter };
