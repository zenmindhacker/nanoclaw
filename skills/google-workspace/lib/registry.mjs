/** Host OAuth registry ids → token/client filenames (read-only in containers). */
export const GOOGLE_REGISTRY = {
  'shadow-google': {
    id: 'shadow-google',
    account: 'hello@connectedtutors.org',
    tokenFile: 'shadow-google-token.json',
    clientFile: 'shadow-google-oauth-client.json',
  },
  'meridian-google': {
    id: 'meridian-google',
    account: 'christina@meridian-institute.org',
    tokenFile: 'meridian-google-token.json',
    clientFile: 'google-oauth-client.json',
  },
  /** Cleo legacy Gmail token filename (same client as shadow-google on CT ops). */
  'google-gmail-legacy': {
    id: 'google-gmail-legacy',
    account: null,
    tokenFile: 'google-gmail-token.json',
    clientFile: 'shadow-google-oauth-client.json',
  },
};

export function getRegistryEntry(registryId) {
  const entry = GOOGLE_REGISTRY[registryId];
  if (!entry) {
    throw new Error(
      `Unknown Google registry id "${registryId}". Known: ${Object.keys(GOOGLE_REGISTRY).join(', ')}`,
    );
  }
  return entry;
}
