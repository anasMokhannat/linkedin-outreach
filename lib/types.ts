/** Shared domain types mirroring the Supabase schema (spec §7). */

export type AccountStatus = 'connected' | 'needs_reauth' | 'disconnected';

export type MessageStatus =
  | 'draft'
  | 'approved'
  | 'queued'
  | 'sent'
  | 'failed'
  | 'rejected';

export type QueueStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface LinkedInAccount {
  id: string;
  user_id: string;
  li_secret_id: string | null;
  status: AccountStatus;
  proxy_country: string | null;
  last_validated: string | null;
  created_at: string;
}

export interface Lead {
  id: string;
  user_id: string;
  profile_url: string;
  first_name: string | null;
  last_name: string | null;
  headline: string | null;
  current_company: string | null;
  current_title: string | null;
  location: string | null;
  school: string | null;
  industry: string | null;
  enriched_at: string | null;
  created_at: string;
}

export interface LeadEnrichment {
  id: string;
  lead_id: string;
  user_id: string;
  recent_posts: unknown;
  company: unknown;
  raw: unknown;
  created_at: string;
}

export interface Message {
  id: string;
  user_id: string;
  lead_id: string;
  body: string;
  model: string | null;
  status: MessageStatus;
  edited_by_user: boolean;
  approved_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A connection staged in the Apify dataset (transient, never persisted raw). */
export interface StagedConnection {
  fullName: string;
  firstName?: string;
  lastName?: string;
  headline?: string;
  profileUrl: string;
  company?: string;
  title?: string;
}

/** Tier-1 filter operates on staging (name, company/role from headline). */
export interface Tier1Filters {
  q?: string; // name search
  company?: string;
  role?: string;
}
