import { z } from 'zod';
import {
  COMPETENCE_LEVELS,
  ERA_IDS,
  EXAM_SKILLS,
  SKILL_STRENGTHS,
  THEME_IDS,
  type Competence,
  type EraId,
  type ExamSkill,
  type FactStrength,
  type SkillStrength,
  type ThemeId,
} from './curriculum';

/**
 * The knowledge map: the system's structured belief about what the student
 * knows, what they've struggled with, and what the tutor has chosen to
 * remember between sessions.
 *
 * Stored as JSON text in `knowledge_map.data` (one row per conversation).
 * Read at the start of every chat call (via `buildClaudeInput`) and
 * rewritten by Stage 4's evaluation pass after every student turn.
 *
 * Stage 3 sets up storage and assembly only -- the map will be empty
 * (all eras "untested", no facts) at the end of this stage.
 *
 * Schema versioning: the `version` field is checked on read. A future
 * structural change increments this and adds a migration in load code.
 */
export interface KnowledgeMap {
  version: 1;
  last_updated_ms: number;
  era_competence: Record<EraId, Competence>;
  theme_competence: Record<ThemeId, Competence>;
  known_facts: Array<{
    fact: string;
    first_demonstrated_turn_id: number;
    last_confirmed_turn_id: number;
    strength: FactStrength;
  }>;
  misconceptions: Array<{
    description: string;
    first_observed_turn_id: number;
    addressed: boolean;
    // `| undefined` is required for compatibility with Zod's `.optional()` output
    // under `exactOptionalPropertyTypes: true`. Field may be omitted OR explicit undefined.
    addressed_turn_id?: number | undefined;
  }>;
  skills_demonstrated: Array<{
    skill: ExamSkill;
    strength: SkillStrength;
    last_observed_turn_id: number;
  }>;
  weak_areas: string[];
  diagnostic_notes: string;
}

// ---------------------------------------------------------------------------
// Zod schema. Mirrors the type exactly. Used to validate any map before write
// (saveKnowledgeMap) and to reject stored maps that fail the schema on read
// (loadKnowledgeMap), which guards against hand-edited or partially-migrated
// rows leaking malformed JSON downstream.
// ---------------------------------------------------------------------------

const eraIdSchema = z.enum(ERA_IDS);
const themeIdSchema = z.enum(THEME_IDS);
const examSkillSchema = z.enum(EXAM_SKILLS);
const competenceSchema = z.enum(COMPETENCE_LEVELS);
const skillStrengthSchema = z.enum(SKILL_STRENGTHS);
const factStrengthSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

const eraCompetenceSchema = z.object(
  Object.fromEntries(ERA_IDS.map((id) => [id, competenceSchema])) as Record<EraId, typeof competenceSchema>,
);
const themeCompetenceSchema = z.object(
  Object.fromEntries(THEME_IDS.map((id) => [id, competenceSchema])) as Record<ThemeId, typeof competenceSchema>,
);

export const KnowledgeMapSchema: z.ZodType<KnowledgeMap> = z.object({
  version: z.literal(1),
  last_updated_ms: z.number().int().nonnegative(),
  era_competence: eraCompetenceSchema,
  theme_competence: themeCompetenceSchema,
  known_facts: z.array(
    z.object({
      fact: z.string().min(1),
      first_demonstrated_turn_id: z.number().int().positive(),
      last_confirmed_turn_id: z.number().int().positive(),
      strength: factStrengthSchema,
    }),
  ),
  misconceptions: z.array(
    z.object({
      description: z.string().min(1),
      first_observed_turn_id: z.number().int().positive(),
      addressed: z.boolean(),
      addressed_turn_id: z.number().int().positive().optional(),
    }),
  ),
  skills_demonstrated: z.array(
    z.object({
      skill: examSkillSchema,
      strength: skillStrengthSchema,
      last_observed_turn_id: z.number().int().positive(),
    }),
  ),
  weak_areas: z.array(z.string().min(1)),
  diagnostic_notes: z.string(),
});

/**
 * Build a fresh empty knowledge map. Used as the default when no row exists
 * yet (Stage 4's first evaluation will populate fields). Caller is
 * responsible for persisting if desired.
 */
export function emptyKnowledgeMap(nowMs: number = Date.now()): KnowledgeMap {
  const eraCompetence = Object.fromEntries(
    ERA_IDS.map((id) => [id, 'untested' as const]),
  ) as Record<EraId, Competence>;
  const themeCompetence = Object.fromEntries(
    THEME_IDS.map((id) => [id, 'untested' as const]),
  ) as Record<ThemeId, Competence>;
  return {
    version: 1,
    last_updated_ms: nowMs,
    era_competence: eraCompetence,
    theme_competence: themeCompetence,
    known_facts: [],
    misconceptions: [],
    skills_demonstrated: [],
    weak_areas: [],
    diagnostic_notes: '',
  };
}
