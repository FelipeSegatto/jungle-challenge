/** Test scripts mutate financial fixtures: require explicit loopback HTTP origins. */
export function localHttpOrigin(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required. Prefer bun run test:isolated.`);
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${name} must be a valid local HTTP origin.`);
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error(
      `${name} must be a loopback HTTP origin without credentials, path, query or fragment.`,
    );
  }
  return url.origin;
}

export function localHttpInstances(value: string | undefined): string[] {
  if (!value?.trim()) throw new Error('BASE_URLS is required. Prefer bun run test:isolated.');
  const origins = value.split(',').map((origin) => localHttpOrigin(origin, 'BASE_URLS'));
  if (new Set(origins).size < 3 || new Set(origins).size !== origins.length) {
    throw new Error('BASE_URLS must contain at least three distinct local origins.');
  }
  return origins;
}
