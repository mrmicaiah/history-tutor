import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { extractCards, persistCards, type ParsedCard } from './cards';
import { CONVERSATION_ID, MAX_CARDS_PER_MESSAGE } from '../config';
import { dbCtx, insertTurn, resetTables } from '../test/helpers';

describe('cards.extractCards', () => {
  it('returns the reply unchanged and empty cards when there is no block', () => {
    const reply = 'Who unified the Mongols in 1206?';
    const out = extractCards(reply);
    expect(out.visibleReply).toBe(reply);
    expect(out.cards).toEqual([]);
  });

  it('extracts a single card and strips the block', () => {
    const reply = `Genghis Khan unified the Mongols in 1206. Want to dig into the campaigns next?

<cards>
[[Genghis Khan | person | Mongol founder who unified the steppe tribes in 1206 | exchange | governance]]
</cards>`;
    const { visibleReply, cards } = extractCards(reply);
    expect(visibleReply).not.toContain('<cards>');
    expect(visibleReply.endsWith('next?')).toBe(true);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject<ParsedCard>({
      term: 'Genghis Khan',
      category: 'person',
      definition: 'Mongol founder who unified the steppe tribes in 1206',
      era: 'exchange',
      theme: 'governance',
    });
  });

  it('extracts multiple cards from one block', () => {
    const reply = `Two figures worth knowing here.

<cards>
[[Mansa Musa | person | Mali ruler whose 1324 hajj displayed Saharan gold wealth | tapestry | economics]]
[[Treaty of Tordesillas | event | 1494 papal-mediated split of the non-European world between Spain and Portugal | transoceanic | governance]]
</cards>`;
    const { cards } = extractCards(reply);
    expect(cards).toHaveLength(2);
    expect(cards[0]?.term).toBe('Mansa Musa');
    expect(cards[1]?.term).toBe('Treaty of Tordesillas');
  });

  it('skips malformed lines but keeps valid ones', () => {
    const reply = `Mixed content.

<cards>
[[ValidTerm | person | a valid definition | tapestry | economics]]
[[BadCategory | wizard | not a real category | tapestry | economics]]
not even a card line
[[ | person | empty term not allowed | tapestry | economics]]
[[AnotherValid | event | valid event definition | exchange | culture]]
</cards>`;
    const { cards } = extractCards(reply);
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.term)).toEqual(['ValidTerm', 'AnotherValid']);
  });

  it(`caps at ${MAX_CARDS_PER_MESSAGE} cards`, () => {
    const lines = Array.from({ length: 10 }, (_, i) =>
      `[[Term${i} | term | definition ${i} | tapestry | economics]]`,
    ).join('\n');
    const reply = `intro\n\n<cards>\n${lines}\n</cards>`;
    const { cards } = extractCards(reply);
    expect(cards).toHaveLength(MAX_CARDS_PER_MESSAGE);
    expect(cards[0]?.term).toBe('Term0');
    expect(cards[MAX_CARDS_PER_MESSAGE - 1]?.term).toBe(`Term${MAX_CARDS_PER_MESSAGE - 1}`);
  });

  it('returns null era/theme when those fields are blank', () => {
    const reply = `<cards>
[[Cross-era concept | concept | something general |  | ]]
</cards>`;
    const { cards } = extractCards(reply);
    expect(cards[0]?.era).toBeNull();
    expect(cards[0]?.theme).toBeNull();
  });
});

describe('cards.persistCards', () => {
  beforeEach(async () => {
    await resetTables();
  });

  async function seedTurn(): Promise<number> {
    return insertTurn(CONVERSATION_ID, 'assistant', 'tutor reply', Date.now());
  }

  it('inserts new cards', async () => {
    const turnId = await seedTurn();
    const cards: ParsedCard[] = [
      { term: 'Mansa Musa', category: 'person', definition: 'Mali ruler', era: 'tapestry', theme: 'economics' },
      { term: 'Silk Road', category: 'concept', definition: 'Trans-Eurasian trade network', era: 'exchange', theme: 'economics' },
    ];
    const counts = await persistCards(dbCtx(), CONVERSATION_ID, turnId, cards);
    expect(counts).toEqual({ created: 2, updated: 0 });

    const row = await env.DB
      .prepare('SELECT COUNT(*) AS c FROM reference_cards WHERE conversation_id = ?')
      .bind(CONVERSATION_ID)
      .first<{ c: number }>();
    expect(row?.c).toBe(2);
  });

  it('de-duplicates: re-persisting an existing term updates instead of inserting', async () => {
    const turnId = await seedTurn();
    const card: ParsedCard = {
      term: 'Mansa Musa',
      category: 'person',
      definition: 'Mali ruler',
      era: 'tapestry',
      theme: 'economics',
    };
    await persistCards(dbCtx(), CONVERSATION_ID, turnId, [card]);
    const counts = await persistCards(dbCtx(), CONVERSATION_ID, turnId, [card]);
    expect(counts).toEqual({ created: 0, updated: 1 });

    const row = await env.DB
      .prepare('SELECT COUNT(*) AS c, MAX(times_reviewed) AS r FROM reference_cards WHERE conversation_id = ?')
      .bind(CONVERSATION_ID)
      .first<{ c: number; r: number }>();
    expect(row?.c).toBe(1);
    expect(row?.r).toBe(1);
  });

  it('updates the definition when the new definition differs', async () => {
    const turnId = await seedTurn();
    await persistCards(dbCtx(), CONVERSATION_ID, turnId, [
      {
        term: 'Mansa Musa',
        category: 'person',
        definition: 'Mali ruler',
        era: 'tapestry',
        theme: 'economics',
      },
    ]);
    await persistCards(dbCtx(), CONVERSATION_ID, turnId, [
      {
        term: 'Mansa Musa',
        category: 'person',
        definition: 'Mali ruler whose 1324 hajj displayed Saharan gold wealth',
        era: 'tapestry',
        theme: 'economics',
      },
    ]);
    const row = await env.DB
      .prepare('SELECT definition FROM reference_cards WHERE term = ?')
      .bind('Mansa Musa')
      .first<{ definition: string }>();
    expect(row?.definition).toBe('Mali ruler whose 1324 hajj displayed Saharan gold wealth');
  });
});
