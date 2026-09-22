// Prototype question: can the base Needle3 model judge small, ad-shaped DOM blocks?
// Explicit placement categories work better than a generic yes/no advertising question.
// No calls means abstain. Confidence measures the response, not advertisement probability.
export const TOOLS = [{
  name: 'classify_webpage',
  description: 'Classify the webpage element by its purpose.',
  parameters: {
    type: 'object',
    properties: { category: { type: 'string', enum: ['editorial', 'advertisement', 'sponsored', 'paid placement', 'partner offer', 'promoted'] } },
    required: ['category'],
  },
}];

export function describeCandidate(candidate) {
  const clean = (value, limit) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
  const text = clean(candidate.text, 440);
  const label = clean(candidate.label, 60);
  const visible = label && !text.toLowerCase().includes(label.toLowerCase()) ? `${label}. ${text}` : text || label;
  if (visible) return `Classify this webpage element: ${JSON.stringify(visible.slice(0, 440))}`;
  // Keep actual evidence; never fabricate an advertising label for an opaque frame.
  const metadata = [
    candidate.frameHost ? `Embedded frame from ${clean(candidate.frameHost, 100)}.` : '',
    clean(candidate.alt, 120),
    `Element: ${clean(candidate.tag, 20)} ${clean(candidate.elementId, 60)} ${clean(Array.isArray(candidate.classes) ? candidate.classes.join(' ') : candidate.classes, 120)}`,
  ].filter(Boolean).join(' ').slice(0, 440);
  return `Classify this webpage element: ${JSON.stringify(metadata)}`;
}

export function interpret(response) {
  const uncertain = { label: 'uncertain', confidence: null };
  if (!response || response.success === false || response.error || response.validation?.ungrounded?.length) return uncertain;
  const calls = response.function_calls;
  if (!Array.isArray(calls) || calls.length !== 1 || calls[0].name !== 'classify_webpage') return uncertain;
  const category = calls[0].arguments?.category;
  const confidence = response.confidence;
  if (!TOOLS[0].parameters.properties.category.enum.includes(category) || typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return uncertain;
  return { label: category === 'editorial' ? 'content' : 'ad', category, confidence };
}
