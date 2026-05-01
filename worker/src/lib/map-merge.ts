import { log } from './logger';
import {
  KnowledgeMapSchema,
  type KnowledgeMap,
} from '../types/knowledge-map';
import type { EvaluationResult } from '../types/evaluation';
import type {
  Competence,
  CompetenceSignal,
  FactStrength,
  SkillStrength,
} from '../types/curriculum';
import {
  MAX_DIAGNOSTIC_NOTES_CHARS,
  MAX_WEAK_AREAS,
  MAX_WEAK_AREA_CHARS,
  SKILL_FORGET_THRESHOLD_TURNS,
} from '../config';

/**
 * Deterministic merge of an `EvaluationResult` into a `KnowledgeMap`.
 *
 * No LLM judgment lives here — the eval pass already exercised the LLM and
 * produced the structured result. This file only does arithmetic on it. That
 * separation keeps the map predictable: given the same eval and the same
 * input map, the output is bit-for-bit identical.
 *
 * `mergeEvaluation` returns a NEW map. The input map is not mutated. The
 * output is validated against `KnowledgeMapSchema` before returning so a
 * merge bug can't silently corrupt persisted state.
 */

const SKILL_RANK: Record<SkillStrength, 1 | 2 | 3> = {
  weak: 1,
  developing: 2,
  solid: 3,
};
const RANK_TO_SKILL: ReadonlyArray<SkillStrength> = ['weak', 'developing', 'solid'];

const NOTES_SEPARATOR = '\n---\n';
const TRUNCATION_PREFIX = '...';

/**
 * Merge an evaluation result into the knowledge map. See module doc comment
 * for rules. `studentTurnId` is recorded into per-fact / per-misconception
 * timestamps so future evaluations can reason about recency.
 */
export function mergeEvaluation(
  currentMap: KnowledgeMap,
  evaluation: EvaluationResult,
  studentTurnId: number,
): KnowledgeMap {
  const map = structuredClone(currentMap);

  applyFactsDemonstrated(map, evaluation.facts_demonstrated, studentTurnId);
  applyFactsStruggled(map, evaluation.facts_struggled);
  applyMisconceptionsObserved(map, evaluation.misconceptions_observed, studentTurnId);
  applyMisconceptionsAddressed(map, evaluation.misconceptions_addressed, studentTurnId);
  applySkills(map, evaluation.skills_observed, studentTurnId);
  applyEraSignals(map, evaluation.era_competence_signals);
  applyThemeSignals(map, evaluation.theme_competence_signals);
  applyWeakAreas(map, evaluation.facts_struggled);
  applyDiagnosticNote(map, evaluation.diagnostic_note);

  map.last_updated_ms = Date.now();

  const validated = KnowledgeMapSchema.safeParse(map);
  if (!validated.success) {
    throw new Error(
      `mergeEvaluation produced an invalid knowledge map: ${JSON.stringify(validated.error.issues)}`,
    );
  }
  return validated.data;
}

// ---------------------------------------------------------------------------
// Per-section appliers
// ---------------------------------------------------------------------------

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

function applyFactsDemonstrated(
  map: KnowledgeMap,
  facts: ReadonlyArray<{ fact: string }>,
  studentTurnId: number,
): void {
  for (const { fact } of facts) {
    const norm = normalize(fact);
    const existing = map.known_facts.find((f) => normalize(f.fact) === norm);
    if (existing) {
      existing.strength = Math.min(3, existing.strength + 1) as FactStrength;
      existing.last_confirmed_turn_id = studentTurnId;
    } else {
      map.known_facts.push({
        fact: fact.trim(),
        first_demonstrated_turn_id: studentTurnId,
        last_confirmed_turn_id: studentTurnId,
        strength: 1,
      });
    }
  }
}

function applyFactsStruggled(
  map: KnowledgeMap,
  facts: ReadonlyArray<{ fact: string }>,
): void {
  for (const { fact } of facts) {
    const norm = normalize(fact);
    const existing = map.known_facts.find((f) => normalize(f.fact) === norm);
    if (existing && existing.strength > 1) {
      existing.strength = (existing.strength - 1) as FactStrength;
    }
  }
}

function applyMisconceptionsObserved(
  map: KnowledgeMap,
  observed: ReadonlyArray<{ description: string }>,
  studentTurnId: number,
): void {
  for (const { description } of observed) {
    const lower = description.toLowerCase();
    const existing = map.misconceptions.find((m) => fuzzyMatch(m.description, lower));
    if (existing) {
      if (studentTurnId < existing.first_observed_turn_id) {
        existing.first_observed_turn_id = studentTurnId;
      }
    } else {
      map.misconceptions.push({
        description: description.trim(),
        first_observed_turn_id: studentTurnId,
        addressed: false,
      });
    }
  }
}

