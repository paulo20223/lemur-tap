/**
 * Rewards screen — the merged home for the daily bonus (spec/app/07) and the
 * upgrade shop (spec/app/04), switched by the shared <SegmentedToggle>.
 *
 * The two former screens keep all of their logic; they render here as panels
 * (DailyPanel / UpgradesPanel). This parent owns only the chrome: the
 * Daily/Boosts toggle and a persistent coin balance (relevant to both — daily
 * pays coins, boosts spend them).
 *
 * Layout mirrors the Daily panel's contract: a fixed full-height column. The
 * toggle row pins to the top; the body fills the rest. Daily fits without
 * scrolling; Boosts scrolls inside the body so the toggle stays put.
 *
 * Back-compat: /daily and /upgrades both route here and redirect to /rewards,
 * passing the intended view via location state so a deep link can open Boosts.
 */
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useGameStore } from '../../store';
import {
  SegmentedToggle,
  type SegmentOption,
} from '../../components/SegmentedToggle';
import { CoinIcon, DailyIcon, BoostsIcon } from '../../components/icons';
import { useT } from '../../i18n';
import DailyPanel from '../Daily/Daily';
import UpgradesPanel from '../Upgrades/Upgrades';
import './rewards.css';

type View = 'daily' | 'boosts';

function formatCoins(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export default function Rewards() {
  const location = useLocation();
  const t = useT();
  const initialView: View =
    (location.state as { view?: View } | null)?.view === 'boosts'
      ? 'boosts'
      : 'daily';

  const [view, setView] = useState<View>(initialView);
  const coins = useGameStore((s) => s.profile?.coins ?? 0);

  const segments: [SegmentOption<View>, SegmentOption<View>] = [
    { value: 'daily', label: t('rewards.daily'), Icon: DailyIcon },
    { value: 'boosts', label: t('rewards.boosts'), Icon: BoostsIcon },
  ];

  return (
    <div className="screen rewards">
      <header className="rewards__head">
        <SegmentedToggle
          segments={segments}
          value={view}
          onChange={setView}
          label={t('rewards.sectionLabel')}
          idPrefix="rewards"
        />

        <div className="rewards__balance num" title={t('rewards.yourCoins')}>
          <CoinIcon size={18} className="rewards__balance-coin" />
          {formatCoins(coins)}
        </div>
      </header>

      <div
        className="rewards__body"
        role="tabpanel"
        id={`rewards-panel-${view}`}
        aria-labelledby={`rewards-tab-${view}`}
      >
        {view === 'daily' ? <DailyPanel /> : <UpgradesPanel />}
      </div>
    </div>
  );
}
