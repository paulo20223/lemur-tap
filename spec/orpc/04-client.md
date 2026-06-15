# Клиент (`apps/webapp`)

## Зависимости

- `+@orpc/client` (`createORPCClient`, `RPCLink`, `safe`, `isDefinedError`).

## Замена `ApiClient`

`apps/webapp/src/api/client.ts` (fetch, ~290 строк ручного маппинга путей/тел) заменяется тонкой обёрткой над типизированным oRPC-клиентом:

```ts
import { createORPCClient, onError } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import { contract } from '@lemur/shared';

let jwt: string | null = null;

const link = new RPCLink({
  url: `${API_BASE}/api/v1/rpc`,
  headers: () => (jwt ? { authorization: `Bearer ${jwt}` } : {}),
});

const rpc: ContractRouterClient<typeof contract> = createORPCClient(link);
```

`API_BASE` берётся как сейчас: `VITE_API_BASE` / `__API_BASE__`.

## Re-auth на 401 (сохраняем семантику)

Текущее поведение — на 401 переаутентифицироваться через `auth.telegram(initData)` и повторить запрос один раз — сохраняется. Реализуется обёрткой/интерцептором: ловим `ORPCError` с кодом `UNAUTHORIZED` → `rpc.auth.telegram({ initData })` → ставим `jwt` → один retry. JWT хранится в памяти (как сейчас), `initData` берётся из `getTelegramContext().initDataRaw`.

## Поверхность для сторов

Singleton `apiClient` сохраняет привычные методы (`authenticate`, `me`, `config`, `tap`, `fruitStart`, `fruitFinish`, `daily`, `dailyClaim`, `upgrades`, `buyUpgrade`, `staking`, `stake`, `unstake`, `referral`), но они делегируют в `rpc.*`:

```ts
export const apiClient = {
  authenticate: () => rpc.auth.telegram({ initData: getInitData() }).then(saveJwt),
  tap: (taps: number) => rpc.tap({ taps }),
  buyUpgrade: (type: UpgradeType) => rpc.upgrades.buy({ type }),
  // …
};
```

Это минимизирует правки в `gameStore.ts` и прочих zustand-сторах — меняются сигнатуры вызовов, не структура сторов. `regenEnergy()` и оптимистичный UI на клиенте не трогаются.

## Ошибки на клиенте

Доменные ошибки читаются типобезопасно:

```ts
const { error, data, isDefined } = await safe(rpc.tap({ taps }));
if (isDefinedError(error) && error.code === 'INSUFFICIENT_ENERGY') { /* … */ }
```

`ApiClientError` (прежний `{ code, message, status }`) заменяется на `ORPCError`; код по-прежнему берётся из `error.code`/`error.data.code` — совместимо с текущей обработкой в UI.

---
[← Оглавление](./README.md)
