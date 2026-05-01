/**
 * Canonical curriculum identifiers used by the knowledge map.
 *
 * The string-literal IDs are the API contract -- they end up in stored JSON
 * (knowledge_map.data) and are referenced by Stage 4's evaluation prompts.
 * Renaming any of them is a schema break; bump the knowledge map's `version`
 * and write a migration if it ever happens.
 */

/** The 9 AP World History: Modern units (College Board's curriculum). */
export const ERA_IDS = [
  'tapestry',         // c. 1200 to c. 1450 -- Global Tapestry
  'exchange',         // c. 1200 to c. 1450 -- Networks of Exchange
  'land-empires',     // c. 1450 to c. 1750 -- Land-Based Empires
  'transoceanic',     // c. 1450 to c. 1750 -- Transoceanic Interconnections
  'revolutions',      // c. 1750 to c. 1900 -- Revolutions
  'industrial',       // c. 1750 to c. 1900 -- Consequences of Industrialization
  'global-conflict',  // c. 1900 to present -- Global Conflict
  'cold-war',         // c. 1900 to present -- Cold War & Decolonization
  'globalization',    // c. 1900 to present -- Globalization
] as const;
export type EraId = (typeof ERA_IDS)[number];

/** AP World History thematic learning objectives (College Board "themes"). */
export const THEME_IDS = [
  'governance',
  'economics',
  'culture',
  'social',
  'technology',
  'environment',
] as const;
export type ThemeId = (typeof THEME_IDS)[number];

/** Historical thinking skills assessed by the AP exam. */
export const EXAM_SKILLS = [
  'comparison',
  'causation',
  'ccot',              // Continuity & Change Over Time
  'contextualization',
  'sourcing',
] as const;
export type ExamSkill = (typeof EXAM_SKILLS)[number];

/** Per-era / per-theme competence rating. */
export const COMPETENCE_LEVELS = ['untested', 'shaky', 'familiar', 'solid'] as const;
export type Competence = (typeof COMPETENCE_LEVELS)[number];

/** Per-skill rating (looser than Competence; 'untested' is implicit absence). */
export const SKILL_STRENGTHS = ['weak', 'developing', 'solid'] as const;
export type SkillStrength = (typeof SKILL_STRENGTHS)[number];

/** Repetition strength of a known fact: 1=once, 2=twice, 3=multiple. */
export type FactStrength = 1 | 2 | 3;

/**
 * Signal values the evaluation pass emits per era / theme. A subset of
 * Competence -- 'untested' is a starting state, never a signal: there is
 * no evidence of "the student demonstrated they don't know X".
 */
export const COMPETENCE_SIGNALS = ['shaky', 'familiar', 'solid'] as const;
export type CompetenceSignal = (typeof COMPETENCE_SIGNALS)[number];

/** Reference card categories. Mirrors the CHECK constraint in 0001_initial.sql. */
export const CARD_CATEGORIES = [
  'person',
  'event',
  'date',
  'place',
  'term',
  'concept',
] as const;
export type CardCategory = (typeof CARD_CATEGORIES)[number];
