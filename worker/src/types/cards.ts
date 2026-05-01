import type { CardCategory } from './curriculum';

/**
 * Reference card row shape as exposed by the API.
 *
 * Mirrors the columns of `reference_cards` (with foreign-key columns either
 * resolved or omitted). Lives in `types/` so the frontend can `import type`
 * the same shape without bringing the worker runtime into the page bundle.
 */
export interface ReferenceCard {
  id: number;
  term: string;
  category: CardCategory;
  definition: string;
  era: string | null;
  theme: string | null;
  times_reviewed: number;
  /** 0..5 inclusive; 0 = newly surfaced, 5 = mastered. */
  mastery: number;
  created_at: number;
  updated_at: number;
}
