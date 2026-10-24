import { Module } from '@nestjs/common';
import { NoopAuthGuard } from './presentation/noop-auth.guard';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import config from '../mikro-orm.config';
import { WalletService, WagerService, QueryService } from './application/services';
import { WalletsController, WageringController, ProviderTransactionsController, HealthController } from './presentation/controllers';

@Module({
  imports: [MikroOrmModule.forRoot(config)],
  controllers: [WalletsController, WageringController, ProviderTransactionsController, HealthController],
  providers: [WalletService, WagerService, QueryService, NoopAuthGuard],
})
export class AppModule {}
