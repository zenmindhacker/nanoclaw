/**
 * Host OAuth control commands — health inspection and on-demand refresh.
 * Only the host process writes token JSON files under ~/.config/nanoclaw/credentials/.
 */
import { getTokenHealth, refreshAllNow, refreshTokenById } from '../../extensions/oauth/refresher.js';
import { register } from '../registry.js';

register({
  name: 'oauth-health',
  description: 'List OAuth token health from the host registry (read-only).',
  access: 'open',
  resource: 'oauth',
  parseArgs: () => ({}),
  handler: async () => ({
    tokens: getTokenHealth(),
  }),
});

register({
  name: 'oauth-refresh-now',
  description: 'Force the host to refresh all due/expired OAuth tokens immediately.',
  access: 'open',
  resource: 'oauth',
  parseArgs: () => ({}),
  handler: async () => ({
    results: await refreshAllNow(),
  }),
});

register({
  name: 'oauth-refresh-one',
  description: 'Force the host to refresh one OAuth token by registry id.',
  access: 'open',
  resource: 'oauth',
  parseArgs: (raw) => {
    const id = (raw.id as string) || (raw.token_id as string);
    if (!id) throw new Error('--id is required (registry token id, e.g. xero, gmail)');
    return { id };
  },
  handler: async (args) => ({
    result: await refreshTokenById(args.id),
  }),
});
