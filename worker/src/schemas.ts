import { z } from 'zod';
import { MAX_CHAT_MESSAGE_CHARS } from './config';
import { CARD_CATEGORIES } from './types/curriculum';

/**
 * Zod schemas for every JSON body and query string the Worker accepts.
 *
 * Routes call `Schema.safeParse(body)` and throw `ValidationError` (with
 * `result.error.issues` as `details`) on failure. New endpoints add their
 * schemas here so all input contracts live in one file.
 */

export const ChatRequestSchema = z.object({
  message: z.string().min(1).max(MAX_CHAT_MESSAGE_CHARS),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const PinRequestSchema = z.object({
  pin: z.string().min(1).max(64),
});
export type PinRequest = z.infer<typeof PinRequestSchema>;

/** PATCH /api/cards/:id — student self-rates mastery 0..5 after review. */
export const CardPatchSchema = z.object({
  mastery: z.number().int().min(0).max(5),
});
export type CardPatch = z.infer<typeof CardPatchSchema>;

/** Query params for GET /api/cards. Strings come from URLSearchParams; coerce numbers. */
export const CardsQuerySchema = z.object({
  sort: z.enum(['weakest', 'newest', 'alpha'] as const).default('weakest'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  category: z.enum(CARD_CATEGORIES).optional(),
  era: z.string().min(1).max(64).optional(),
});
export type CardsQuery = z.infer<typeof CardsQuerySchema>;
