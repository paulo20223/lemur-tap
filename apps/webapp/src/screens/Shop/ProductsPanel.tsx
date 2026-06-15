/**
 * Products panel (spec/app/13) — the "Товары" tab of the Shop.
 *
 * Two sections: «Лемустеры» (cosmetic skins, exactly one equipped) and
 * «Корзины» (basket tiers that lengthen the coupon round — owned forever, the
 * best owned tier is active). The catalog (ids/names/prices/effects) is fully
 * server-driven via shop.catalog; this component renders it and drives the
 * shop.* procedures.
 *
 * Coins path (phase 1–3): each card shows the coin price; purchases/equips
 * return the new coin balance + the touched item, which we merge into the
 * shared store (so the balance and the equipped skin shown elsewhere stay in
 * sync).
 *
 * Stars path (phase 4): the second button requests a Telegram Stars invoice
 * (shop.createStarsInvoice) and opens it via openInvoice. The grant happens
 * server-side on the bot's successful_payment update — asynchronously — so on a
 * 'paid' status we reload the catalog and briefly poll it until the item shows
 * owned/active. The store stays authoritative; there is no optimistic stars
 * grant. Outside Telegram (openInvoice unavailable) the button falls back to
 * the quiet disabled "Soon" chip.
 */
import { useCallback, useEffect, useState } from 'react';
import { openInvoice } from '@telegram-apps/sdk-react';
import type { ShopBasketItem, ShopSkinItem } from '@lemur/shared';
import { apiClient, ApiClientError } from '../../api/client';
import { useGameStore } from '../../store';
import { CoinIcon, CheckIcon, SkinIcon, BasketIcon, StarIcon } from '../../components/icons';
import {
  SegmentedToggle,
  type SegmentOption,
} from '../../components/SegmentedToggle';
import { useT, type MessageKey } from '../../i18n';
import { skinVariant, lemurSkinVars, LEMUR_SVG } from './skins';
import { basketVariant, BASKET_SVG } from './baskets';

/** Which goods section is on screen — switched by the in-panel toggle. */
type Section = 'skins' | 'baskets';

type TFn = (key: MessageKey, params?: Record<string, string | number>) => string;

