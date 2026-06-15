# oRPC — concrete implementation guide (build target)

Derived from `spec/orpc/01..06` + verified against oRPC **1.14.6** and **zod 4**.
This is the exact target the migration must produce. Pseudocode in 01..06 is superseded by the concrete code here.

## Versions / packages

- `@lemur/shared`: `+ zod@^4`, `+ @orpc/contract@^1.14`.
- `apps/api`: `+ @orpc/server@^1.14`. Remove `class-validator`, `class-transformer` (no DTO classes remain).
- `apps/webapp`: `+ @orpc/client@^1.14`.

## Hard rules

- **`@lemur/shared` is ESM compiled to `dist`** with explicit `.js` extensions on relative imports (`./enums.js`). New files MUST follow this. Bare specifiers (`zod`, `@orpc/contract`) need no extension. After any shared change run `pnpm build:shared` before typechecking api/webapp (they consume `dist`).
- Money stays `number` in schemas (`.int()` where integral). Enum schemas reuse the const arrays in `enums.ts` (`z.enum(UPGRADE_TYPES)`), never re-list values.
- camelCase field/enum values in code.

## Procedure tree (server router == client shape)

```
auth.telegram   (public,  limit 'auth')
users.me        (authed)
users.config    (authed)
tap             (authed,  limit 'tap')
upgrades.list   (authed)
upgrades.buy    (authed)
fruit.start     (authed,  limit 'fruit')
fruit.finish    (authed,  limit 'fruit')
daily.status    (authed)
daily.claim     (authed)
staking.list    (authed)
staking.stake   (authed)
staking.unstake (authed)
referral.list   (authed)
```

Procedures with no request body declare **no** `.input` (client calls them with no arg).

---

## Phase 1 — `@lemur/shared`

1. Convert every `src/dto/*.ts` interface into a zod schema + `z.infer` type **keeping the exact exported type names** (so existing `import type {...}` consumers keep compiling). Export both schema and type. Examples:

```ts
// src/dto/tap.ts
import * as z from 'zod';
export const TapRequestSchema = z.object({ taps: z.number().int().min(1) });
export const TapResponseSchema = z.object({
  coins: z.number(), energy: z.number(), applied: z.number().int(),
});
export type TapRequest = z.infer<typeof TapRequestSchema>;
export type TapResponse = z.infer<typeof TapResponseSchema>;
```

   - `common.ts`: `UserProfileSchema` (→ `UserProfileDto`), `LedgerEntrySchema`. `username` is `z.string().nullable()`. Reuse `LEDGER_TYPES`, `REF_SOURCES` arrays for enums; `refSource` nullable.
   - `staking.ts`: needs a stake-status enum — add `STAKE_STATUSES = ['active','closed'] as const` to `enums.ts` and use `z.enum(STAKE_STATUSES)`. `dailyRate` is `z.string()`, `unlockAt` `z.string().nullable()`.
   - `referral.ts`: `ReferralQuerySchema = z.object({ limit: z.number().int().min(1).max(50).optional(), cursor: z.string().optional() })`. `nextCursor` nullable.
   - `auth.ts`: `AuthTelegramRequestSchema = z.object({ initData: z.string() })`; `AuthTelegramResponseSchema = z.object({ jwt: z.string(), profile: UserProfileSchema })`. Keep `type ConfigResponse = GameConfig`.
   - `upgrades.ts`: `nextPrice` `z.number().nullable()`. `UpgradeStateSchema`, `UpgradeBuyResponseSchema`. List output is `z.array(UpgradeStateSchema)`.
   - `fruit.ts`, `daily.ts`: straightforward `z.object`.

2. `config.ts`: add `GameConfigSchema` covering every field (use nested `z.object` for `upgrades` keyed by the 4 upgrade types and `staking` keyed by the 3 tiers — build them from the const arrays via a helper or explicit keys). Replace `export interface GameConfig` with `export type GameConfig = z.infer<typeof GameConfigSchema>` (structural — downstream unaffected). Keep `DEFAULT_GAME_CONFIG` and add a load-time assertion `GameConfigSchema.parse(DEFAULT_GAME_CONFIG)` (e.g. wrap the literal: `export const DEFAULT_GAME_CONFIG: GameConfig = GameConfigSchema.parse({...})`).

