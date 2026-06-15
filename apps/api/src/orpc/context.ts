import type { Request } from 'express';
import type { JwtService } from '@nestjs/jwt';
import type { AuthUser } from '../common/auth/auth-user';
import type { RedisService } from '../common/redis/redis.service';
import type { GameConfigService } from '../config/game-config.service';

/** Infrastructure services exposed to oRPC middlewares via the request context. */
export interface OrpcServices {
  jwt: JwtService;
  redis: RedisService;
  gameConfig: GameConfigService;
}

/** Per-request oRPC context. `user` is populated by {@link authMiddleware}. */
export interface OrpcContext {
  req: Request;
  services: OrpcServices;
  user?: AuthUser;
}
