# Процедуры (маппинг REST → oRPC)

1:1 перенос текущих эндпоинтов. Колонка «auth» — публичная (`pub`) или требует JWT (`authed`); «limit» — именованный rate-limit middleware.

| Процедура | Прежний REST | Input | Output | auth | limit |
| --- | --- | --- | --- | --- | --- |
| `auth.telegram` | `POST /auth/telegram` | `AuthTelegramRequest { initData }` | `AuthTelegramResponse { jwt, profile }` | pub | `auth` |
| `users.me` | `GET /me` | — | `MeResponse` (UserProfileDto) | authed | — |
| `users.config` | `GET /config` | — | `GameConfig` | authed | — |
| `upgrades.list` | `GET /upgrades` | — | `UpgradeStateDto[]` | authed | — |
| `upgrades.buy` | `POST /upgrades/:type/buy` | `{ type: UpgradeType }` | `UpgradeBuyResponse` | authed | — |
| `coupon.start` | `POST /coupon/start` | — | `CouponStartResponse { sessionId, seed }` | authed | `coupon` |
| `coupon.finish` | `POST /coupon/finish` | `CouponFinishRequest { sessionId, score }` | `CouponFinishResponse { reward, coins }` | authed | `coupon` |
| `coupon.boost` | _новая_ | — | `CouponBoostResponse { coins, energy, energyUpdatedAt }` | authed | `coupon` |
| `daily.status` | `GET /daily` | — | `DailyStatusResponse` | authed | — |
| `daily.claim` | `POST /daily/claim` | — | `DailyClaimResponse` | authed | — |
| `staking.list` | `GET /staking` | — | `StakePositionDto[]` | authed | — |
| `staking.stake` | `POST /staking/stake` | `StakeRequest { amount, tier }` | `StakeResponse` | authed | — |
| `staking.unstake` | `POST /staking/unstake` | `UnstakeRequest { stakeId }` | `UnstakeResponse` | authed | — |
| `referral.list` | `GET /referral` | `ReferralQuery { limit?, cursor? }` | `ReferralResponse` | authed | — |

Заметки:
- `upgrades.buy`: `type` раньше был path-параметром, теперь поле input.
- `referral.list`: `limit`/`cursor` раньше query-параметры, теперь поля input (ограничение `limit` 1–50 — в zod-схеме).
- Имена процедур сгруппированы по фичам (`feature.action`) — совпадают с прежними NestJS-модулями.

---
[← Оглавление](./README.md)