3. `src/contract/index.ts` — build the contract with `oc`:

```ts
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { /* all *Schema */ } from '../dto/index.js';
import { GameConfigSchema } from '../config.js';

export const contract = {
  auth: { telegram: oc.input(AuthTelegramRequestSchema).output(AuthTelegramResponseSchema) },
  users: {
    me: oc.output(UserProfileSchema),
    config: oc.output(GameConfigSchema),
  },
  tap: oc.input(TapRequestSchema).output(TapResponseSchema)
    .errors({ INSUFFICIENT_ENERGY: {} }),
  upgrades: {
    list: oc.output(z.array(UpgradeStateSchema)),
    buy: oc.input(UpgradeBuyRequestSchema /* z.object({ type: z.enum(UPGRADE_TYPES) }) */).output(UpgradeBuyResponseSchema)
      .errors({ INSUFFICIENT_COINS: {}, UNKNOWN_TYPE: {}, MAX_LEVEL: {} }),
  },
  fruit: {
    start: oc.output(FruitStartResponseSchema)
      .errors({ SESSION_ACTIVE: {}, INSUFFICIENT_ENERGY: {} }),
    finish: oc.input(FruitFinishRequestSchema).output(FruitFinishResponseSchema)
      .errors({ SESSION_NOT_FOUND: {}, SESSION_REJECTED: {}, SESSION_EXPIRED: {} }),
  },
  daily: {
    status: oc.output(DailyStatusResponseSchema),
    claim: oc.output(DailyClaimResponseSchema).errors({ DAILY_ALREADY_CLAIMED: {} }),
  },
  staking: {
    list: oc.output(z.array(StakePositionSchema)),
    stake: oc.input(StakeRequestSchema).output(StakeResponseSchema)
      .errors({ AMOUNT_BELOW_MIN: {}, UNKNOWN_TIER: {}, INSUFFICIENT_COINS: {} }),
    unstake: oc.input(UnstakeRequestSchema).output(UnstakeResponseSchema)
      .errors({ STAKE_LOCKED: {}, STAKE_NOT_FOUND: {} }),
  },
  referral: { list: oc.input(ReferralQuerySchema).output(ReferralResponseSchema) },
};
```

   Add `UpgradeBuyRequestSchema = z.object({ type: z.enum(UPGRADE_TYPES) })` in `upgrades.ts`.
   Typed-error declarations are documentary; runtime correctness rests on the server error interceptor (Phase 2). Declare them as shown but do not block on perfect coverage.

4. Export everything from `src/index.ts`: add `export * from './contract/index.js';` and ensure schema exports flow through `./dto/index.js` and `./config.js`.

**Gate:** `pnpm build:shared` green; `import { contract } from '@lemur/shared'` resolves.

---

## Phase 2 — `apps/api` oRPC runtime

New dir `apps/api/src/orpc/`.

### `context.ts`
```ts
import type { Request } from 'express';
import type { JwtService } from '@nestjs/jwt';
import type { AuthUser } from '../common/auth/auth-user';
import type { RedisService } from '../common/redis/redis.service';
import type { GameConfigService } from '../config/game-config.service';

export interface OrpcServices {
  jwt: JwtService;
  redis: RedisService;
  gameConfig: GameConfigService;
}
export interface OrpcContext {
  req: Request;
  services: OrpcServices;
  user?: AuthUser;            // set by authMiddleware
}
```

