# Контракт (`@lemur/shared`)

Контракт — единственный источник правды для формы данных. Живёт в `packages/shared/src/contract/`.

## Зависимости

- `+zod` — схемы.
- `+@orpc/contract` — конструктор контракта `oc`.

## zod-схемы DTO

Каждый текущий plain-DTO в `shared/src/dto/` переписывается как zod-схема; прежний интерфейс становится `z.infer`:

```ts
// shared/src/dto/tap.ts
export const TapRequestSchema = z.object({ taps: z.number().int().min(1) });
export const TapResponseSchema = z.object({
  coins: z.number(), energy: z.number(), applied: z.number().int(),
});
export type TapRequest = z.infer<typeof TapRequestSchema>;
export type TapResponse = z.infer<typeof TapResponseSchema>;
```

Правила:
- Деньги — `z.number()` (целые там, где это целые: `.int()`), как сейчас в DTO (BigInt сериализуется в number сервисами).
- Enum'ы (`UpgradeType`, `StakingTier`, …) — `z.enum([...])`, выведенные из существующих enum-массивов в `shared/src/enums.ts` (не дублировать значения).
- Ограничения, что раньше жили в `class-validator` (min/max/optional, `limit` 1–50 в referral, `taps` ≥ 1), переносятся в zod.

## GameConfig

`GameConfig` получает zod-схему `GameConfigSchema` (40+ полей: base/upgrades/tap/fruit/daily/staking/referral/auth). `DEFAULT_GAME_CONFIG` валидируется ею на этапе сборки/сидинга; `GameConfigService` парсит строку из Postgres через схему (ранее — нетипизированный JSON).

## Контракт процедур (`oc`)

```ts
// shared/src/contract/index.ts
import { oc } from '@orpc/contract';

export const contract = {
  auth: {
    telegram: oc.input(AuthTelegramRequestSchema).output(AuthTelegramResponseSchema),
  },
  tap: oc.input(TapRequestSchema).output(TapResponseSchema)
    .errors({ INSUFFICIENT_ENERGY: { data: ErrorDataSchema } }),
  // … остальные процедуры
};
```

Для RPC-протокола `path`/`method` в контракте **не требуются** (они нужны только для `@orpc/nest`/OpenAPI).

## Typed errors

Доменные коды ошибок (`shared/src/errors.ts`, 16 шт.) объявляются как typed errors на тех процедурах, где они осмысленны:

- `tap` → `INSUFFICIENT_ENERGY`
- `upgrades.buy` → `INSUFFICIENT_COINS`, `UNKNOWN_TYPE`, `MAX_LEVEL`
- `fruit.*` → `SESSION_ACTIVE`, `SESSION_NOT_FOUND`, `SESSION_REJECTED`, `SESSION_EXPIRED`, `INSUFFICIENT_COINS`
- `daily.claim` → `DAILY_ALREADY_CLAIMED`
- `staking.*` → `AMOUNT_BELOW_MIN`, `STAKE_LOCKED`, `STAKE_NOT_FOUND`, `UNKNOWN_TIER`, `INSUFFICIENT_COINS`

Общие (`unauthorized`, `token_expired`, `rate_limited`, `invalid_request`) не обязательно объявлять пер-процедуру — они приходят как стандартные `ORPCError` коды (`UNAUTHORIZED`, `TOO_MANY_REQUESTS`, `BAD_REQUEST`) с доменным `code` в `data` (см. error-mapping в [03 — Сервер](./03-server.md)).

`ErrorCode` остаётся единым enum'ом в `shared/src/errors.ts` — и для сервера (`AppError`), и для `data.code` в `ORPCError`.

---
[← Оглавление](./README.md)
