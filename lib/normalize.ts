import type { StagedConnection } from './types';

/**
 * Apify actors return varying field names. These normalizers map common shapes
 * to our internal types so swapping a primary actor for a backup needs no other
 * code change. Be liberal in what we accept.
 *
 * TODO(confirm): validate exact field names against the chosen actors on real
 * profiles before launch (spec §5 caveats, §14.2).
 */

function pick(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function splitName(full?: string): { first?: string; last?: string } {
  if (!full) return {};
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

export function normalizeConnection(raw: Record<string, unknown>): StagedConnection | null {
  const profileUrl = pick(raw, ['profileUrl', 'profile_url', 'url', 'publicProfileUrl', 'link']);
  if (!profileUrl) return null;

  const fullName =
    pick(raw, ['fullName', 'name', 'full_name']) ??
    [pick(raw, ['firstName', 'first_name']), pick(raw, ['lastName', 'last_name'])]
      .filter(Boolean)
      .join(' ');

  const firstName = pick(raw, ['firstName', 'first_name']) ?? splitName(fullName).first;
  const lastName = pick(raw, ['lastName', 'last_name']) ?? splitName(fullName).last;

  return {
    profileUrl,
    fullName: fullName || profileUrl,
    firstName,
    lastName,
    headline: pick(raw, ['headline', 'occupation', 'subtitle', 'title']),
    company: pick(raw, ['company', 'companyName', 'currentCompany', 'company_name']),
    title: pick(raw, ['title', 'position', 'jobTitle']),
  };
}

export interface NormalizedProfile {
  firstName?: string;
  lastName?: string;
  headline?: string;
  currentCompany?: string;
  currentTitle?: string;
  location?: string;
  school?: string;
  industry?: string;
  companyAbout?: string;
}

export function normalizeProfile(raw: Record<string, unknown>): NormalizedProfile {
  const educations = (raw['educations'] ?? raw['education'] ?? raw['schools']) as
    | Array<Record<string, unknown>>
    | undefined;
  const school =
    pick(raw, ['school']) ??
    (Array.isArray(educations) && educations.length
      ? pick(educations[0], ['schoolName', 'school', 'title', 'name'])
      : undefined);

  const experiences = (raw['experiences'] ?? raw['experience'] ?? raw['positions']) as
    | Array<Record<string, unknown>>
    | undefined;
  const firstExp =
    Array.isArray(experiences) && experiences.length ? experiences[0] : undefined;

  return {
    firstName: pick(raw, ['firstName', 'first_name']),
    lastName: pick(raw, ['lastName', 'last_name']),
    headline: pick(raw, ['headline', 'occupation']),
    currentCompany:
      pick(raw, ['companyName', 'currentCompany', 'company']) ??
      (firstExp ? pick(firstExp, ['companyName', 'company', 'subtitle']) : undefined),
    currentTitle:
      pick(raw, ['jobTitle', 'currentTitle', 'title']) ??
      (firstExp ? pick(firstExp, ['title', 'position']) : undefined),
    location: pick(raw, ['location', 'locationName', 'geoLocationName', 'addressWithCountry']),
    school,
    industry: pick(raw, ['industry', 'industryName']),
    companyAbout: pick(raw, ['companyDescription', 'about', 'summary']),
  };
}

export interface NormalizedPost {
  text: string;
  url?: string;
  likes?: number;
}

export function normalizePosts(items: Array<Record<string, unknown>>): NormalizedPost[] {
  return items
    .map((raw) => {
      const text = pick(raw, ['text', 'content', 'postText', 'commentary', 'description']);
      if (!text) return null;
      const likesRaw = raw['likes'] ?? raw['numLikes'] ?? raw['reactions'] ?? raw['likesCount'];
      return {
        text: text.length > 600 ? text.slice(0, 600) : text,
        url: pick(raw, ['url', 'postUrl', 'link']),
        likes: typeof likesRaw === 'number' ? likesRaw : undefined,
      } as NormalizedPost;
    })
    .filter((p): p is NormalizedPost => p !== null);
}
