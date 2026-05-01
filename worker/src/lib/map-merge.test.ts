import { describe, expect, it } from 'vitest';
import { mergeEvaluation } from './map-merge';
import {
  emptyKnowledgeMap,
  type KnowledgeMap,
} from '../types/knowledge-map';
import type { EvaluationResult } from '../types/evaluation';
import { MAX_DIAGNOSTIC_NOTES_CHARS, MAX_WEAK_AREAS } from '../config';

function makeEval(partial: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    facts_demonstrated: [],
    facts_struggled: [],
    misconceptions_observed: [],
    misconceptions_addressed: [],
    skills_observed: [],
    era_competence_signals: [],
    theme_competence_signals: [],
    diagnostic_note: '',
    ...partial,
  };
}

describe('mergeEvaluation', () => {
  it('appends new known_facts', () => {
    const out = mergeEvaluation(
      emptyKnowledgeMap(),
      makeEval({ facts_demonstrated: [{ fact: 'Mansa Musa ruled Mali' }] }),
      1,
    );
    expect(out.known_facts).toHaveLength(1);
    expect(out.known_facts[0]).toMatchObject({
      fact: 'Mansa Musa ruled Mali',
      first_demonstrated_turn_id: 1,
      last_confirmed_turn_id: 1,
      strength: 1,
    });
  });

  it('increments strength for repeated facts (capped at 3)', () => {
    let map = emptyKnowledgeMap();
    for (let i = 1; i <= 5; i++) {
      map = mergeEvaluation(
        map,
        makeEval({ facts_demonstrated: [{ fact: 'The Columbian Exchange transferred maize to Eurasia' }] }),
        i,
      );
    }
    expect(map.known_facts).toHaveLength(1);
    expect(map.known_facts[0]?.strength).toBe(3);
    expect(map.known_facts[0]?.last_confirmed_turn_id).toBe(5);
  });

  it('appends new misconceptions with addressed=false', () => {
    const out = mergeEvaluation(
      emptyKnowledgeMap(),
      makeEval({
        misconceptions_observed: [{ description: 'Believes the Industrial Revolution started in France' }],
      }),
      7,
    );
    expect(out.misconceptions).toHaveLength(1);
    expect(out.misconceptions[0]).toMatchObject({
      description: 'Believes the Industrial Revolution started in France',
      first_observed_turn_id: 7,
      addressed: false,
    });
  });

  it('marks misconceptions addressed when the eval says so', () => {
    let map = mergeEvaluation(
      emptyKnowledgeMap(),
      makeEval({
        misconceptions_observed: [{ description: 'Confuses the Treaty of Tordesillas with the Treaty of Westphalia' }],
      }),
      4,
    );
    map = mergeEvaluation(
      map,
      makeEval({
        misconceptions_addressed: [{ description: 'Treaty of Tordesillas with the Treaty of Westphalia' }],
      }),
      6,
    );
    expect(map.misconceptions).toHaveLength(1);
    expect(map.misconceptions[0]?.addressed).toBe(true);
    expect(map.misconceptions[0]?.addressed_turn_id).toBe(6);
  });

  it('upgrades era_competence on a positive signal', () => {
    const out = mergeEvaluation(
      emptyKnowledgeMap(),
      makeEval({ era_competence_signals: [{ era: 'tapestry', signal: 'familiar' }] }),
      1,
    );
    expect(out.era_competence['tapestry']).toBe('familiar');
  });

  it('does NOT downgrade "solid" on a "familiar" signal', () => {
    const map = emptyKnowledgeMap();
    map.era_competence['tapestry'] = 'solid';
    const out = mergeEvaluation(
      map,
      makeEval({ era_competence_signals: [{ era: 'tapestry', signal: 'familiar' }] }),
      1,
    );
    expect(out.era_competence['tapestry']).toBe('solid');
  });

  it('downgrades "solid" to "shaky" on an explicit "shaky" signal', () => {
    const map = emptyKnowledgeMap();
    map.era_competence['tapestry'] = 'solid';
    const out = mergeEvaluation(
      map,
      makeEval({ era_competence_signals: [{ era: 'tapestry', signal: 'shaky' }] }),
      1,
    );
    expect(out.era_competence['tapestry']).toBe('shaky');
  });

  it('truncates weak_areas at the configured cap (oldest dropped)', () => {
    let map = emptyKnowledgeMap();
    const total = MAX_WEAK_AREAS + 5;
    for (let i = 0; i < total; i++) {
      map = mergeEvaluation(
        map,
        makeEval({ facts_struggled: [{ fact: `weak-area-${i}` }] }),
        i + 1,
      );
    }
    expect(map.weak_areas).toHaveLength(MAX_WEAK_AREAS);
    expect(map.weak_areas[0]).toBe(`weak-area-${total - MAX_WEAK_AREAS}`);
    expect(map.weak_areas[MAX_WEAK_AREAS - 1]).toBe(`weak-area-${total - 1}`);
  });

  it('truncates diagnostic_notes at ~MAX_DIAGNOSTIC_NOTES_CHARS', () => {
    let map = emptyKnowledgeMap();
    const longNote = 'x'.repeat(800);
    for (let i = 0; i < 6; i++) {
      map = mergeEvaluation(map, makeEval({ diagnostic_note: longNote }), i + 1);
    }
    expect(map.diagnostic_notes.length).toBeLessThanOrEqual(MAX_DIAGNOSTIC_NOTES_CHARS);
  });

  it('rejects invalid input via the schema validator', () => {
    const corrupt = { ...emptyKnowledgeMap(), version: 99 } as unknown as KnowledgeMap;
    expect(() => mergeEvaluation(corrupt, makeEval(), 1)).toThrow(/invalid knowledge map/i);
  });
});
