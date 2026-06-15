import { All, Controller, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import {
  THROTTLER_AUTH,
  THROTTLER_COUPON,
} from '../common/throttler/throttler.module';
import { OrpcHandlerService } from './orpc-handler.service';

/**
 * Single catch-all entry for the oRPC transport (prefix `/api/v1/rpc`).
 * `@Public()` so the global JwtAuthGuard skips it (auth lives in oRPC
 * middleware); the throttler is fully off here (precise per-procedure limits
 * live in oRPC middleware).
 *
 * NB: bare `@SkipThrottle()` defaults to `{ default: true }` and skips ONLY the
 * `default` throttler — the named coupon/auth throttlers would still apply to
 * every /rpc request (choking all routes to ~5 req/s and 429-ing past the auth
 * window). Every throttler must be listed explicitly to truly opt out.
 */
@Controller('rpc')
@Public()
@SkipThrottle({
  default: true,
  [THROTTLER_COUPON]: true,
  [THROTTLER_AUTH]: true,
})
export class OrpcController {
  constructor(private readonly orpc: OrpcHandlerService) {}

  @All('*')
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    const matched = await this.orpc.handle(req, res);
    if (!matched) {
      res.status(404).end();
    }
  }
}