function formatCoins(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** Whole-second bonus label from a ms value ("+5с к раунду"). */
function formatBonus(t: TFn, durationBonusMs: number): string {
  return t('shop.roundBonus', { n: Math.round(durationBonusMs / 1000) });
}

/** Map a shop domain error code to a localized message. */
function shopError(code: string, t: TFn): string {
  switch (code) {
    case 'insufficient_coins':
      return t('shop.errors.insufficientCoins');
    case 'already_owned':
      return t('shop.errors.alreadyOwned');
    case 'not_owned':
      return t('shop.errors.notOwned');
    case 'unknown_item':
      return t('shop.errors.unknownItem');
    case 'stars_not_available':
      return t('shop.errors.starsNotAvailable');
    default:
      return t('shop.errors.generic');
  }
}

/** True when the host (Telegram) can open invoices — gates the active button. */
function starsAvailable(): boolean {
  try {
    return openInvoice.isAvailable();
  } catch {
    return false;
  }
}

/**
 * The Stars buy button shared by every card — the premium secondary CTA, twin
 * to the coin button (same footprint), in the gold "precious currency" language.
 * Tappable inside Telegram (opens an invoice); outside Telegram openInvoice is
 * unavailable, so it renders as a calm disabled gold button (no shouty "Soon"
 * tag), keeping the dual-currency layout intact.
 */
function StarsButton({
  priceStars,
  pending,
  t,
  onBuy,
}: {
  priceStars: number;
  /** True while THIS item's stars purchase is in flight. */
  pending: boolean;
  t: TFn;
  onBuy: () => void;
}) {
  const available = starsAvailable();

  return (
    <button
      type="button"
      className="pcard__stars"
      disabled={!available || pending}
      aria-label={available ? t('shop.buyStars') : t('shop.starsSoon')}
      title={available ? t('shop.buyStars') : t('shop.starsSoon')}
      onClick={available ? onBuy : undefined}
    >
      {pending ? (
        <span>{t('shop.starsPending')}</span>
      ) : (
        <span className="pcard__price num">
          <StarIcon size={16} className="pcard__stars-icon" />
          {formatCoins(priceStars)}
        </span>
      )}
    </button>
  );
}

export default function ProductsPanel() {
  const t = useT();
  const catalog = useGameStore((s) => s.shopCatalog);
  const loadShopCatalog = useGameStore((s) => s.loadShopCatalog);
  const applyShopPurchase = useGameStore((s) => s.applyShopPurchase);
  const applyEquippedSkin = useGameStore((s) => s.applyEquippedSkin);
  const coins = useGameStore((s) => s.profile?.coins ?? 0);

  const [loading, setLoading] = useState(!catalog);
  const [error, setError] = useState<string | null>(null);
  /** Pending op key (`basket:<tier>` / `skin:<id>` / `equip:<id>`), or null. */
  const [pending, setPending] = useState<string | null>(null);
  const [section, setSection] = useState<Section>('skins');

  const sections: SegmentOption<Section>[] = [
    { value: 'skins', label: t('shop.skinsTitle'), Icon: SkinIcon },
    { value: 'baskets', label: t('shop.basketsTitle'), Icon: BasketIcon },
  ];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await loadShopCatalog();
    } catch {
      setError(t('shop.failedLoad'));
    } finally {
      setLoading(false);
    }
  }, [loadShopCatalog, t]);

  useEffect(() => {
    void load();
    // Load once on mount; the store caches the catalog across tab switches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buyBasket = useCallback(
    async (tier: number) => {
      if (pending) return;
      setPending(`basket:${tier}`);
      setError(null);
      try {
        const res = await apiClient.buyBasket(tier, 'coins');
        applyShopPurchase(res);
      } catch (e) {
        const code = e instanceof ApiClientError ? e.code : 'unknown_error';
        setError(shopError(code, t));
      } finally {
        setPending(null);
      }
    },
    [pending, applyShopPurchase, t],
  );

  const buySkin = useCallback(
    async (skinId: string) => {
      if (pending) return;
      setPending(`skin:${skinId}`);
      setError(null);
      try {
        const res = await apiClient.buySkin(skinId, 'coins');
        applyShopPurchase(res);
      } catch (e) {
        const code = e instanceof ApiClientError ? e.code : 'unknown_error';
        setError(shopError(code, t));
      } finally {
        setPending(null);
      }
    },
    [pending, applyShopPurchase, t],
  );

  const equipSkin = useCallback(
    async (skinId: string) => {
      if (pending) return;
      setPending(`equip:${skinId}`);
      setError(null);
      // Optimistic: reflect the equip immediately, then reconcile from server.
      applyEquippedSkin(skinId);
      try {
        const res = await apiClient.equipSkin(skinId);
        applyShopPurchase(res);
      } catch (e) {
        const code = e instanceof ApiClientError ? e.code : 'unknown_error';
        setError(shopError(code, t));
        void load(); // re-sync if the optimistic equip was wrong
      } finally {
        setPending(null);
      }
    },
    [pending, applyEquippedSkin, applyShopPurchase, load, t],
  );

  /**
   * Stars purchase: request an invoice link, open it, and (on 'paid') reload the
   * catalog. The bot grants asynchronously on its successful_payment update, so
   * poll the freshest catalog a few times until the item flips to owned/active.
   * 'cancelled'/'pending' are silent; 'failed' surfaces an error.
   */
  const buyStars = useCallback(
    async (
      kind: 'basket' | 'skin',
      ref: string,
      isOwned: () => boolean,
    ) => {
      if (pending) return;
      setPending(`stars:${kind}:${ref}`);
      setError(null);
      try {
        const { invoiceLink } = await apiClient.createStarsInvoice(kind, ref);
        const status = await openInvoice(invoiceLink, 'url');
        if (status === 'paid') {
          await loadShopCatalog();
          // Poll until the async server grant lands (or give up quietly).
          for (let i = 0; i < 5 && !isOwned(); i += 1) {
            await new Promise((r) => setTimeout(r, 700));
            await loadShopCatalog();
          }
        } else if (status === 'failed') {
          setError(t('shop.errors.starsFailed'));
        }
        // 'cancelled' | 'pending' → silent (user dismissed / not finished).
      } catch (e) {
        const code = e instanceof ApiClientError ? e.code : 'unknown_error';
        setError(shopError(code, t));
      } finally {
        setPending(null);
      }
    },
    [pending, loadShopCatalog, t],
  );

  if (loading && !catalog) {
    return (
      <div className="products__center">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="products">
      {error && (
        <div className="products__error" role="alert">
          <span>{error}</span>
          <button className="products__retry" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        </div>
      )}

      {/* Top switcher: one goods section at a time (Лемустеры / Корзины). */}
      <SegmentedToggle
        segments={sections}
        value={section}
        onChange={setSection}
        label={t('shop.productsLabel')}
        idPrefix="products"
      />

      <div
        role="tabpanel"
        id={`products-panel-${section}`}
        aria-labelledby={`products-tab-${section}`}
      >
        {section === 'skins' ? (
          <div className="products__grid">
            {(catalog?.skins ?? []).map((skin) => (
              <SkinCard
                key={skin.id}
                skin={skin}
                coins={coins}
                pending={pending}
                t={t}
                onBuy={() => void buySkin(skin.id)}
                onEquip={() => void equipSkin(skin.id)}
                onBuyStars={() =>
                  void buyStars('skin', skin.id, () =>
                    Boolean(
                      useGameStore
                        .getState()
                        .shopCatalog?.skins.find((s) => s.id === skin.id)?.owned,
                    ),
                  )
                }
              />
            ))}
          </div>
        ) : (
          <div className="products__grid">
            {(catalog?.baskets ?? []).map((basket) => (
              <BasketCard
                key={basket.tier}
                basket={basket}
                coins={coins}
                pending={pending}
                t={t}
                onBuy={() => void buyBasket(basket.tier)}
                onBuyStars={() =>
                  void buyStars('basket', String(basket.tier), () =>
                    Boolean(
                      useGameStore
                        .getState()
                        .shopCatalog?.baskets.find(
                          (b) => b.tier === basket.tier,
                        )?.owned,
                    ),
                  )
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Cards ─────────────────────────────────────────────────────────────── */

function SkinCard({
  skin,
  coins,
  pending,
  t,
  onBuy,
  onEquip,
  onBuyStars,
}: {
  skin: ShopSkinItem;
  coins: number;
  pending: string | null;
  t: TFn;
  onBuy: () => void;
  onEquip: () => void;
  onBuyStars: () => void;
}) {
  const v = skinVariant(skin.id);
  const affordable = coins >= skin.priceCoins;
  const buying = pending === `skin:${skin.id}`;
  const equipping = pending === `equip:${skin.id}`;
  const starsBuying = pending === `stars:skin:${skin.id}`;
  const busy = pending !== null;

  return (
    <div
      className={`card pcard${skin.equipped ? ' pcard--active' : ''}`}
      style={
        { '--pcard-accent': v.accent, '--pcard-glow': v.glow } as React.CSSProperties
      }
    >
      {skin.equipped && (
        <span className="pcard__seal" aria-hidden>
          <CheckIcon size={14} />
        </span>
      )}
      <span
        className="pcard__preview pcard__preview--lemur"
        data-skin={skin.id}
        aria-hidden
        style={lemurSkinVars(skin.id) as React.CSSProperties}
      >
        <span
          className="pcard__lemur"
          dangerouslySetInnerHTML={{ __html: LEMUR_SVG }}
        />
        <i className="pcard__sheen" aria-hidden />
      </span>

      <div className="pcard__name">{skin.name}</div>

      {skin.equipped ? (
        <div className="pcard__status pcard__status--active">
          {t('shop.equipped')}
        </div>
      ) : skin.owned ? (
        <button
          className="btn btn--ghost pcard__buy"
          disabled={busy}
          onClick={onEquip}
        >
          {equipping ? t('shop.equipping') : t('shop.equip')}
        </button>
      ) : (
        <div className="pcard__actions">
          <button className="btn pcard__buy" disabled={busy || !affordable} onClick={onBuy}>
            {buying ? (
              t('shop.buying')
            ) : (
              <span className="pcard__price num">
                <CoinIcon size={17} />
                {formatCoins(skin.priceCoins)}
              </span>
            )}
          </button>
          <StarsButton
            priceStars={skin.priceStars}
            pending={starsBuying}
            t={t}
            onBuy={onBuyStars}
          />
        </div>
      )}
    </div>
  );
}

function BasketCard({
  basket,
  coins,
  pending,
  t,
  onBuy,
  onBuyStars,
}: {
  basket: ShopBasketItem;
  coins: number;
  pending: string | null;
  t: TFn;
  onBuy: () => void;
  onBuyStars: () => void;
}) {
  const affordable = coins >= basket.priceCoins;
  const buying = pending === `basket:${basket.tier}`;
  const starsBuying = pending === `stars:basket:${basket.tier}`;
  const busy = pending !== null;
  const variant = basketVariant(basket.tier);

  return (
    <div className={`card pcard${basket.active ? ' pcard--active' : ''}`}>
      {basket.active && (
        <span className="pcard__seal" aria-hidden>
          <CheckIcon size={14} />
        </span>
      )}
      <span
        className="pcard__preview pcard__preview--basket"
        data-material={variant.palette.material}
        aria-hidden
        style={
          {
            '--basket-fill': variant.palette.fill,
            '--basket-dark': variant.palette.dark,
          } as React.CSSProperties
        }
      >
        <span
          className="pcard__basket"
          style={{ width: variant.previewSize }}
          dangerouslySetInnerHTML={{ __html: BASKET_SVG }}
        />
        <i className="pcard__sheen" aria-hidden />
      </span>

      <div className="pcard__name">{t(variant.nameKey)}</div>
      <div className="pcard__effect num">
        {basket.durationBonusMs > 0
          ? formatBonus(t, basket.durationBonusMs)
          : t('shop.basketBase')}
      </div>

      {basket.active ? (
        <div className="pcard__status pcard__status--active">
          {t('shop.active')}
        </div>
      ) : basket.owned ? (
        <div className="pcard__status pcard__status--owned">
          <CheckIcon size={14} />
          {t('shop.owned')}
        </div>
      ) : (
        <div className="pcard__actions">
          <button className="btn pcard__buy" disabled={busy || !affordable} onClick={onBuy}>
            {buying ? (
              t('shop.buying')
            ) : (
              <span className="pcard__price num">
                <CoinIcon size={17} />
                {formatCoins(basket.priceCoins)}
              </span>
            )}
          </button>
          <StarsButton
            priceStars={basket.priceStars}
            pending={starsBuying}
            t={t}
            onBuy={onBuyStars}
          />
        </div>
      )}
    </div>
  );
}
