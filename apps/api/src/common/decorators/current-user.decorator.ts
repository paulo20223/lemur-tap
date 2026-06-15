import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth-user';

/**
 * Injects the authenticated principal (req.user) or one of its fields.
 *   @CurrentUser() user: AuthUser
 *   @CurrentUser('userId') userId: string
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    if (!user) {
      return undefined;
    }
    return data ? user[data] : user;
  },
);