function applyMisconceptionsAddressed(
  map: KnowledgeMap,
  addressed: ReadonlyArray<{ description: string }>,
  studentTurnId: number,
): void {
  for (const { description } of addressed) {
    const lower = description.toLowerCase();
    const target = map.misconceptions.find(
      (m) => !m.addressed && fuzzyMatch(m.description, lower),
    );
    if (target) {
      target.addressed = true;
      target.addressed_turn_id = studentTurnId;
    } else {
      log.warn('misconception_addressed_no_match', { description });
    }
  }
}

/** Case-insensitive substring match in either direction. */
function fuzzyMatch(stored: string, needleLower: string): boolean {
  const storedLower = stored.toLowerCase();
  return storedLower.includes(needleLower) || needleLower.includes(storedLower);
}

function applySkills(
  map: KnowledgeMap,
  observed: ReadonlyArray<{ skill: SkillStrength | string; strength: SkillStrength }>,
  studentTurnId: number,
): void {
  for (const obs of observed) {
    const skill = obs.skill as KnowledgeMap['skills_demonstrated'][number]['skill'];
    const existing = map.skills_demonstrated.find((s) => s.skill === skill);
    if (!existing) {
      map.skills_demonstrated.push({
        skill,
        strength: obs.strength,
        last_observed_turn_id: studentTurnId,
      });
      continue;
    }
    const ageDelta = studentTurnId - existing.last_observed_turn_id;
    if (ageDelta > SKILL_FORGET_THRESHOLD_TURNS) {
      existing.strength = obs.strength;
    } else {
      const maxRank = Math.max(SKILL_RANK[existing.strength], SKILL_RANK[obs.strength]);
      existing.strength = RANK_TO_SKILL[maxRank - 1]!;
    }
    existing.last_observed_turn_id = studentTurnId;
  }
}

function applyEraSignals(
  map: KnowledgeMap,
  signals: ReadonlyArray<{ era: keyof KnowledgeMap['era_competence']; signal: CompetenceSignal }>,
): void {
  for (const { era, signal } of signals) {
    map.era_competence[era] = stepCompetence(map.era_competence[era], signal);
  }
}

function applyThemeSignals(
  map: KnowledgeMap,
  signals: ReadonlyArray<{ theme: keyof KnowledgeMap['theme_competence']; signal: CompetenceSignal }>,
): void {
  for (const { theme, signal } of signals) {
    map.theme_competence[theme] = stepCompetence(map.theme_competence[theme], signal);
  }
}

/**
 * Apply a single competence signal to a current value.
 *   - `untested` accepts any signal as the new value.
 *   - `solid` only steps down when the signal is the explicit `shaky`.
 *   - `familiar` upgrades to `solid` on a `solid` signal; otherwise stays
 *     (hysteresis: a single shaky signal isn't enough to demote).
 *   - `shaky` upgrades on `familiar` / `solid`, otherwise stays.
 */
function stepCompetence(current: Competence, signal: CompetenceSignal): Competence {
  if (current === 'untested') return signal;
  if (current === 'solid') return signal === 'shaky' ? 'shaky' : 'solid';
  if (current === 'familiar') return signal === 'solid' ? 'solid' : 'familiar';
  // current === 'shaky'
  if (signal === 'solid') return 'solid';
  if (signal === 'familiar') return 'familiar';
  return 'shaky';
}

function applyWeakAreas(
  map: KnowledgeMap,
  facts: ReadonlyArray<{ fact: string }>,
): void {
  for (const { fact } of facts) {
    const truncated = fact.length > MAX_WEAK_AREA_CHARS ? fact.slice(0, MAX_WEAK_AREA_CHARS) : fact;
    const lower = truncated.toLowerCase();
    if (!map.weak_areas.some((w) => w.toLowerCase() === lower)) {
      map.weak_areas.push(truncated);
    }
  }
  if (map.weak_areas.length > MAX_WEAK_AREAS) {
    map.weak_areas = map.weak_areas.slice(map.weak_areas.length - MAX_WEAK_AREAS);
  }
}

function applyDiagnosticNote(map: KnowledgeMap, note: string): void {
  const trimmed = note.trim();
  if (trimmed.length === 0) return;
  map.diagnostic_notes =
    map.diagnostic_notes.length > 0
      ? `${map.diagnostic_notes}${NOTES_SEPARATOR}${trimmed}`
      : trimmed;
  if (map.diagnostic_notes.length > MAX_DIAGNOSTIC_NOTES_CHARS) {
    const overflow = map.diagnostic_notes.length - MAX_DIAGNOSTIC_NOTES_CHARS;
    map.diagnostic_notes = TRUNCATION_PREFIX + map.diagnostic_notes.slice(overflow + TRUNCATION_PREFIX.length);
  }
}
