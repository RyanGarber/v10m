import { z } from 'zod';

export const ProcessStatusSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('waiting'),
    id: z.string(),
    at: z.number(),
  }),
  z.object({
    status: z.literal('working'),
    id: z.string(),
    progress: z.number(),
  }),
  z.object({
    status: z.literal('finished'),
    id: z.string(),
    filename: z.string(),
    download: z.string(),
  }),
  z.object({
    status: z.literal('failed'),
    id: z.string(),
    details: z.string(),
  }),
  z.object({
    status: z.literal('error'),
    details: z.string(),
  }),
]);

export type ProcessStatus = z.infer<typeof ProcessStatusSchema>;
