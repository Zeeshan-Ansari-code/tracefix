/**
 * LLM or mock diagnosis from live + static evidence.
 */
export async function diagnose({ errorDescription, projectType, gitLog, search, capture, priorNotes }) {
  const provider = (process.env.LLM_PROVIDER || 'mock').toLowerCase();
  const context = { errorDescription, projectType, gitLog, search, capture, priorNotes };

  if (provider === 'openai') {
    return openaiDiagnose(context);
  }
  if (provider === 'huggingface' || provider === 'hf') {
    return huggingfaceDiagnose(context);
  }

  return mockDiagnose(context);
}

function mockDiagnose({ errorDescription, projectType, gitLog, search, capture }) {
  const hits = search?.hits || [];
  const live = [
    ...(capture?.pageErrors || []),
    ...((capture?.consoleMessages || []).filter((m) => m.type === 'error').map((m) => m.text)),
  ];
  const top = hits[0];
  const rootCause = live[0]
    ? `Browser captured: ${live[0]}`
    : top
      ? `Likely near ${top.path}:${top.line}`
      : 'Insufficient live matches — paste a clearer stack trace.';

  const confidence = live.length && hits.length ? 'high' : live.length || hits.length ? 'medium' : 'low';
  const evidence = [
    ...live.slice(0, 4).map((e) => `browser: ${e}`),
    ...hits.slice(0, 4).map((h) => `${h.path}:${h.line}`),
    projectType?.kind ? `project: ${projectType.kind}` : null,
    gitLog ? 'git history available' : null,
  ].filter(Boolean);

  const reportMarkdown = [
    '# TraceFix Report',
    '',
    `## Summary`,
    String(errorDescription).slice(0, 200),
    '',
    `## Root cause`,
    rootCause,
    '',
    `## Confidence`,
    confidence,
    '',
    `## Evidence`,
    ...evidence.map((e) => `- ${e}`),
    '',
    `_Mock provider — set LLM_PROVIDER=huggingface or openai for richer file patches._`,
  ].join('\n');

  return {
    provider: 'mock',
    summary: `Investigated: ${String(errorDescription).slice(0, 100)}`,
    rootCause,
    confidence,
    evidence,
    suggestedFiles: [],
    reportMarkdown,
  };
}

const SYSTEM_PROMPT = `You are TraceFix, an automated debugging agent. Reply ONLY with JSON:
{"summary":"","rootCause":"","confidence":"low|medium|high","evidence":[],"suggestedFiles":[{"path":"","content":"","rationale":""}],"reportMarkdown":""}
Max 5 suggestedFiles. Each suggestedFiles[].content must be the FULL file contents to write.
Prefer empty suggestedFiles if unsure. Never invent secrets or .env values.`;

async function openaiDiagnose(context) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ...mockDiagnose(context), provider: 'mock-fallback', note: 'OPENAI_API_KEY missing' };
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const raw = await chatCompletions({
    url: 'https://api.openai.com/v1/chat/completions',
    apiKey,
    model,
    context,
  });
  return normalizeDiagnosis(raw, context, 'openai');
}

async function huggingfaceDiagnose(context) {
  const apiKey = process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN;
  if (!apiKey) {
    return { ...mockDiagnose(context), provider: 'mock-fallback', note: 'HUGGINGFACE_API_KEY missing' };
  }

  const model = process.env.HUGGINGFACE_MODEL || 'deepseek-ai/DeepSeek-V3.2';
  const raw = await chatCompletions({
    url: 'https://router.huggingface.co/v1/chat/completions',
    apiKey,
    model,
    context,
  });
  return normalizeDiagnosis(raw, context, 'huggingface');
}

async function chatCompletions({ url, apiKey, model, context }) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(sanitizeForLlm(context), null, 2) },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LLM error ${response.status}: ${body.slice(0, 400)}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

function sanitizeForLlm(context) {
  const clone = structuredClone
    ? structuredClone(context)
    : JSON.parse(JSON.stringify(context));
  // Drop huge blobs / secret-looking fields from capture if present
  if (clone?.capture) {
    delete clone.capture.screenshotPath;
  }
  return clone;
}

function normalizeDiagnosis(raw, context, provider) {
  const parsed = parseJson(raw);
  return {
    provider,
    summary: parsed.summary || String(context.errorDescription).slice(0, 100),
    rootCause: parsed.rootCause || 'Unknown',
    confidence: ['low', 'medium', 'high'].includes(parsed.confidence) ? parsed.confidence : 'low',
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String).slice(0, 12) : [],
    suggestedFiles: Array.isArray(parsed.suggestedFiles)
      ? parsed.suggestedFiles
          .filter((f) => f?.path && typeof f.content === 'string')
          .filter((f) => !/(^|\/)\.env(\.|$)/i.test(f.path))
          .slice(0, 5)
          .map((f) => ({ path: f.path, content: f.content, rationale: f.rationale || '' }))
      : [],
    reportMarkdown: parsed.reportMarkdown || `# TraceFix Report\n\n${parsed.rootCause || ''}`,
  };
}

function parseJson(raw) {
  const trimmed = String(raw).trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = fence ? fence[1].trim() : trimmed;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    return {
      summary: text.slice(0, 120),
      rootCause: text.slice(0, 500),
      confidence: 'low',
      evidence: [],
      suggestedFiles: [],
      reportMarkdown: text,
    };
  }
}
