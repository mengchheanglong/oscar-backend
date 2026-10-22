import { z } from 'zod';
import { Priority } from '../../../common/enums/priority.enum';

export const TaskDraftItemSchema = z.object({
  itemId: z.string().min(1),
  title: z.string().trim().min(1).max(500),
  description: z.string().max(5000).nullable().optional(),
  priority: z.nativeEnum(Priority).default(Priority.MEDIUM),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
      const date = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }, 'Due date must be a valid calendar date.')
    .nullable()
    .optional(),
  sourceIds: z.array(z.string()).default([]),
});

export type TaskDraftItem = z.infer<typeof TaskDraftItemSchema>;

export const TaskProposalPayloadSchema = z.object({
  type: z.literal('CREATE_TASKS'),
  items: z
    .array(TaskDraftItemSchema)
    .min(1)
    .max(20)
    .refine(
      (items) => new Set(items.map((item) => item.itemId)).size === items.length,
      'Draft item IDs must be unique.',
    ),
  sourceReferences: z
    .array(
      z.object({
        sourceId: z.string().uuid(),
        sourceType: z.literal('DOCUMENT'),
        title: z.string(),
        revision: z.number().int().positive(),
        chunkId: z.string().uuid(),
        locator: z.string(),
      }),
    )
    .optional(),
});

export type TaskProposalPayload = z.infer<typeof TaskProposalPayloadSchema>;
