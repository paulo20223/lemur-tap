/** Authenticated principal attached to req.user by JwtAuthGuard. */
export interface AuthUser {
  userId: string;
}

/** JWT payload shape (spec/app/11): contains userId. */
export interface JwtPayload {
  sub: string;
  userId: string;
  iat?: number;
  exp?: number;
}
