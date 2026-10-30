import { calculate } from '../../src/modules/calculations/calculation.engine';
import { Quantity, Operation } from '../../src/modules/calculations/calculation.contract';
import { Rational } from '../../src/modules/calculations/rational';

const provenance = {
  inputStatus: 'HYPOTHETICAL_USER_INPUT' as const,
  questionSha256: 'synthetic-question',
};
function run(operation: Operation, values: Record<string, string | Partial<Quantity>>) {
  const inputs = Object.fromEntries(
    Object.entries(values).map(([key, value], i) => [
      key,
      {
        id: 'n' + i,
        value: '0',
        unit: 'money',
        currency: '$',
        period: 'month',
        quote: 'synthetic',
        start: i,
        end: i + 1,
        context: key,
        ...(typeof value === 'string' ? { value } : value),
      },
    ]),
  ) as Record<string, Quantity>;
  return calculate(operation, inputs, provenance);
}
const result = (r: ReturnType<typeof run>, key: string) =>
  r.outputs.find((o) => o.key === key)?.value;
const count = (value: string): Partial<Quantity> => ({
  value,
  unit: 'number',
  currency: undefined,
});

describe('bounded deterministic business calculations', () => {
  it('passes the roadmap contribution, zero-profit and target-profit example', () => {
    const r = run('unit_economics', {
      price: '20',
      totalVariableCost: '5',
      fixedCost: '600',
      targetProfit: '300',
    });
    expect(result(r, 'contribution')).toBe('15');
    expect(result(r, 'breakEvenUnits')).toBe('40');
    expect(result(r, 'targetUnits')).toBe('60');
  });
  it('computes count growth without implying conversion or causality', () => {
    const r = run('percentage_change', { before: count('20'), after: count('30') });
    expect(result(r, 'relativeChange')).toBe('50');
    expect(r.outputs.some((o) => o.key.includes('conversion'))).toBe(false);
    expect(r.notices.join(' ')).toContain('causality');
  });
  it.each(['-1', '1.5'])('rejects invalid discrete counts %s', (value) => {
    expect(run('rate', { numerator: count(value), denominator: count('30') }).status).toBe(
      'NEEDS_INPUT',
    );
  });
  it('separates zero-profit from positive target-profit and preserves exact contribution', () => {
    const r = run('unit_economics', {
      price: '34',
      totalVariableCost: '9',
      fixedCost: '750',
      targetProfit: '450',
    });
    expect(r.status).toBe('CALCULATED');
    expect(result(r, 'contribution')).toBe('25');
    expect(result(r, 'breakEvenUnits')).toBe('30');
    expect(result(r, 'targetUnits')).toBe('48');
  });
  it.each([
    ['8', '10'],
    ['10', '10'],
  ])('never invents positive finite break-even at price %s and variable cost %s', (price, cost) => {
    const r = run('unit_economics', { price, totalVariableCost: cost, fixedCost: '500' });
    expect(r.status).toBe('NO_FINITE_SOLUTION');
    expect(result(r, 'breakEvenUnits')).toBeUndefined();
  });
  it('handles zero fixed costs without calling negative unit economics viable', () => {
    const r = run('unit_economics', { price: '8', totalVariableCost: '10', fixedCost: '0' });
    expect(result(r, 'breakEvenUnits')).toBe('0');
    expect(r.notices.join(' ')).toContain('any positive volume loses');
  });
  it('rounds whole units upward and the rounded quantity covers fixed costs', () => {
    const r = run('unit_economics', {
      price: '17.50',
      totalVariableCost: '6.25',
      fixedCost: '500',
    });
    expect(result(r, 'breakEvenUnits')).toBe('45');
    expect(Rational.parse('45').mul(Rational.parse('11.25')).compare(Rational.parse('500'))).toBe(
      1,
    );
    expect(Rational.parse('44').mul(Rational.parse('11.25')).compare(Rational.parse('500'))).toBe(
      -1,
    );
  });
  it('converts minutes to hours before multiplying an hourly rate', () => {
    const r = run('labor_economics', {
      duration: { value: '45', unit: 'minute', currency: undefined },
      rate: { value: '12', unit: 'money_per_hour' },
      otherVariableCost: '3',
      price: '20',
      fixedCost: '600',
    });
    expect(result(r, 'laborHours')).toBe('0.75');
    expect(result(r, 'laborCost')).toBe('9');
    expect(result(r, 'totalVariableCost')).toBe('12');
    expect(result(r, 'contribution')).toBe('8');
    expect(result(r, 'breakEvenUnits')).toBe('75');
  });
  it('supports minute-based rates without silently treating them as hourly', () => {
    const r = run('labor_economics', {
      duration: { value: '1.5', unit: 'hour', currency: undefined },
      rate: { value: '0.20', unit: 'money_per_minute' },
      otherVariableCost: '2',
    });
    expect(result(r, 'laborCost')).toBe('18');
  });
  it('requires the remaining variable-cost total instead of assuming it zero', () => {
    const r = run('labor_economics', {
      duration: { value: '45', unit: 'minute' },
      rate: { value: '12', unit: 'money_per_hour' },
    });
    expect(r.status).toBe('NEEDS_INPUT');
    expect(r.outputs).toEqual([]);
  });
  it('supports an exact fixed two-tier sales mix, rounding complete bundles', () => {
    const r = run('sales_mix', {
      price1: '10',
      variable1: '4',
      units1: count('3'),
      price2: '25',
      variable2: '7',
      units2: count('1'),
      fixedCost: '300',
    });
    expect(result(r, 'bundleContribution')).toBe('36');
    expect(result(r, 'bundles')).toBe('9');
    expect(result(r, 'units')).toBe('36');
  });
  it('distinguishes count increase, conversion change and percentage points', () => {
    const r = run('funnel_comparison', {
      visitsBefore: count('80'),
      ordersBefore: count('8'),
      visitsAfter: count('160'),
      ordersAfter: count('12'),
    });
    expect(result(r, 'orderChange')).toBe('50');
    expect(result(r, 'conversionBefore')).toBe('10');
    expect(result(r, 'conversionAfter')).toBe('7.5');
    expect(result(r, 'percentagePoints')).toBe('-2.5');
    expect(result(r, 'relativeConversionChange')).toBe('-25');
    expect(r.notices.join(' ')).toContain('do not establish');
  });
  it('never calls zero/zero a measured zero-percent conversion', () => {
    const r = run('rate', { numerator: count('0'), denominator: count('0') });
    expect(result(r, 'rate')).toBeUndefined();
    expect(r.notices.join(' ')).toContain('undefined');
  });
  it('uses the supplied cohort denominator and rejects impossible subsets', () => {
    expect(result(run('rate', { numerator: count('6'), denominator: count('30') }), 'rate')).toBe(
      '20',
    );
    expect(run('rate', { numerator: count('31'), denominator: count('30') }).status).toBe(
      'NEEDS_INPUT',
    );
  });
  it('rejects incompatible currencies, periods, dimensions and negative cash outflows', () => {
    expect(
      run('unit_economics', { price: '20', totalVariableCost: { value: '5', currency: 'KHR' } })
        .errorCode,
    ).toBe('MIXED_CURRENCIES');
    expect(
      run('unit_economics', { price: '20', totalVariableCost: { value: '5', period: 'year' } })
        .errorCode,
    ).toBe('INCOMPATIBLE_PERIODS');
    expect(
      run('unit_economics', {
        price: { value: '20', unit: 'money_per_hour' },
        totalVariableCost: '5',
      }).errorCode,
    ).toBe('MONEY_UNIT_REQUIRED');
    expect(run('cash_balance', { opening: '100', inflows: '20', outflows: '-10' }).status).toBe(
      'NEEDS_INPUT',
    );
  });
  it('does not invent fixed costs when only unit contribution can be calculated', () => {
    const r = run('unit_economics', { price: '19', totalVariableCost: '7' });
    expect(result(r, 'contribution')).toBe('12');
    expect(result(r, 'breakEvenUnits')).toBeUndefined();
    expect(r.notices.join(' ')).toContain('not supplied');
  });
  it('calculates simple runway from net burn and keeps cash separate from profit', () => {
    expect(result(run('runway', { balance: '1200', burn: '300' }), 'runway')).toBe('4');
    expect(run('runway', { balance: '1200', burn: '0' }).status).toBe('NO_FINITE_SOLUTION');
    expect(
      result(run('cash_balance', { opening: '100', inflows: '20', outflows: '30' }), 'closingCash'),
    ).toBe('90');
    expect(
      result(run('scenario_total', { quantity: count('3'), unitPrice: '0.10' }), 'scenarioTotal'),
    ).toBe('0.3');
  });
  it('rejects a reused token assigned two incompatible input roles', () => {
    const q = {
      id: 'n0',
      value: '20',
      unit: 'money' as const,
      currency: '$',
      quote: '20',
      context: '',
      start: 0,
      end: 2,
    };
    expect(
      calculate('unit_economics', { price: q, totalVariableCost: q }, provenance).errorCode,
    ).toBe('REUSED_INPUT');
  });
});

describe('exact rational decimal kernel', () => {
  it('avoids floating-point money errors and exposes the exact fraction', () => {
    expect(Rational.parse('0.1').add(Rational.parse('0.2')).decimal()).toBe('0.3');
    expect(new Rational(1n, 3n).exact()).toEqual({ numerator: '1', denominator: '3' });
    expect(new Rational(1n, 3n).decimal()).toBe('0.333333');
    expect(Rational.parse('0.005').decimal(2)).toBe('0.01');
    expect(Rational.parse('-0.5').decimal(0)).toBe('-1');
  });
  it.each([
    '1e20',
    '1+2',
    'Infinity',
    'NaN',
    '0;process.exit()',
    '1234567890123456',
    '0.1234567890',
  ])('rejects unsupported numeric syntax %s', (value) =>
    expect(() => Rational.parse(value)).toThrow(),
  );
  it('rejects zero denominators rather than leaking infinity', () =>
    expect(() => new Rational(1n, 0n)).toThrow('ZERO_DENOMINATOR'));
});
