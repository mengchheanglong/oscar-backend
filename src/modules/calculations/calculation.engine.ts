import { CalculationReceipt, Operation, Quantity } from './calculation.contract';
import { Rational as R } from './rational';

const fields: Record<Operation, { required: string[]; optional?: string[] }> = {
  unit_economics: {
    required: ['price', 'totalVariableCost'],
    optional: ['fixedCost', 'targetProfit'],
  },
  labor_economics: {
    required: ['duration', 'rate', 'otherVariableCost'],
    optional: ['price', 'fixedCost', 'targetProfit'],
  },
  sales_mix: {
    required: ['price1', 'variable1', 'units1', 'price2', 'variable2', 'units2', 'fixedCost'],
    optional: ['targetProfit'],
  },
  rate: { required: ['numerator', 'denominator'] },
  percentage_change: { required: ['before', 'after'] },
  funnel_comparison: { required: ['visitsBefore', 'ordersBefore', 'visitsAfter', 'ordersAfter'] },
  runway: { required: ['balance', 'burn'] },
  cash_balance: { required: ['opening', 'inflows', 'outflows'] },
  scenario_total: { required: ['quantity', 'unitPrice'] },
};
export const operationFields = fields;

export function calculate(
  operation: Operation,
  inputs: Record<string, Quantity>,
  provenance: Pick<CalculationReceipt, 'inputStatus' | 'questionSha256'>,
): CalculationReceipt {
  const receipt: CalculationReceipt = {
    version: 1,
    operation,
    status: 'CALCULATED',
    validation: 'EXACT_ARITHMETIC',
    inputs,
    outputs: [],
    steps: [],
    notices: [],
    principles: [],
    ...provenance,
  };
  const out = (key: string, label: string, value: R, unit: string) =>
    receipt.outputs.push({
      key,
      label,
      value: value.decimal(),
      unit,
      exact: value.exact(),
      rounding: { mode: 'HALF_UP', decimalPlaces: 6 },
    });
  const textOut = (key: string, label: string, value: string, unit: string) =>
    receipt.outputs.push({ key, label, value, unit });
  try {
    const spec = fields[operation];
    if (!spec) throw Error('UNSUPPORTED_OPERATION');
    if (
      spec.required.some((k) => !inputs[k]) ||
      Object.keys(inputs).some((k) => ![...spec.required, ...(spec.optional ?? [])].includes(k))
    )
      throw Error('MISSING_OR_UNKNOWN_INPUT');
    if (new Set(Object.values(inputs).map((q) => q.id)).size !== Object.keys(inputs).length)
      throw Error('REUSED_INPUT');
    const get = (key: string) => {
      const q = inputs[key];
      if (!q) throw Error('MISSING_' + key.toUpperCase());
      return R.parse(q.value);
    };
    const moneyKeys = Object.keys(inputs).filter(
      (k) =>
        ![
          'duration',
          'units1',
          'units2',
          'numerator',
          'denominator',
          'before',
          'after',
          'visitsBefore',
          'ordersBefore',
          'visitsAfter',
          'ordersAfter',
          'quantity',
        ].includes(k),
    );
    if (
      moneyKeys.some(
        (k) =>
          !(k === 'rate' ? ['money_per_hour', 'money_per_minute'] : ['money']).includes(
            inputs[k]!.unit,
          ) || !inputs[k]!.currency,
      )
    )
      throw Error('MONEY_UNIT_REQUIRED');
    if (new Set(moneyKeys.map((k) => inputs[k]!.currency)).size > 1)
      throw Error('MIXED_CURRENCIES');
    const periods = [
      ...new Set(
        Object.values(inputs)
          .map((q) => q.period)
          .filter(Boolean),
      ),
    ];
    if (periods.length > 1) throw Error('INCOMPATIBLE_PERIODS');
    const period = periods[0],
      currency = moneyKeys.length ? inputs[moneyKeys[0]!]!.currency! : '';
    const moneyUnit = currency + (period ? ' per ' + period : '');
    for (const [key, q] of Object.entries(inputs))
      if (
        R.parse(q.value).n < 0n &&
        !['opening', 'balance', 'burn', 'before', 'after'].includes(key)
      )
        throw Error('NEGATIVE_INPUT');
    const count = (key: string) => {
      const q = inputs[key]!,
        v = get(key);
      if (q.unit !== 'number' || v.d !== 1n || v.n < 0n) throw Error('COUNT_UNIT_REQUIRED');
      return v;
    };
    const cvp = (price: R, variable: R, fixed?: R) => {
      const cm = price.sub(variable);
      out('contribution', 'Contribution per unit', cm, moneyUnit);
      receipt.steps.push('Contribution = price − TOTAL variable cost.');
      if (price.n !== 0n)
        out('contributionRatio', 'Contribution margin ratio', cm.div(price), 'ratio');
      if (fixed) {
        if (cm.n <= 0n) {
          if (fixed.n === 0n && cm.n === 0n) {
            textOut('breakEvenUnits', 'Zero-profit break-even', '0', 'whole units');
            receipt.notices.push(
              'Zero contribution and zero fixed costs yield zero profit at every volume under the constant-input model.',
            );
          } else if (fixed.n === 0n) {
            textOut('breakEvenUnits', 'Zero-profit break-even', '0', 'whole units');
            receipt.notices.push(
              'At zero volume profit is zero; any positive volume loses money under these inputs.',
            );
          } else {
            receipt.status = 'NO_FINITE_SOLUTION';
            receipt.notices.push(
              'No nonnegative finite volume covers positive fixed costs when unit contribution is zero or negative, with inputs held constant.',
            );
          }
        } else {
          out('breakEvenExact', 'Zero-profit break-even before rounding', fixed.div(cm), 'units');
          textOut(
            'breakEvenUnits',
            'Zero-profit break-even rounded upward',
            fixed.div(cm).ceil(),
            'whole units',
          );
          receipt.steps.push(
            'Zero-profit units = fixed costs ÷ contribution; target profit is zero; round required whole units upward.',
          );
        }
        if (inputs.targetProfit) {
          const target = get('targetProfit');
          if (cm.n > 0n) {
            const units = fixed.add(target).div(cm);
            out('targetUnitsExact', 'Target-profit units before rounding', units, 'units');
            textOut(
              'targetUnits',
              'Target-profit units rounded upward',
              units.ceil(),
              'whole units',
            );
            receipt.steps.push(
              'Target-profit units = (fixed costs + target profit) ÷ contribution.',
            );
          } else if (target.n > 0n)
            receipt.notices.push(
              'The positive target profit is unattainable at nonnegative volume under these constant inputs.',
            );
        }
      } else {
        receipt.notices.push(
          'Fixed costs were not supplied; no break-even unit count is established.',
        );
        if (inputs.targetProfit) throw Error('FIXED_COST_REQUIRED');
      }
      receipt.notices.push(
        'Positive contribution alone does not establish total profit, cash sufficiency, demand or willingness to pay.',
      );
    };
    const percentage = (key: string, label: string, n: R, d: R) => {
      if (d.n === 0n) {
        receipt.notices.push(label + ' is undefined because its baseline/denominator is zero.');
        return;
      }
      out(key, label, n.div(d).mul(new R(100n)), 'percent');
    };
    switch (operation) {
      case 'unit_economics':
        cvp(
          get('price'),
          get('totalVariableCost'),
          inputs.fixedCost ? get('fixedCost') : undefined,
        );
        break;
      case 'labor_economics': {
        const duration = inputs.duration!,
          rate = inputs.rate!;
        if (
          !['minute', 'hour'].includes(duration.unit) ||
          !['money_per_hour', 'money_per_minute'].includes(rate.unit)
        )
          throw Error('LABOR_UNITS_REQUIRED');
        const hours =
          duration.unit === 'minute' ? get('duration').div(new R(60n)) : get('duration');
        const hourly = rate.unit === 'money_per_minute' ? get('rate').mul(new R(60n)) : get('rate');
        const labor = hours.mul(hourly),
          variable = labor.add(get('otherVariableCost'));
        out('laborHours', 'Labor time', hours, 'hours per unit');
        out('laborCost', 'Labor cost', labor, moneyUnit);
        out(
          'totalVariableCost',
          'Total variable cost including supplied other costs',
          variable,
          moneyUnit,
        );
        receipt.steps.push(
          'Minutes ÷ 60 = hours; hourly rate × hours = labor cost; add all other stated variable costs.',
        );
        if (inputs.price)
          cvp(get('price'), variable, inputs.fixedCost ? get('fixedCost') : undefined);
        else if (inputs.fixedCost || inputs.targetProfit) throw Error('PRICE_REQUIRED');
        receipt.notices.push(
          'The supplied other-variable-cost total must cover the remaining applicable components; it is not independently audited.',
        );
        break;
      }
      case 'sales_mix': {
        const a = count('units1'),
          b = count('units2');
        if (a.n === 0n || b.n === 0n) throw Error('POSITIVE_MIX_REQUIRED');
        const cm = get('price1')
          .sub(get('variable1'))
          .mul(a)
          .add(get('price2').sub(get('variable2')).mul(b));
        out('bundleContribution', 'Contribution per fixed-mix bundle', cm, moneyUnit);
        out('unitsPerBundle', 'Units per bundle', a.add(b), 'units');
        if (cm.n <= 0n) {
          if (get('fixedCost').n === 0n && (!inputs.targetProfit || get('targetProfit').n === 0n)) {
            textOut('bundles', 'Zero-profit bundle count', '0', 'whole bundles');
            textOut('units', 'Zero-profit unit count', '0', 'whole units');
          } else {
            receipt.status = 'NO_FINITE_SOLUTION';
            receipt.notices.push(
              'A nonpositive bundle contribution cannot cover positive fixed costs or target profit by adding bundles.',
            );
          }
          break;
        }
        const target = inputs.targetProfit ? get('targetProfit') : new R(0n),
          bundles = get('fixedCost').add(target).div(cm);
        textOut(
          'bundles',
          'Required complete bundles rounded upward',
          bundles.ceil(),
          'whole bundles',
        );
        out(
          'units',
          'Total units at that complete-bundle count',
          R.parse(bundles.ceil()).mul(a.add(b)),
          'whole units',
        );
        receipt.steps.push(
          'Bundle contribution = sum of (price − variable cost) × units in each tier; divide fixed costs plus target profit by bundle contribution; round bundles upward.',
        );
        receipt.notices.push(
          'The two-tier mix remains exactly as supplied; this is not a forecast of customer tier preferences.',
        );
        break;
      }
      case 'rate': {
        const n = count('numerator'),
          d = count('denominator');
        if (n.compare(d) > 0) throw Error('SUBSET_COUNT_EXCEEDS_DENOMINATOR');
        percentage('rate', 'Rate for the supplied numerator and denominator', n, d);
        receipt.steps.push('Rate = numerator ÷ denominator × 100.');
        receipt.notices.push(
          'Confirm that the numerator is a subset of the stated denominator and both refer to the same cohort/window.',
        );
        break;
      }
      case 'percentage_change': {
        const a = inputs.before!,
          b = inputs.after!;
        if (a.unit !== b.unit || a.currency !== b.currency) throw Error('INCOMPATIBLE_UNITS');
        if (get('before').n < 0n) throw Error('NEGATIVE_BASELINE_UNSUPPORTED');
        const delta = get('after').sub(get('before'));
        out(
          'absoluteChange',
          'Absolute change',
          delta,
          a.unit === 'money' ? (a.currency ?? 'money') : 'units',
        );
        percentage(
          'relativeChange',
          'Relative change from the supplied baseline',
          delta,
          get('before'),
        );
        receipt.steps.push('(after − before) ÷ before × 100.');
        receipt.notices.push('A numerical change does not establish causality.');
        break;
      }
      case 'funnel_comparison': {
        const vb = count('visitsBefore'),
          ob = count('ordersBefore'),
          va = count('visitsAfter'),
          oa = count('ordersAfter');
        if (ob.compare(vb) > 0 || oa.compare(va) > 0)
          throw Error('SUBSET_COUNT_EXCEEDS_DENOMINATOR');
        percentage('orderChange', 'Relative change in order count', oa.sub(ob), ob);
        percentage('conversionBefore', 'Conversion before', ob, vb);
        percentage('conversionAfter', 'Conversion after', oa, va);
        if (vb.n && va.n) {
          const first = ob.div(vb),
            last = oa.div(va);
          out(
            'percentagePoints',
            'Conversion change',
            last.sub(first).mul(new R(100n)),
            'percentage points',
          );
          percentage(
            'relativeConversionChange',
            'Relative conversion change',
            last.sub(first),
            first,
          );
        }
        receipt.steps.push(
          'Conversion = orders ÷ visits; distinguish percentage-point difference from relative percentage change.',
        );
        receipt.notices.push(
          'These counts/rates do not establish that a page, advertisement or storefront caused the change; traffic composition, promotions and other confounders remain.',
        );
        break;
      }
      case 'runway': {
        if (!inputs.burn!.period) throw Error('BURN_PERIOD_REQUIRED');
        const burn = get('burn'),
          balance = get('balance');
        if (balance.n < 0n) throw Error('NEGATIVE_CASH_BALANCE');
        if (burn.n <= 0n) {
          receipt.status = 'NO_FINITE_SOLUTION';
          receipt.notices.push(
            'No finite depletion time is implied by a nonpositive constant net burn; this does not guarantee cash sufficiency in reality.',
          );
        } else out('runway', 'Simple runway', balance.div(burn), inputs.burn!.period + 's');
        receipt.steps.push('Simple runway = cash balance ÷ constant NET cash burn per period.');
        receipt.notices.push(
          'Assumes unchanged net cash flows and no other cash movements; this is not accounting profitability.',
        );
        break;
      }
      case 'cash_balance':
        out(
          'closingCash',
          'Closing cash balance',
          get('opening').add(get('inflows')).sub(get('outflows')),
          currency,
        );
        receipt.steps.push(
          'Closing cash = opening cash + stated cash inflows − stated cash outflows.',
        );
        receipt.notices.push(
          'Only the supplied cash movements are included; accrual revenue and profit are different measures.',
        );
        break;
      case 'scenario_total':
        out('scenarioTotal', 'Scenario total', count('quantity').mul(get('unitPrice')), moneyUnit);
        receipt.steps.push('Scenario total = stated quantity × unit price.');
        break;
    }
    return receipt;
  } catch (error: unknown) {
    return {
      ...receipt,
      status: 'NEEDS_INPUT',
      validation: 'INPUT_REJECTED',
      outputs: [],
      steps: [],
      errorCode: error instanceof Error ? error.message : 'INVALID_INPUT',
      notices: [
        'The inputs or units could not be validated. Supply explicitly labelled amounts, complete cost components, a common currency and consistent periods.',
      ],
    };
  }
}
