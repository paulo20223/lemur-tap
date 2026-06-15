import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersRouter } from './users.router';

/**
 * UsersModule — read-only profile/config endpoints.
 * PrismaModule, GameConfigModule and the @Global EconomyModule are provided by
 * app.module; the oRPC transport consumes the exported UsersRouter.
 */
@Module({
  providers: [UsersService, UsersRouter],
  exports: [UsersRouter],
})
export class UsersModule {}