### `base.ts` — shared implementer + middlewares (no DI; reads services from context)
```ts
import { implement, ORPCError } from '@orpc/server';
import { TokenExpiredError } from '@nestjs/jwt';
import { contract } from '@lemur/shared';
import type { JwtPayload } from '../common/auth/auth-user';
import type { OrpcContext } from './context';

export const base = implement(contract).$context<OrpcContext>();

export const authMiddleware = base.middleware(async ({ context, next }) => {
  const header = context.req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new ORPCError('UNAUTHORIZED', { status: 401, message: 'Missing bearer token', data: { code: 'unauthorized' } });
  try {
    const payload = await context.services.jwt.verifyAsync<JwtPayload>(token);
    const userId = payload.userId ?? payload.sub;
    if (!userId) throw new ORPCError('UNAUTHORIZED', { status: 401, message: 'Invalid token payload', data: { code: 'unauthorized' } });
    return next({ context: { user: { userId } } });
  } catch (e) {
    if (e instanceof ORPCError) throw e;
    const expired = e instanceof TokenExpiredError;
    throw new ORPCError('UNAUTHORIZED', { status: 401, message: expired ? 'Token expired' : 'Invalid token', data: { code: expired ? 'token_expired' : 'unauthorized' } });
  }
});

export const authed = base.use(authMiddleware);

type LimitName = 'tap' | 'fruit' | 'auth';
export const rateLimit = (name: LimitName) => base.middleware(async ({ context, next }) => {
  const cfg = context.services.gameConfig.get();
  const windowMs = name === 'tap' ? cfg.tapRateLimitWindowMs : name === 'fruit' ? cfg.fruitRateLimitWindowMs : cfg.authRateLimitWindowMs;
  const max = name === 'tap' ? cfg.tapRateLimitMax : name === 'fruit' ? cfg.fruitRateLimitMax : cfg.authRateLimitMax;
  const ipHeader = context.req.headers['x-forwarded-for'];
  const ip = (Array.isArray(ipHeader) ? ipHeader[0] : ipHeader)?.split(',')[0]?.trim() ?? context.req.socket.remoteAddress ?? 'unknown';
  const id = context.user?.userId ?? ip;
  const key = `orpc:rl:${name}:${id}`;
  const redis = context.services.redis.raw;
  const count = await redis.incr(key);
  if (count === 1) await redis.pexpire(key, windowMs);
  if (count > max) throw new ORPCError('TOO_MANY_REQUESTS', { status: 429, message: 'Rate limit exceeded', data: { code: 'rate_limited' } });
  return next();
});
```
> If the installed `@orpc/server` types reject `implement(contract).$context<T>()` or root `.use`/`.middleware`, adapt by reading the package's `.d.ts`: apply `authMiddleware` per-procedure (`base.tap.use(authMiddleware)`) and define middlewares via `os.$context<OrpcContext>().middleware(...)` from `@orpc/server`, keeping the same context shape. Verify by typecheck.

### Feature routers — one provider per feature, e.g. `apps/api/src/tap/tap.router.ts`
```ts
import { Injectable } from '@nestjs/common';
import { authed, rateLimit } from '../orpc/base';
import { TapService } from './tap.service';

@Injectable()
export class TapRouter {
  constructor(private readonly tap: TapService) {}
  build() {
    return {
      tap: authed.tap.use(rateLimit('tap'))
        .handler(({ input, context }) => this.tap.tap(context.user!.userId, input.taps)),
    };
  }
}
```
Mapping for every feature (delegate to the EXISTING service, signatures unchanged):
- `AuthRouter` → `{ auth: { telegram: base.auth.telegram.use(rateLimit('auth')).handler(({ input }) => this.auth.authenticate(input.initData)) } }`
- `UsersRouter` → `{ users: { me: authed.users.me.handler(({ context }) => this.users.getMe(context.user!.userId)), config: authed.users.config.handler(() => this.users.getConfig()) } }`
- `TapRouter` → see above.
- `UpgradesRouter` → `{ upgrades: { list: authed.upgrades.list.handler(({context}) => this.upgrades.list(context.user!.userId)), buy: authed.upgrades.buy.handler(({input,context}) => this.upgrades.buy(context.user!.userId, input.type)) } }`
- `FruitRouter` → start/finish with `rateLimit('fruit')`; `this.fruit.start(uid)`, `this.fruit.finish(uid, input.sessionId, input.score)`.
- `DailyRouter` → `this.daily.getStatus(uid)`, `this.daily.claim(uid)`.
- `StakingRouter` → `this.staking.list(uid)`, `this.staking.stake(uid, input.amount, input.tier)`, `this.staking.unstake(uid, input.stakeId)`.
- `ReferralRouter` → `this.referral.getReport(uid, { limit: input.limit, cursor: input.cursor })`.

