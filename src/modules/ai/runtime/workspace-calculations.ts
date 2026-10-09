import { z } from 'zod';

const inputSchema = z
  .object({
    price: z.number().finite().min(0).max(1e9),
    variableCost: z.number().finite().min(0).max(1e9),
    fixedCost: z.number().finite().min(0).max(1e12),
    units: z.number().int().min(0).max(1e9),
  })
  .strict();

export function calculatePricing(input: unknown) {
  const assumptions = inputSchema.parse(input);
  const { price, variableCost, fixedCost, units } = assumptions;
  const unitContribution = price - variableCost;
  return {
    assumptions,
    revenue: price * units,
    totalVariableCost: variableCost * units,
    unitContribution,
    contribution: unitContribution * units,
    operatingProfit: unitContribution * units - fixedCost,
    breakEvenUnits: unitContribution > 0 ? Math.ceil(fixedCost / unitContribution) : null,
    precision: 'JavaScript floating-point scenario estimate; not an accounting ledger.',
  };
}
