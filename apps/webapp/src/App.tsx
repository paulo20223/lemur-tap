/**
 * App shell: bootstrap (Telegram ready -> auth -> load /me + /config), then
 * render the router with the bottom navigation.
 *
 * Routing uses HashRouter — friendliest inside the Telegram in-app browser,
 * where path-based history can be unreliable. Routes are pre-wired to ALL
 * screens; each screen lives at src/screens/<Name>/<Name>.tsx (default export)
 * and is the ONLY file its agent creates.
 */
import { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';

import { Nav } from './components/Nav';
import LemurMascot from './components/LemurMascot';
import ErrorBoundary from './components/ErrorBoundary';
import { useGameStore, startEnergyTicker } from './store';
import { useT } from './i18n';

// Screen imports (default exports). These resolve once each screen agent adds
// its folder; the contract is documented in the orchestrator return.
import CouponGame from './screens/CouponGame/CouponGame';
import Shop from './screens/Shop/Shop';
import Staking from './screens/Staking/Staking';
import Leaderboard from './screens/Leaderboard/Leaderboard';
import Profile from './screens/Profile/Profile';

function BootGate({ children }: { children: React.ReactNode }) {
  const boot = useGameStore((s) => s.boot);
  const error = useGameStore((s) => s.error);
  const bootstrap = useGameStore((s) => s.bootstrap);
  const t = useT();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Drive the client-side energy regen while the app is mounted.
  useEffect(() => {
    if (boot !== 'ready') return;
    return startEnergyTicker(1000);
  }, [boot]);

  if (boot === 'error') {
    return (
      <div className="boot boot--error">
        <div className="boot__title">{t('boot.cantStart')}</div>
        <div className="boot__msg">{error ?? t('common.unknownError')}</div>
        <button className="btn" onClick={() => void bootstrap()}>
          {t('common.retry')}
        </button>
      </div>
    );
  }

  if (boot !== 'ready') {
    return (
      <div className="boot">
        <div className="boot__logo">
          <LemurMascot size={96} />
        </div>
        <div className="boot__title">Lemur Tap</div>
        <div className="spinner" />
      </div>
    );
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <HashRouter>
      <BootGate>
        <div className="app">
          <main className="app__content">
            <ErrorBoundary>
              <Routes>
                <Route path="/" element={<CouponGame />} />
                <Route path="/shop" element={<Shop />} />
                {/* Back-compat: the old split routes now redirect into the
                    merged Shop screen, preselecting the matching segment. */}
                <Route
                  path="/rewards"
                  element={<Navigate to="/shop" replace />}
                />
                <Route path="/daily" element={<Navigate to="/shop" replace />} />
                <Route
                  path="/upgrades"
                  element={
                    <Navigate to="/shop" replace state={{ view: 'boosts' }} />
                  }
                />
                <Route path="/staking" element={<Staking />} />
                <Route path="/leaderboard" element={<Leaderboard />} />
                <Route path="/profile" element={<Profile />} />
                {/* Back-compat: the former standalone Friends screen now lives
                    as a tab of Profile. */}
                <Route
                  path="/referral"
                  element={<Navigate to="/profile" replace />}
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </ErrorBoundary>
          </main>
          <Nav />
        </div>
      </BootGate>
    </HashRouter>
  );
}
