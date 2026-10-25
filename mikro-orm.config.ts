import 'dotenv/config';
import 'reflect-metadata';
import { defineConfig } from '@mikro-orm/postgresql';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { Migrator } from '@mikro-orm/migrations';
import { entities } from './src/infrastructure/entities/rows';
export default defineConfig({
  clientUrl:
    process.env.DATABASE_URL ?? 'postgresql://jungle:jungle@127.0.0.1:55432/jungle_wagering',
  entities,
  metadataProvider: ReflectMetadataProvider,
  extensions: [Migrator],
  debug: false,
  migrations: {
    path: 'src/infrastructure/migrations',
    pathTs: 'src/infrastructure/migrations',
    glob: '!(*.d).{js,ts}',
    transactional: true,
    allOrNothing: true,
    snapshot: false,
  },
});
