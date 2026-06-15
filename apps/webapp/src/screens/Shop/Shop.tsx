/**
 * Shop screen (spec/app/13) — the merged store: the daily bonus (spec/app/07),
 * the upgrade boosts (spec/app/04) and the new goods catalog (baskets + skins),
 * switched by the shared <SegmentedToggle>.
 *
 * The former screens keep all of their logic; they render here as panels
 * (DailyPanel / UpgradesPanel / ProductsPanel). This parent owns only the
 * chrome: the Bonus/Boosts/Products toggle and a persistent coin balance
 * (relevant to all three — daily pays coins, boosts and goods spend them).
 *
 * Layout: a fixed full-height column. The toggle row pins to the top; the body
 * fills the rest and scrolls inside so the toggle stays put.
 *
 * Back-compat: /rewards, /daily and /upgrades all route here and redirect to
 * /shop, passing the intended view via location state so a deep link can open
 * Boosts (or Products).
 */
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useGameStore } from '../../store';
import {
  SegmentedToggle,
  type SegmentOption,
} from '../../components/SegmentedToggle';
import {
  CoinIcon,
  DailyIcon,
  BoostsIcon,
  TagIcon,
} from '../../components/icons';
import { useT } from '../../i18n';
import DailyPanel from '../Daily/Daily';
import UpgradesPanel from '../Upgrades/Upgrades';
import ProductsPanel from './ProductsPanel';
import './shop.css';

type View = 'daily' | 'boosts' | 'products';

const VIEWS: readonly View[] = ['daily', 'boosts', 'products'];

function formatCoins(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export default function Shop() {
  const location = useLocation();
  const t = useT();
  const requested = (location.state as { view?: View } | null)?.view;
  const initialView: View =
    requested && VIEWS.includes(requested) ? requested : 'products';

  const [view, setView] = useState<View>(initialView);
  const coins = useGameStore((s) => s.profile?.coins ?? 0);

  const segments: SegmentOption<View>[] = [
    { value: 'daily', label: t('shop.tabDaily'), Icon: DailyIcon },
    { value: 'boosts', label: t('shop.tabBoosts'), Icon: BoostsIcon },
    { value: 'products', label: t('shop.tabProducts'), Icon: TagIcon },
  ];

  return (
    <div className="screen shop">
      <header className="shop__head">
        <SegmentedToggle
          segments={segments}
          value={view}
          onChange={setView}
          label={t('shop.sectionLabel')}
          idPrefix="shop"
        />

        <div className="shop__balance num" title={t('shop.yourCoins')}>
          <CoinIcon size={18} className="shop__balance-coin" />
          {formatCoins(coins)}
        </div>
      </header>

      <div
        className="shop__body"
        role="tabpanel"
        id={`shop-panel-${view}`}
        aria-labelledby={`shop-tab-${view}`}
      >
        {view === 'daily' && <DailyPanel />}
        {view === 'boosts' && <UpgradesPanel />}
        {view === 'products' && <ProductsPanel />}
      </div>
    </div>
  );
}
