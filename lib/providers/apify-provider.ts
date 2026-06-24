import 'server-only';
import { startActorRun, residentialProxy } from '../apify';
import type {
  LinkedInProvider,
  FetchConnectionsInput,
  FetchConnectionsResult,
  SendMessageInput,
  SendMessageResult,
} from './types';

/**
 * Cookie-based provider using Apify actors. Both operations are ASYNC: we start
 * an actor run and a webhook (/api/webhooks/apify) finalizes it. This is the
 * default, working implementation.
 */
export class ApifyProvider implements LinkedInProvider {
  readonly name = 'apify' as const;
  readonly requiresCookie = true;

  async fetchConnections(input: FetchConnectionsInput): Promise<FetchConnectionsResult> {
    const run = await startActorRun('connections', {
      input: {
        // TODO(confirm): exact input schema of APIFY_ACTOR_CONNECTIONS.
        cookie: [{ name: 'li_at', value: input.liAt, domain: '.linkedin.com' }],
        li_at: input.liAt,
        proxy: residentialProxy(input.proxyCountry),
        maxResults: 5000,
      },
      proxyCountry: input.proxyCountry,
      webhookPayload: {
        userId: input.userId,
        action: 'sync_connections',
        accountId: input.accountId,
      },
    });
    return { mode: 'async', runId: run.runId, datasetId: run.defaultDatasetId };
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const run = await startActorRun('sendDm', {
      input: {
        // TODO(confirm): exact input schema of APIFY_ACTOR_SEND_DM.
        cookie: [{ name: 'li_at', value: input.liAt, domain: '.linkedin.com' }],
        li_at: input.liAt,
        profileUrl: input.profileUrl,
        message: input.body,
        proxy: residentialProxy(input.proxyCountry),
      },
      proxyCountry: input.proxyCountry,
      webhookPayload: {
        userId: input.userId,
        action: 'send_dm',
        messageId: input.messageId,
        queueId: input.queueId,
      },
    });
    return { mode: 'async', runId: run.runId };
  }
}