Each feature **module**: drop `controllers`, add its `XxxRouter` to `providers` and `exports`. Delete the old `*.controller.ts` and the feature's `dto/*.dto.ts`.

### `orpc-handler.service.ts`
```ts
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { RPCHandler } from '@orpc/server/node';
import { AppError } from '../common/errors/app-error';
import { ERROR_STATUS } from '../common/errors/error-status'; // export STATUS_BY_CODE from the filter or duplicate the map
import { RedisService } from '../common/redis/redis.service';
import { GameConfigService } from '../config/game-config.service';
import { AuthRouter } from '../auth/auth.router';
/* ...import all 8 routers... */

@Injectable()
export class OrpcHandlerService {
  private readonly handler: RPCHandler<any>;
  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly gameConfig: GameConfigService,
    private readonly authRouter: AuthRouter,
    /* ...all routers... */
  ) {
    const router = {
      ...this.authRouter.build(),
      ...this.usersRouter.build(),
      // ...all
    };
    this.handler = new RPCHandler(router, {
      interceptors: [
        async ({ next }: { next: () => Promise<unknown> }) => {
          try { return await next(); }
          catch (e) {
            if (e instanceof AppError) {
              throw new ORPCError(e.code.toUpperCase(), { status: ERROR_STATUS[e.code], message: e.message, data: { code: e.code } });
            }
            throw e;
          }
        },
      ],
    });
  }

  async handle(req: Request, res: Response): Promise<boolean> {
    const { matched } = await this.handler.handle(req, res, {
      prefix: '/api/v1/rpc',
      context: { req, services: { jwt: this.jwt, redis: this.redis, gameConfig: this.gameConfig } },
    });
    return matched;
  }
}
```
Import `ORPCError` from `@orpc/server`. Export the `STATUS_BY_CODE` map (rename `ERROR_STATUS`) from a small shared module so both the filter and this interceptor use it (avoid duplication).

### `orpc.controller.ts`
```ts
import { All, Controller, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { OrpcHandlerService } from './orpc-handler.service';

@Controller('rpc')
@Public()            // global JwtAuthGuard skips /rpc — auth happens in oRPC middleware
@SkipThrottle()      // coarse ThrottlerGuard off here; precise limits live in oRPC middleware
export class OrpcController {
  constructor(private readonly orpc: OrpcHandlerService) {}
  @All('*')
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    const matched = await this.orpc.handle(req, res);
    if (!matched) res.status(404).end();
  }
}
```

### `orpc.module.ts`
Imports the 8 feature modules (which export their routers) + `RedisModule` + `GameConfigModule` (JwtModule is global). Provides `OrpcHandlerService`, declares `OrpcController`. Add `OrpcModule` to `AppModule.imports`.

### `main.ts`
- `NestFactory.create(AppModule, { bodyParser: false })` — **critical**: oRPC's node handler reads the raw request stream; Nest's default express body-parser would consume it first and break every POST. All HTTP body routes are now oRPC, so disabling global parsing is safe (the grammY bot uses long-polling, not HTTP).
- Remove the `ValidationPipe` block and its import (no class-validator DTOs remain).
- Keep: `setGlobalPrefix('api/v1')`, `AllExceptionsFilter`, CORS, `enableShutdownHooks`, the `BigInt.prototype.toJSON` patch.

Leave `JwtAuthGuard`, `ThrottlerGuard`, `AllExceptionsFilter` registered globally (they still cover any non-rpc surface and the filter is the safety net).

**Gate:** `pnpm build:shared` then `pnpm -F @lemur/api typecheck` green; `pnpm -F @lemur/api build` green.

