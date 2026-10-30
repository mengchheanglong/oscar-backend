import { Quantity } from './calculation.contract';

const words: Record<string, string> = Object.fromEntries(
  'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'
    .split(' ')
    .map((w, i) => [w, String(i)]),
);
const tokenPattern =
  /[−-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/gi;
const wordNumber = `(?:${Object.keys(words).join('|')})`;
const unsupportedWords = new RegExp(
  `\\b(?:negative|minus)\\s*(?:USD|KHR|EUR|GBP|[$€£៛])?\\s*(?:\\d|${wordNumber}\\b)|\\b${wordNumber}[ -]+${wordNumber}\\b|\\b${wordNumber}\\s+point\\s+${wordNumber}\\b|(?:\\d|\\b${wordNumber})\\s*(?:percent|per cent)\\b`,
  'i',
);
function periods(text: string): Quantity['period'][] {
  const found: Quantity['period'][] = [];
  if (/\bmonth(?:ly|s)?\b/i.test(text)) found.push('month');
  if (/\byear(?:ly|s)?\b|\bannual(?:ly)?\b/i.test(text)) found.push('year');
  if (/\bweek(?:ly|s)?\b/i.test(text)) found.push('week');
  if (/\bday(?:s)?\b|\bdaily\b/i.test(text)) found.push('day');
  return found;
}
function currencies(text: string): string[] {
  const found: string[] = [];
  if (/\bUSD\b/i.test(text)) found.push('USD');
  else if (/\$|\bdollars?\b/i.test(text)) found.push('$');
  if (/\bKHR\b|\briel\b|៛/i.test(text)) found.push('KHR');
  if (/\bEUR\b|€/i.test(text)) found.push('EUR');
  if (/\bGBP\b|£/i.test(text)) found.push('GBP');
  return found;
}

export function calculationIntent(question: string): boolean {
  const request = question
    .split(/\n(?:USER-PROVIDED|SOURCE|ATTACHED|BRIEF|DOCUMENT)\b/i)[0]!
    .replace(/\b(?:under|within|in|at most)\s+\d+\s+words?\b/gi, '');
  if (/\b(?:do not|don't|without) (?:calculate|compute|calculations?)\b/i.test(request))
    return false;
  const numbers = request.match(tokenPattern) ?? [];
  if (
    /\b(?:can|could|should) (?:we|you|I) (?:calculate|compute)\b/i.test(request) &&
    numbers.length < 2
  )
    return false;
  return (
    /\b(?:calculate|compute|how many)\b/i.test(request) ||
    (numbers.length >= 2 &&
      /\b(?:break[- ]?even|percentage change|conversion rate|cash runway|churn|contribution margin)\b/i.test(
        request,
      ))
  );
}

export function numericInputs(question: string): Quantity[] {
  // Pasted source examples must never become project inputs merely because
  // they occur in the current message. Offsets in this prefix remain original.
  question = question.split(/\n(?:USER-PROVIDED|SOURCE|ATTACHED|BRIEF|DOCUMENT)\b/i)[0]!;
  if (
    unsupportedWords.test(question) ||
    /(?:^|[^\d])\.\d|\d\s*[kmb]\b|\d\s*%|\d[ \u00a0]+\d|\b(?:hundred|thousand|million|billion|dozens?|cents?|pence|paise)\b|(?:USD|KHR|EUR|GBP|[$€£៛])\s*\d+\s*\/\s*\d/i.test(
      question,
    )
  )
    throw Error('UNSUPPORTED_NUMERIC_NOTATION');
  for (const literal of question.matchAll(/\d[\d,.]*/g)) {
    const value = literal[0].replace(/[.,]$/, '');
    if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(value))
      throw Error('UNSUPPORTED_NUMERIC_NOTATION');
  }
  if (question.length > 24000 || /\d[eE][+-]?\d|\b(?:OCR|ambiguous decimal)\b/i.test(question))
    throw Error('VERIFY_OR_NARROW_NUMERIC_INPUTS');
  const matches = [...question.matchAll(tokenPattern)];
  if (matches.length > 80) throw Error('TOO_MANY_INPUTS');
  const allPeriods = periods(question),
    allCurrencies = currencies(question);
  return matches.map((m, i) => {
    const start = m.index!,
      end = start + m[0].length;
    const previous = i ? matches[i - 1]!.index! + matches[i - 1]![0].length : 0;
    const left = question.slice(Math.max(previous, start - 100), start),
      right = question
        .slice(end, matches[i + 1]?.index ?? question.length)
        .slice(0, 100)
        .split(/[,;\n.!?]/)[0]!;
    const context = left.slice(-85) + m[0] + right;
    const localCurrency = currencies(
      (left.match(/(?:USD|KHR|EUR|GBP|[$€£៛])\s*$/i)?.[0] ?? '') +
        ' ' +
        (right.match(/^\s*(?:USD|KHR|EUR|GBP|dollars?|riel)\b/i)?.[0] ?? ''),
    );
    const currency =
      localCurrency.length === 1
        ? localCurrency[0]
        : allCurrencies.length === 1
          ? allCurrencies[0]
          : undefined;
    const localPeriod = periods(context),
      period =
        localPeriod.length === 1
          ? localPeriod[0]
          : allPeriods.length === 1
            ? allPeriods[0]
            : undefined;
    let unit: Quantity['unit'] = 'number';
    if (currency)
      unit = /\b(?:per|a|each)\s+hour\b|\/\s*h(?:our)?\b/i.test(right)
        ? 'money_per_hour'
        : /\b(?:per|a|each)\s+minute\b|\/\s*min\b/i.test(right)
          ? 'money_per_minute'
          : 'money';
    // A money symbol elsewhere in the question must not turn "45 minutes" or
    // cohort counts into money. Currency inheritance is only for labelled costs.
    const ownMoney = localCurrency.length > 0;
    if (!ownMoney && /^\s*(?:min(?:ute)?s?|hours?|h)\b/i.test(right))
      unit = /^\s*(?:min|minute)/i.test(right) ? 'minute' : 'hour';
    else if (
      !ownMoney &&
      !/\b(?:price|cost|profit|balance|burn|inflow|outflow|cash|revenue|rate)\b/i.test(context)
    )
      unit = 'number';
    if (
      unit === 'number' &&
      allCurrencies.length &&
      /\b(?:visits?|orders?|merchants?|users?|units?|subscriptions?|cancel|join|cohort)\b/i.test(
        context,
      ) &&
      !ownMoney &&
      !/\b(?:price|cost|profit|balance|burn|revenue)\b/i.test(left)
    )
      unit = 'number';
    return {
      id: 'n' + i,
      value: words[m[0].toLowerCase()] ?? m[0].replaceAll(',', '').replace('−', '-'),
      unit,
      ...(unit.startsWith('money') && currency ? { currency } : {}),
      ...(period ? { period } : {}),
      quote: m[0],
      start,
      end,
      context,
    };
  });
}

const hints: Record<string, RegExp> = {
  price: /price|selling|subscription revenue|charge/i,
  totalVariableCost: /variable/i,
  fixedCost: /fixed/i,
  targetProfit: /target|profit/i,
  duration: /minute|hour|duration|support takes/i,
  rate: /rate|per hour|per minute|\/h|\/min|labor cost/i,
  otherVariableCost: /other|remaining|additional/i,
  variable: /variable/i,
  units: /bundle|mix|basic|premium|units|subscriptions/i,
  numerator: /cancel|order|success|retain|numerator|churn|conversion/i,
  denominator: /start|original|cohort|visit|denominator|paying merchant|total/i,
  before: /before|from|initial|previous|old|went|was|were/i,
  after: /after|to|now|new|later|end/i,
  visitsBefore: /visit/i,
  visitsAfter: /visit/i,
  ordersBefore: /order/i,
  ordersAfter: /order/i,
  balance: /balance|cash/i,
  burn: /burn/i,
  opening: /opening|balance/i,
  inflows: /inflow|received|receipts/i,
  outflows: /outflow|paid|payment/i,
  quantity: /quantity|units|items|products|copies/i,
  unitPrice: /price|cost/i,
};
export function bindInputs(
  operation: string,
  fields: Record<string, string>,
  candidates: Quantity[],
  question: string,
): Record<string, Quantity> {
  const inputs: Record<string, Quantity> = {};
  for (const [key, id] of Object.entries(fields)) {
    const q = candidates.find((q) => q.id === id);
    if (!q) throw Error('UNKNOWN_INPUT_ID');
    const role = key.replace(/[12]$/, '');
    const orderedFunnel =
      operation === 'funnel_comparison' &&
      /visits\s*\/\s*orders/i.test(question) &&
      ['visitsBefore', 'ordersBefore', 'visitsAfter', 'ordersAfter'].includes(key);
    const orderedChange =
      operation === 'percentage_change' &&
      ['before', 'after'].includes(key) &&
      candidates.length === 2 &&
      /\bto\b/.test(question.slice(candidates[0]!.end, candidates[1]!.start));
    if (!orderedFunnel && !orderedChange && !(hints[key] ?? hints[role])?.test(q.context))
      throw Error('UNVERIFIED_INPUT_ROLE');
    if (
      key === 'totalVariableCost' &&
      /\b(?:other|remaining|additional|labor|support)\b/i.test(q.context) &&
      !/\btotal\s+variable\b/i.test(q.context)
    )
      throw Error('COMPONENT_IS_NOT_TOTAL_VARIABLE_COST');
    if (key === 'denominator' && /\bnew\b/i.test(q.context) && /churn|cancel/i.test(question))
      throw Error('COHORT_DENOMINATOR_AMBIGUOUS');
    if (q.unit.startsWith('money') && periods(question).length > 1 && !q.period)
      throw Error('AMBIGUOUS_PERIOD');
    inputs[key] = q;
  }
  if (operation === 'funnel_comparison' && /visits\s*\/\s*orders/i.test(question)) {
    const ids = ['visitsBefore', 'ordersBefore', 'visitsAfter', 'ordersAfter'].map(
      (k) => inputs[k]?.start ?? -1,
    );
    if (ids.some((value, i) => value < 0 || (i > 0 && value <= ids[i - 1]!)))
      throw Error('FUNNEL_ORDER_AMBIGUOUS');
  }
  if (
    operation === 'percentage_change' &&
    inputs.before &&
    inputs.after &&
    inputs.before.start >= inputs.after.start
  )
    throw Error('CHANGE_ORDER_AMBIGUOUS');
  return inputs;
}
