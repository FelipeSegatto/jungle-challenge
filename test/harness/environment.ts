import { localHttpOrigin, localHttpInstances } from '../../scripts/test-targets';
/** Fail closed before opening a DB connection or consuming any message. */
export function assertTestEnvironment(): void {
  const local = (value: string | undefined, protocol: string) => {
    if (!value)
      throw new Error(
        'Use bun run test:all (isolated runner); explicit test targets are required.',
      );
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error('Invalid explicit test endpoint.');
    }
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      !(protocol === 'postgres' ? ['postgres:', 'postgresql:'] : ['http:', 'https:']).includes(
        url.protocol,
      )
    ) {
      throw new Error('Integration tests require explicit local test endpoints.');
    }
    return url;
  };
  const database = local(process.env.DATABASE_URL, 'postgres');
  local(process.env.SQS_ENDPOINT, 'http');
  localHttpOrigin(process.env.BASE_URL, 'BASE_URL');
  localHttpInstances(process.env.BASE_URLS);
  if (
    process.env.NODE_ENV !== 'test' ||
    !/^jungle_[a-f0-9]+_test$/.test(database.pathname.slice(1)) ||
    !/^jungle-test-[a-f0-9-]+-$/.test(process.env.SQS_QUEUE_PREFIX ?? '')
  ) {
    throw new Error(
      'Integration tests require a dedicated database and queue prefix. Run bun run test:all.',
    );
  }
}
assertTestEnvironment();
