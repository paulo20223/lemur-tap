import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppError } from '../errors/app-error';
import type { AuthUser, JwtPayload } from './auth-user';

/**
 * Global guard. Verifies the Bearer JWT and attaches `req.user = { userId }`.
 * The only public route is POST /auth/telegram (marked with @Public()).
 * Throws AppError(token_expired) for expired tokens so the client re-auths.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const token = this.extractToken(req);
    if (!token) {
      throw AppError.unauthorized('Missing bearer token');
    }

    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      const userId = payload.userId ?? payload.sub;
      if (!userId) {
        throw AppError.unauthorized('Invalid token payload');
      }
      req.user = { userId };
      return true;
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      if (err instanceof TokenExpiredError) {
        throw AppError.tokenExpired();
      }
      throw AppError.unauthorized('Invalid token');
    }
  }

  private extractToken(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header) {
      return null;
    }
    const [scheme, value] = header.split(' ');
    if (scheme !== 'Bearer' || !value) {
      return null;
    }
    return value;
  }
}
