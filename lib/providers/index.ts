import 'server-only';
import { serverEnv } from '../env';
import { ApifyProvider } from './apify-provider';
import { LinkedInApiProvider } from './linkedin-api-provider';
import type { LinkedInProvider, ProviderName } from './types';

export * from './types';

/**
 * Selects the active provider for connection-fetch + DM-send, by config.
 * Default 'apify' (the only fully-implemented path). Set LINKEDIN_PROVIDER=
 * linkedin-api once Partner API access is wired into LinkedInApiProvider.
 */
export function getProvider(): LinkedInProvider {
  const name = (serverEnv.linkedinProvider() as ProviderName) || 'apify';
  switch (name) {
    case 'linkedin-api':
      return new LinkedInApiProvider();
    case 'apify':
    default:
      return new ApifyProvider();
  }
}
