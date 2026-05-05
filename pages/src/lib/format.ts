/**
 * Text and date formatters used across views.
 */

const RELATIVE_FORMAT = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "5 minutes ago" / "yesterday" / "2 days ago" — coarse buckets only. */
export function relativeTime(ms: number | null, now: number = Date.now()): string {
  if (ms === null) return 'never';
  const deltaSeconds = Math.round((ms - now) / 1000);
  const abs = Math.abs(deltaSeconds);
  if (abs < 60) return RELATIVE_FORMAT.format(deltaSeconds, 'second');
  if (abs < 3600) return RELATIVE_FORMAT.format(Math.round(deltaSeconds / 60), 'minute');
  if (abs < 86400) return RELATIVE_FORMAT.format(Math.round(deltaSeconds / 3600), 'hour');
  return RELATIVE_FORMAT.format(Math.round(deltaSeconds / 86400), 'day');
}

const ERA_LABELS: Record<string, string> = {
  tapestry: 'Tapestry',
  exchange: 'Exchange',
  'land-empires': 'Land Empires',
  transoceanic: 'Transoceanic',
  revolutions: 'Revolutions',
  industrial: 'Industrial',
  'global-conflict': 'Global Conflict',
  'cold-war': 'Cold War',
  globalization: 'Globalization',
};

const THEME_LABELS: Record<string, string> = {
  governance: 'Governance',
  economics: 'Economics',
  culture: 'Culture',
  social: 'Social',
  technology: 'Technology',
  environment: 'Environment',
};

export function eraLabel(id: string): string {
  return ERA_LABELS[id] ?? id;
}

export function themeLabel(id: string): string {
  return THEME_LABELS[id] ?? id;
}

/**
 * Strip any residual reference-card markup from an assistant reply at render
 * time. The worker already scrubs replies before persisting (see
 * `worker/src/lib/cards.ts::scrubVisibleReply`), but historical turns persisted
 * before that safeguard landed may still contain raw `<cards>` blocks or
 * `[[term | category | ...]]` lines. Mirroring the worker's regexes here
 * cleans those up at display time without touching the database.
 */
export function scrubReply(text: string): string {
  return text
    .replace(/<cards>[\s\S]*?<\/cards>/gi, '')
    .replace(/<cards>[\s\S]*$/i, '')
    .replace(/<\/?cards>/gi, '')
    .replace(/\[\[[^\]]*?\]\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
