# Сервер (`apps/api`)

NestJS-рантайм сохраняется целиком. Меняется только то, как HTTP-запрос превращается в вызов сервиса: вместо REST-контроллеров + `class-validator` — один `RPCHandler`, реализующий контракт.

## Зависимости

- `+@orpc/server` (`RPCHandler`, `implement`, плагины из `@orpc/server/plugins`).
- Удаляется `class-validator`/`class-transformer` из DTO-валидации (глобальный `ValidationPipe` для `/rpc` больше не нужен; оставить только если есть не-oRPC роуты с телом).

## Мост `RPCHandler` → NestJS

Единый catch-all контроллер монтирует RPC-протокол под глобальным префиксом:

```ts
// apps/api/src/orpc/orpc.controller.ts
@Controller('rpc')
export class OrpcController {
  constructor(private readonly handler: OrpcHandlerService) {}

  @All('*')          // POST /api/v1/rpc/*
  @Public()          // глобальный JwtAuthGuard пропускает /rpc — auth внутри oRPC
  async handle(@Req() req: Request, @Res() res: Response) {
    const { matched } = await this.handler.rpc.handle(req, res, {
      prefix: '/api/v1/rpc',
      context: { req },   // headers → oRPC context
    });
    if (!matched) res.status(404).end();
  }
}
```

`OrpcHandlerService` собирает корневой router из фич-роутеров и создаёт `new RPCHandler(router, { interceptors: [errorMapping] })`.

## Реализация процедур

`implement(contract)` даёт implementer, повторяющий структуру контракта. Базовый и `authed`-варианты — общие:

```ts
// apps/api/src/orpc/base.ts
export const base = implement(contract);          // implementer всего контракта
export const authed = base.use(authMiddleware);   // + context.user (см. ниже)
```

Для каждой фичи — провайдер, инжектящий **существующий** сервис и привязывающий `.handler` к нужной ветке implementer'а:

```ts
// apps/api/src/tap/tap.router.ts
@Injectable()
export class TapRouter {
  constructor(private readonly tap: TapService) {}
  build() {
    return {
      tap: authed.tap                              // implementer ветки contract.tap
        .use(rateLimit('tap'))
        .handler(({ input, context }) =>
          this.tap.apply(context.user.userId, input.taps)),  // делегирование, логика не меняется
    };
  }
}
```

Бизнес-логика остаётся в сервисах (`TapService`, `FruitService`, …). Router — только тонкая обёртка: валидация (zod из контракта) → вызов сервиса → возврат. `OrpcHandlerService` собирает корневой router из `*.router.ts` всех фич.

> **DI в middleware.** `authMiddleware`/`rateLimit` нуждаются в Nest-сервисах (`JwtService`, Redis). Поскольку `base`/`authed` определяются на уровне модуля, сервисы прокидываются через oRPC-context (кладём нужное в `context` при `handle(...)`) либо middleware создаются как замыкания внутри провайдера, где сервисы доступны. Финальный выбор — на этапе реализации.

## Auth (oRPC-middleware вместо guard)

`/rpc` помечен `@Public()`, поэтому глобальный `JwtAuthGuard` его не трогает. Аутентификация — в oRPC-middleware:

- Базовый `pub`-implementer — без middleware (для `auth.telegram`).
- `authed` = `pub.use(authMiddleware)`: читает `Authorization: Bearer` из `context.req.headers`, валидирует JWT через существующий `JwtService`/`AuthService`, кладёт `{ user }` в oRPC-context. На фейле — `ORPCError('UNAUTHORIZED', { data: { code: 'token_expired' | 'unauthorized' } })`.

`@CurrentUser()` (param-декоратор) на `/rpc` не работает — вместо него `context.user`.

## Error mapping

Сервисы по-прежнему кидают `AppError`. `onError`-interceptor в `RPCHandler` маппит их в `ORPCError`:

```ts
onError((error) => {
  if (error instanceof AppError) {
    throw new ORPCError(orpcCodeFor(error.code), {  // unauthorized→UNAUTHORIZED, …
      status: STATUS_BY_CODE[error.code],
      message: error.message,
      data: { code: error.code },                   // доменный код сохраняется
    });
  }
});
```

Где у процедуры объявлен typed error (см. [02 — Контракт](./02-contract.md)) — кидаем его, чтобы клиент ловил через `isDefinedError`. `AllExceptionsFilter` остаётся для не-oRPC роутов (bot webhook, health).

## Rate-limit

Именованные лимиты `tap`/`fruit`/`auth` (окна/максимумы из `GameConfig`) переносятся в oRPC-middleware поверх существующего Redis-storage: `authed.use(rateLimit('tap'))`. Ключ — `userId`/IP, как сейчас. Грубый `ThrottlerGuard` можно оставить барьером на самом `/rpc`-роуте.

## BigInt

`BigInt.prototype.toJSON`-страховка в `main.ts` остаётся. Деньги в контракте — `number` (сервисы уже приводят BigInt→number перед возвратом).

---
[← Оглавление](./README.md)
