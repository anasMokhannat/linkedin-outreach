import 'server-only';
import {
  ProviderNotImplementedError,
  type LinkedInProvider,
  type FetchConnectionsInput,
  type FetchConnectionsResult,
  type SendMessageInput,
  type SendMessageResult,
} from './types';

/**
 * Official LinkedIn-API provider — STUB.
 *
 * The standard LinkedIn API cannot list a member's 1st-degree connections or
 * send member-to-member DMs (spec §1). These require LinkedIn Partner Program
 * access:
 *   - Connections: historically the deprecated `r_network` / Connections API;
 *     today only via approved partner programs.
 *   - Messaging: the Messaging API, gated to Sales Navigator / Marketing partners.
 *
 * When access is confirmed, implement these against the granted endpoints. Both
 * would be SYNC (paginated REST returning results inline):
 *
 *   fetchConnections -> GET the connections endpoint with the member's OAuth
 *     access token (scope granted by the partner program), page through results,
 *     map to StagedConnection[], and return { mode: 'sync', connections }.
 *
 *   sendMessage -> POST to the messaging/conversations endpoint with the access
 *     token; on success return { mode: 'sync', delivered: true }.
 *
 * The OAuth access token would come from the user's stored LinkedIn tokens
 * (TODO(confirm): persist provider tokens on login, or use a partner app token).
 * Note requiresCookie = false: this provider does NOT use the li_at cookie.
 */
export class LinkedInApiProvider implements LinkedInProvider {
  readonly name = 'linkedin-api' as const;
  readonly requiresCookie = false;

  async fetchConnections(_input: FetchConnectionsInput): Promise<FetchConnectionsResult> {
    throw new ProviderNotImplementedError(
      'LINKEDIN_PROVIDER=linkedin-api: listing connections requires LinkedIn Partner ' +
        'access. Implement LinkedInApiProvider.fetchConnections against your granted ' +
        'endpoint, or set LINKEDIN_PROVIDER=apify.'
    );
  }

  async sendMessage(_input: SendMessageInput): Promise<SendMessageResult> {
    throw new ProviderNotImplementedError(
      'LINKEDIN_PROVIDER=linkedin-api: sending DMs requires LinkedIn Messaging API ' +
        '(partner-gated). Implement LinkedInApiProvider.sendMessage against your granted ' +
        'endpoint, or set LINKEDIN_PROVIDER=apify.'
    );
  }
}
