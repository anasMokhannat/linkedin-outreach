import 'server-only';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Debug logger for enrichment: appends the raw API JSON we get for each lead to
 * a plain-text file at the project root (enrichment-log.txt). Best-effort — any
 * failure is swallowed so it can never break enrichment. Works when running a
 * long-lived Node server (`next start` / `next dev`); on serverless the file
 * isn't persistent.
 */
const LOG_PATH = path.join(process.cwd(), 'enrichment-log.txt');

export async function logEnrichmentRaw(entry: {
  leadId: string;
  identifier: string;
  name: string | null;
  throttledSections: string[];
  company: string | null;
  title: string | null;
  email: string | null;
  experiencesCount: number;
  profileRaw: unknown;
  posts: unknown;
  companyRaw: unknown;
}): Promise<void> {
  try {
    const dash = (v: string | null) => (v && v.trim() ? v : '—');
    const throttled = entry.throttledSections.length ? `[${entry.throttledSections.join(', ')}]` : '(none)';
    const block =
      `\n===== ${new Date().toISOString()} | lead=${entry.leadId} | ${dash(entry.name)} =====\n` +
      `throttled_sections: ${throttled}\n` +
      `experience: ${entry.throttledSections.includes('experience') ? 'THROTTLED (empty)' : `${entry.experiencesCount} role(s)`}\n` +
      `resolved: company=${dash(entry.company)} | title=${dash(entry.title)} | email=${dash(entry.email)}\n` +
      `--- profile (raw API json) ---\n${JSON.stringify(entry.profileRaw, null, 2)}\n` +
      `--- posts ---\n${JSON.stringify(entry.posts, null, 2)}\n` +
      `--- company ---\n${JSON.stringify(entry.companyRaw, null, 2)}\n`;
    await appendFile(LOG_PATH, block, 'utf8');
  } catch {
    /* never break enrichment because of logging */
  }
}

/** Append a failed enrichment attempt (so missing leads can be investigated). */
export async function logEnrichmentError(entry: {
  leadId: string;
  identifier: string;
  stage: string;
  error: string;
}): Promise<void> {
  try {
    const block =
      `\n===== ${new Date().toISOString()} | lead=${entry.leadId} | identifier=${entry.identifier} | FAILED (${entry.stage}) =====\n` +
      `${entry.error}\n`;
    await appendFile(LOG_PATH, block, 'utf8');
  } catch {
    /* never break enrichment because of logging */
  }
}
