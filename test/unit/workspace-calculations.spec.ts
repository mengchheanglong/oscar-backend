import { calculatePricing } from '../../src/modules/ai/runtime/workspace-calculations';

describe('Pricing scenarios', () => {
  it('calculates contribution, profit and integer break-even from explicit inputs', () => {
    expect(
      calculatePricing({ price: 25, variableCost: 10, fixedCost: 301, units: 30 }),
    ).toMatchObject({
      revenue: 750,
      totalVariableCost: 300,
      contribution: 450,
      operatingProfit: 149,
      breakEvenUnits: 21,
    });
  });
  it('reports no finite break-even with nonpositive contribution', () => {
    expect(
      calculatePricing({ price: 10, variableCost: 10, fixedCost: 300, units: 30 }).breakEvenUnits,
    ).toBeNull();
  });
  it.each([
    { price: -1, variableCost: 1, fixedCost: 0, units: 2 },
    { price: 1, variableCost: 1, fixedCost: 0, units: 2.5 },
    { price: Infinity, variableCost: 1, fixedCost: 0, units: 2 },
    { price: 1, variableCost: 1, fixedCost: 0, units: 2, code: 'malicious' },
  ])('rejects invalid assumptions', (input) => {
    expect(() => calculatePricing(input)).toThrow();
  });
});