---

## Phase 3 — `apps/webapp` client

Rewrite `src/api/client.ts` only; **screens and stores stay unchanged** by preserving the `apiClient` method surface and the `ApiClientError { code, message, status }` shape (screens do `e instanceof ApiClientError && e.code === '<snake_domain>'`).

```ts
import { createORPCClient, ORPCError } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import { contract, type StakingTier, type UpgradeType, type AuthTelegramResponse } from '@lemur/shared';
import { getTelegramContext } from '../telegram';

// resolveBase() unchanged (VITE_API_BASE / __API_BASE__).
let jwt: string | null = null;
const link = new RPCLink({
  url: `${resolveBase()}/api/v1/rpc`,
  headers: () => (jwt ? { authorization: `Bearer ${jwt}` } : {}),
});
const rpc: ContractRouterClient<typeof contract> = createORPCClient(link);

export class ApiClientError extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message); this.name = 'ApiClientError'; this.code = code; this.status = status;
  }
}

function toApiClientError(e: unknown): ApiClientError {
  if (e instanceof ORPCError) {
    const domain = (e.data as { code?: string } | undefined)?.code;
    return new ApiClientError(domain ?? e.code.toLowerCase(), e.message, e.status ?? 0);
  }
  return new ApiClientError('unknown_error', e instanceof Error ? e.message : 'Request failed', 0);
}
const isUnauthorized = (e: unknown) => e instanceof ORPCError && (e.status === 401 || e.code === 'UNAUTHORIZED');

async function authenticateRaw(): Promise<AuthTelegramResponse> {
  const resp = await rpc.auth.telegram({ initData: getTelegramContext().initDataRaw });
  jwt = resp.jwt; return resp;
}
async function call<T>(fn: () => Promise<T>, auth = true): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (auth && isUnauthorized(e)) {
      await authenticateRaw();
      try { return await fn(); } catch (e2) { throw toApiClientError(e2); }
    }
    throw toApiClientError(e);
  }
}

export const apiClient = {
  get token() { return jwt; },
  clearToken() { jwt = null; },
  authenticate: () => call(() => authenticateRaw(), false),
  me: () => call(() => rpc.users.me()),
  config: () => call(() => rpc.users.config()),
  tap: (taps: number) => call(() => rpc.tap({ taps })),
  fruitStart: () => call(() => rpc.fruit.start()),
  fruitFinish: (sessionId: string, score: number) => call(() => rpc.fruit.finish({ sessionId, score })),
  daily: () => call(() => rpc.daily.status()),
  dailyClaim: () => call(() => rpc.daily.claim()),
  upgrades: () => call(() => rpc.upgrades.list()),
  buyUpgrade: (type: UpgradeType) => call(() => rpc.upgrades.buy({ type })),
  staking: () => call(() => rpc.staking.list()),
  stake: (amount: number, tier: StakingTier) => call(() => rpc.staking.stake({ amount, tier })),
  unstake: (stakeId: string) => call(() => rpc.staking.unstake({ stakeId })),
  referral: (query?: { limit?: number; cursor?: string }) =>
    call(() => rpc.referral.list({ limit: query?.limit, cursor: query?.cursor })),
};
```
If a no-input procedure's client method requires an argument per the installed types, pass `{}`. Keep `resolveBase()` and the `__API_BASE__` handling exactly as today. Do not edit screens or `gameStore.ts` unless typecheck forces a trivial signature fix.

**Gate:** `pnpm build:shared` then `pnpm -F @lemur/webapp typecheck` green.

---

## Phase 4 — verification

`pnpm build:shared && pnpm typecheck && pnpm lint` all green. (No test files exist in the repo; `pnpm test` is out of scope.) Then a manual smoke run is recommended: `docker compose up -d postgres redis` → `pnpm prisma:generate && pnpm prisma:migrate && pnpm prisma:seed` → `pnpm dev` → bootstrap the webapp (auth → config → me → tap → upgrade → fruit → daily → staking → referral).
