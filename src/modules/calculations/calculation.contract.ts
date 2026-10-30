import { z } from 'zod';

export const operationSchema = z.enum([
  'unit_economics',
  'labor_economics',
  'sales_mix',
  'rate',
  'percentage_change',
  'funnel_comparison',
  'runway',
  'cash_balance',
  'scenario_total',
]);
export type Operation = z.infer<typeof operationSchema>;
export const planSchema = z
  .object({
    requests: z
      .array(
        z
          .object({
            operation: operationSchema,
            fields: z.record(z.string().max(40), z.string().regex(/^n\d{1,3}$/)),
            principles: z
              .array(
                z
                  .object({
                    evidenceNumber: z.number().int().positive(),
                    quote: z.string().min(20).max(500),
                  })
                  .strict(),
              )
              .max(3),
          })
          .strict(),
      )
      .max(4),
  })
  .strict();

export interface Quantity {
  id: string;
  value: string;
  unit: 'money' | 'number' | 'minute' | 'hour' | 'money_per_hour' | 'money_per_minute';
  currency?: string;
  period?: 'month' | 'year' | 'week' | 'day';
  quote: string;
  start: number;
  end: number;
  context: string;
}
export interface CalculationOutput {
  key: string;
  label: string;
  value: string;
  unit: string;
  exact?: { numerator: string; denominator: string };
  rounding?: { mode: 'HALF_UP'; decimalPlaces: 6 };
}
export interface CalculationReceipt {
  version: 1;
  operation: Operation;
  status: 'CALCULATED' | 'NEEDS_INPUT' | 'NO_FINITE_SOLUTION';
  validation: 'EXACT_ARITHMETIC' | 'INPUT_REJECTED';
  inputs: Record<string, Quantity>;
  inputStatus: 'HYPOTHETICAL_USER_INPUT' | 'USER_PROVIDED_UNVERIFIED';
  questionSha256: string;
  outputs: CalculationOutput[];
  steps: string[];
  notices: string[];
  errorCode?: string;
  principles: { evidenceNumber: number; quote: string }[];
}
export interface CalculationAudit {
  version: 1;
  status: 'CALCULATED' | 'NEEDS_INPUT' | 'UNAVAILABLE';
  extractionModel?: string;
  promptTokens: number;
  completionTokens: number;
  receipts: CalculationReceipt[];
  failureCode?: string;
}
