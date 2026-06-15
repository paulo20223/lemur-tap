/**
 * Bottom navigation — a floating clay "dock". Links the 5 primary routes; the
 * active route is highlighted by a single raised clay indicator that glides
 * (and momentarily squashes, like a liquid drop) between slots. Screen agents
 * do not touch this — routes are fixed.
 */
import { useEffect, useRef, type ComponentType } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  CouponIcon,
  ShopIcon,
  TrophyIcon,
  VaultIcon,
  UserIcon,
} from './icons';
import { useT, type MessageKey } from '../i18n';

interface NavItem {
  to: string;
  /** i18n key for the slot label. */
  labelKey: MessageKey;
  Icon: ComponentType<{ size?: number; className?: string }>;
}

// Leaderboard sits dead-center of the five slots — the social peak of the loop.
const ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.play', Icon: CouponIcon },
  { to: '/shop', labelKey: 'nav.shop', Icon: ShopIcon },
  { to: '/leaderboard', labelKey: 'nav.ranks', Icon: TrophyIcon },
  { to: '/staking', labelKey: 'nav.stake', Icon: VaultIcon },
  { to: '/profile', labelKey: 'nav.profile', Icon: UserIcon },
];

/** Index of the route the current pathname belongs to (0 = Play / fallback). */
function activeIndex(pathname: string): number {
  const i = ITEMS.findIndex(({ to }) =>
    to === '/' ? pathname === '/' : pathname.startsWith(to),
  );
  return i === -1 ? 0 : i;
}

export function Nav() {
  const { pathname } = useLocation();
  const index = activeIndex(pathname);
  const t = useT();

  // Drive the in-flight squash-stretch: flag the indicator as "moving" for the
  // duration of the slide whenever the active slot changes.
  const indicatorRef = useRef<HTMLDivElement>(null);
  const prev = useRef(index);

  useEffect(() => {
    if (prev.current === index) return;
    prev.current = index;
    const el = indicatorRef.current;
    if (!el) return;
    el.setAttribute('data-moving', '');
    const t = setTimeout(() => el.removeAttribute('data-moving'), 230);
    return () => clearTimeout(t);
  }, [index]);

  return (
    <nav className="nav" aria-label="Primary">
      <div className="nav__list" style={{ '--active-index': index } as React.CSSProperties}>
        <div className="nav__indicator" ref={indicatorRef} aria-hidden />
        {ITEMS.map(({ to, labelKey, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              isActive ? 'nav__item nav__item--active' : 'nav__item'
            }
          >
            <span className="nav__icon" aria-hidden>
              <Icon size={20} />
            </span>
            <span className="nav__label">{t(labelKey)}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
