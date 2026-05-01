import { z } from 'zod';
import {
  COMPETENCE_SIGNALS,
  ERA_IDS,
  EXAM_SKILLS,
  SKILL_STRENGTHS,
  THEME_IDS,
} from './curriculum';

/**
 * Output schema for the evaluation pass.
 *
 * The eval Claude call returns ONE of these objects per student turn. The
 * downstream merge (`map-merge.ts`) consumes it deterministically; this type
 * is the entire contract between the LLM-driven eval and the LLM-free merge.
 *
 * All array fields default to `[]` and `diagnostic_note` defaults to `''`
 * so a partial response (Claude omits an empty field) still parses cleanly.
 *
 * Why so many small array shapes (e.g. `{ fact: string }` instead of just
 * `string`): every array element gives us a stable place to extend later
 * (per-fact metadata, per-misconception severity) without a schema break.
 */

const factSchema = z.object({ fact: z.string().min(1) });
const descriptionSchema = z.object({ description: z.string().min(1) });

export const EvaluationResultSchema = z.object({
  facts_demonstrated: z.array(factSchema).default([]),
  facts_struggled: z.array(factSchema).default([]),
  misconceptions_observed: z.array(descriptionSchema).default([]),
  misconceptions_addressed: z.array(descriptionSchema).default([]),
  skills_observed: z
    .array(
      z.object({
        skill: z.enum(EXAM_SKILLS),
        strength: z.enum(SKILL_STRENGTHS),
      }),
    )
    .default([]),
  era_competence_signals: z
    .array(
      z.object({
        era: z.enum(ERA_IDS),
        signal: z.enum(COMPETENCE_SIGNALS),
      }),
    )
    .default([]),
  theme_competence_signals: z
    .array(
      z.object({
        theme: z.enum(THEME_IDS),
        signal: z.enum(COMPETENCE_SIGNALS),
      }),
    )
    .default([]),
  diagnostic_note: z.string().default(''),
});

export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;
