import type { StagedConnection } from '../types';

/**
 * Provider abstraction for the two operations that touch LinkedIn directly:
 * fetching 1st-degree connections and sending a DM. This lets the app swap
 * between the cookie-based Apify path and an official LinkedIn-API path by
 * config, without changing route logic.
 *
 * IMPORTANT (spec §1): the official LinkedIn API cannot list connections or send
 * member-to-member DMs for standard apps — those endpoints are gated behind the
 * LinkedIn Partner Program (Sales Navigator / Marketing Developer Platform). The
 * 'linkedin-api' provider is therefore a stub until such access is confirmed.
 *
 * Execution models differ, so results are a discriminated union:
 *   - 'async': work was started remotely; a webhook finalizes it (Apify model).
 *   - 'sync':  work completed inline and the result is returned directly
 *              (the shape an official REST API would take).
 */

export type ProviderName = 'apify' | 'linkedin-api';

export interface FetchConnectionsInput {
  userId: string;
  accountId: string;
  /** Decrypted li_at cookie. Empty/ignored for providers where requiresCookie is false. */
  liAt: string;
  proxyCountry: string | null;
}

export type FetchConnectionsResult =
  | { mode: 'async'; runId: string; datasetId: string | null }
  | { mode: 'sync'; connections: StagedConnection[] };

export interface SendMessageInput {
  userId: string;
  messageId: string;
  queueId: string;
  liAt: string;
  proxyCountry: string | null;
  profileUrl?: string;
  body: string;
}

export type SendMessageResult =
  | { mode: 'async'; runId: string }
  | { mode: 'sync'; delivered: true };

export interface LinkedInProvider {
  readonly name: ProviderName;
  /**
   * Whether this provider needs the decrypted li_at cookie. When false, the
   * caller skips Vault decryption (the official-API provider uses an OAuth token
   * instead).
   */
  readonly requiresCookie: boolean;

  fetchConnections(input: FetchConnectionsInput): Promise<FetchConnectionsResult>;
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
}

/** Thrown by a provider whose capability is not available/implemented. */
export class ProviderNotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderNotImplementedError';
  }
}
