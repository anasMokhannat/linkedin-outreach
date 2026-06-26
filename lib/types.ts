/** Shared domain types. Identity = the connected LinkedIn account (the tenant). */

export type AccountStatus = 'connected' | 'needs_reauth' | 'disconnected';

export type MessageStatus = 'draft' | 'approved' | 'sent' | 'failed' | 'rejected';

export interface LinkedInAccount {
  id: string;
  unipile_account_id: string | null;
  display_name: string | null;
  status: AccountStatus;
  proxy_country: string | null;
  dms_per_day: number;
  leads_to_message: number;
  last_validated: string | null;
  created_at: string;
}

export interface Lead {
  id: string;
  account_id: string;
  profile_url: string;
  provider_member_id: string | null;
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

export interface Message {
  id: string;
  account_id: string;
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

/** A connection staged transiently (from a Unipile relations sync). */
export interface StagedConnection {
  fullName: string;
  firstName?: string;
  lastName?: string;
  headline?: string;
  profileUrl: string;
  company?: string;
  title?: string;
  /** Provider-internal recipient id (Unipile member_id) used to message them. */
  providerId?: string;
}
