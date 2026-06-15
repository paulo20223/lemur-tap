import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthRouter } from './auth.router';

/**
 * AuthModule — Telegram initData validation → JWT session (spec/app/02, 11).
 * PrismaService, GameConfigService, EconomyService and JwtService are all
 * provided globally (PrismaModule / GameConfigModule / EconomyModule are
 * @Global; JwtModule is registered global in app.module), so no re-import.
 * The oRPC transport consumes the exported AuthRouter.
 */
@Module({
  providers: [AuthService, AuthRouter],
  exports: [AuthRouter],
})
export class AuthModule {}
