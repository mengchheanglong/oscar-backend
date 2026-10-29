function requestText(question: string): string {
  return question.split(/\n(?:USER-PROVIDED|SOURCE|ATTACHED|BRIEF|DOCUMENT)\b/i)[0]!.slice(0, 4000);
}

export function synthesisConcepts(question: string): string[] {
  const subjects = /\b(?:connect|combine|integrate|relationship between)\s+([^?!.\n]+)/i.exec(
    requestText(question),
  )?.[1];
  if (!subjects || /^(?:to|with|it|this|them)\b/i.test(subjects) || /["“”]/.test(subjects))
    return [];
  const concepts = subjects
    .split(/,\s*|\s+and\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  return concepts.length >= 2 &&
    concepts.length <= 6 &&
    concepts.every((s) => s.length <= 100 && s.split(/\s+/).length <= 9)
    ? concepts
    : [];
}

export function requestsSynthesis(question: string): boolean {
  const request = requestText(question);
  return (
    (/\b(synthesi[sz]e|synthesis|connect|combine|integrate|generali[sz]e)\b/i.test(request) &&
      /\b(books?|sources?|principles|ideas|knowledge|library|lessons)\b/i.test(request)) ||
    synthesisConcepts(question).length > 0
  );
}

export function requestsPositioning(question: string): boolean {
  const request = requestText(question);
  if (/\b(according to|chapter|author.only|only the book)\b/i.test(request)) return false;
  if (/\bhow (?:do|should|can) we present our ?sel(?:f|ves)\b/i.test(request)) return true;
  return (
    /\b(?:how (?:do|should|can) (?:we|I) (?:present|position|describe|explain)|(?:write|refine|improve|help)[^.?!\n]{0,60}(?:pitch|positioning|value proposition))\b/i.test(
      request,
    ) &&
    /\b(business|company|product|merchants?|storefront|marketplace|positioning|value proposition|pitch)\b/i.test(
      question,
    )
  );
}
