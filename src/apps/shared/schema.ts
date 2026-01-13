import { z } from 'zod';

export const WaitingSchema = z.object({
  literal: z.literal('waiting'),
  id: z.string(),
  at: z.number(),
});

export const WorkingSchema = z.object({
  literal: z.literal('working'),
  id: z.string(),
  progress: z.number(),
});

export const FinishedSchema = z.object({
  literal: z.literal('finished'),
  id: z.string(),
  filename: z.string(),
  download: z.string(),
});

export const FailedSchema = z.object({
  literal: z.literal('failed'),
  id: z.string(),
  details: z.string(),
});

export const ErrorSchema = z.object({
  literal: z.literal('error'),
  details: z.string(),
});

export const ProcessStateSchema = z.discriminatedUnion('processState', [
  WaitingSchema,
  WorkingSchema,
  FinishedSchema,
  FailedSchema,
  ErrorSchema,
]);

export type ProcessState = z.infer<typeof ProcessStateSchema>;
