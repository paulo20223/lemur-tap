/**
 * Custom inline-SVG icon set for Lemur Tap.
 *
 * No external icon libraries, no emoji — every icon is a hand-built SVG so the
 * app reads as intentional, not templated. Line icons use `currentColor` so the
 * caller controls color via CSS (e.g. nav active state). Filled/duotone icons
 * that need their own palette (CoinIcon, EnergyIcon) define gradients inline
 * with a UNIQUE id per render-site is avoided by giving each component a stable
 * unique gradient id (collision-safe across the document).
 *
 * Signature for every export:
 *   (props: { size?: number; className?: string }) => JSX.Element
 */

interface IconProps {
  size?: number;
  className?: string;
}

const BASE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function svgProps(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    className,
    'aria-hidden': true,
    focusable: false as const,
  };
}

/* ── Navigation ────────────────────────────────────────────────────────── */

export const TapIcon = ({ size = 24, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <path
      {...BASE}
      d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11"
    />
    <path
      {...BASE}
      d="M12 11V9.5a1.5 1.5 0 0 1 3 0V11M15 11v-1a1.5 1.5 0 0 1 3 0v5.5a5.5 5.5 0 0 1-5.5 5.5h-1.2a5.5 5.5 0 0 1-4.3-2.07l-2.4-3.02a1.6 1.6 0 0 1 2.3-2.2L9 13.5"
    />
  </svg>
);

export const FruitIcon = ({ size = 24, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <path
      {...BASE}
      d="M14.5 8.5a6 6 0 1 1-8.4 8.4 6 6 0 0 1 8.4-8.4Z"
    />
    <path {...BASE} d="M13.5 9.5 18 5" />
    <path {...BASE} d="M16.5 4.2c1.2-.5 2.6-.4 3.3.3.7.7.8 2.1.3 3.3-1.3.2-2.6-.1-3.6-1-.9-1-1.2-2.3-1-3.6Z" />
  </svg>
);

export const BasketIcon = ({ size = 24, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    {/* handle */}
    <path {...BASE} d="M8 9.5V8.5a4 4 0 0 1 8 0v1" />
    {/* rim */}
    <path {...BASE} d="M3 9.5h18" />
    {/* tapered body with rounded base */}
    <path {...BASE} d="M4.4 9.5 5.7 18a2 2 0 0 0 1.98 1.7h8.64A2 2 0 0 0 18.3 18l1.3-8.5" />
    {/* weave */}
    <path {...BASE} d="M9.3 11.6 9.9 17.6M14.7 11.6 14.1 17.6M12 11.6v6" />
  </svg>
);

/**
 * Telegram Stars glyph — a clean, slightly rounded 5-point star, filled with
 * currentColor so the Stars buy button tints it gold. Replaces the ⭐ emoji
 * (which renders inconsistently and reads unpremium).
 */
export const StarIcon = ({ size = 24, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <path
      fill="currentColor"
      stroke="currentColor"
      strokeWidth={1.1}
      strokeLinejoin="round"
      d="M12 3.4a.9.9 0 0 1 .82.52l2.2 4.62 5.04.72a.9.9 0 0 1 .5 1.54l-3.66 3.5.88 5.02a.9.9 0 0 1-1.31.95L12 18.4l-4.47 2.38a.9.9 0 0 1-1.31-.95l.88-5.02-3.66-3.5a.9.9 0 0 1 .5-1.54l5.04-.72 2.2-4.62A.9.9 0 0 1 12 3.4Z"
    />
  </svg>
);

export const DailyIcon = GiftIconBody;

/**
 * Coupon ticket — the Play tab (the coupon-catching game).
 *
 * A voucher with a vertical tear-perforation that splits it into a main panel
 * and a stub, twin concave notches where the perforation meets the edges, and a
 * four-point sparkle on the main panel reading as "reward/value". Pure line work
 * on `currentColor` so it inherits the nav's active (white-on-clay) state and
 * focus ring exactly like its neighbours.
 */
export const CouponIcon = ({ size = 24, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    {/* ticket body: rounded rect with concave notches top & bottom at the tear */}
    <path
      {...BASE}
      d="M5 6H12.6A1.4 1.4 0 0 0 15.4 6H19A2 2 0 0 1 21 8V16A2 2 0 0 1 19 18H15.4A1.4 1.4 0 0 0 12.6 18H5A2 2 0 0 1 3 16V8A2 2 0 0 1 5 6Z"
    />
    {/* tear perforation */}
    <path {...BASE} strokeDasharray="0.1 2.1" d="M14 7.7V16.3" />
    {/* four-point sparkle on the main panel — pointed tips via miter join */}
    <path
      {...BASE}
      strokeLinejoin="miter"
      strokeMiterlimit={10}
      d="M8.4 9.1Q8.4 12 11 12Q8.4 12 8.4 14.9Q8.4 12 5.8 12Q8.4 12 8.4 9.1Z"
    />
  </svg>
);

/** Price tag — the "Товары" goods catalog (baskets + skins). */
export const TagIcon = ({ size = 24, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <path
      {...BASE}
      d="M4 4.5h6.2a2 2 0 0 1 1.42.59l7.3 7.3a2 2 0 0 1 0 2.82l-5.32 5.32a2 2 0 0 1-2.82 0l-7.3-7.3A2 2 0 0 1 3 11.7V5.5a1 1 0 0 1 1-1Z"
    />
    <circle {...BASE} cx="8" cy="8.5" r="1.4" />
  </svg>
);

/** Theatrical mask — the cosmetic "Lemusters" skins section. */
export const SkinIcon = ({ size = 24, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <path
      {...BASE}
      d="M5 5.5c3 .8 11 .8 14 0 .6 4-.4 9.5-3 12.2-1.3 1.3-2.7 2-4 2s-2.7-.7-4-2C5.4 15 4.4 9.5 5 5.5Z"
    />
    <path {...BASE} d="M9 10c.8-.6 1.7-.6 2.4 0M12.6 10c.7-.6 1.6-.6 2.4 0" />
    <path {...BASE} d="M10.4 14.5c1 .7 2.2.7 3.2 0" />
  </svg>
);

export const BoostsIcon = ({ size = 24, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <path
      {...BASE}
      d="M13 3 5 13h5l-1 8 8-10h-5l1-8Z"
    />
  </svg>
);

/** Lightning bolt — the Rewards hub (daily bonus + boosts). */
export const BoltIcon = BoostsIcon;

/** Storefront with awning — the Магазин hub (daily + boosts + goods). */
export const ShopIcon = ({ size = 24, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    {/* awning */}
    <path {...BASE} d="M4 4.5h16l1 4.5a2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-2 0L4 4.5Z" />
    {/* shop body */}
    <path {...BASE} d="M5 10.2V20h14v-9.8" />
    {/* door */}
    <path {...BASE} d="M10 20v-5h4v5" />
  </svg>
);

export const StakeIcon = ({ size = 24, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <path {...BASE} d="M12 3.5 20 7l-8 3.5L4 7l8-3.5Z" />
    <path {...BASE} d="M5 11v5.5l7 3 7-3V11" />
    <path {...BASE} d="M12 10.5v9" />
  </svg>
);

export const FriendsIcon = ({ size = 24, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <circle {...BASE} cx="9" cy="8.5" r="3" />
    <path {...BASE} d="M3.5 19a5.5 5.5 0 0 1 11 0" />
    <path {...BASE} d="M16 6a3 3 0 0 1 0 5.6" />
    <path {...BASE} d="M17 14.2A5.5 5.5 0 0 1 20.5 19" />
  </svg>
);

/* ── Currency / stats ──────────────────────────────────────────────────── */

export const CoinIcon = ({ size = 24, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <defs>
      <linearGradient id="coinGrad-lemur" x1="5" y1="3" x2="19" y2="21" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#ffd27a" />
        <stop offset="0.5" stopColor="#ffb020" />
        <stop offset="1" stopColor="#e8860a" />
      </linearGradient>
      <radialGradient id="coinHi-lemur" cx="0.38" cy="0.32" r="0.5">
        <stop offset="0" stopColor="#fff6df" stopOpacity="0.95" />
        <stop offset="1" stopColor="#fff6df" stopOpacity="0" />
      </radialGradient>
    </defs>
    <circle cx="12" cy="12" r="9.5" fill="url(#coinGrad-lemur)" />
    <circle cx="12" cy="12" r="9.5" fill="url(#coinHi-lemur)" />
    <circle cx="12" cy="12" r="6.6" fill="none" stroke="#e8860a" strokeOpacity="0.5" strokeWidth="1.3" />
    <path
      d="M12 8.2v7.6M10 9.7h3a1.6 1.6 0 0 1 0 3.2h-3M10 11.2h2.7"
      fill="none"
      stroke="#b96a06"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const EnergyIcon = ({ size = 24, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <defs>
      <linearGradient id="energyGrad-lemur" x1="7" y1="2" x2="17" y2="22" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#ffb74d" />
        <stop offset="0.55" stopColor="#ff7a1a" />
        <stop offset="1" stopColor="#f15e00" />
      </linearGradient>
    </defs>
    <path
      d="M13 2.5 5.5 13.2a.9.9 0 0 0 .74 1.4H10l-1 7 8.9-11.2a.9.9 0 0 0-.73-1.45H12l1-6.45Z"
      fill="url(#energyGrad-lemur)"
      stroke="#e8860a"
      strokeOpacity="0.5"
      strokeWidth="0.8"
      strokeLinejoin="round"
    />
  </svg>
);

/* ── Utility ───────────────────────────────────────────────────────────── */

function GiftIconBody({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path {...BASE} d="M4 11h16v8.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V11Z" />
      <path {...BASE} d="M3 8h18v3H3z" />
      <path {...BASE} d="M12 8v12.5" />
      <path
        {...BASE}
        d="M12 8C9.5 8 7 7.4 7 5.6 7 4.4 8 3.5 9.2 3.5c1.7 0 2.8 2 2.8 4.5Z"
      />
      <path
        {...BASE}
        d="M12 8c2.5 0 5-.6 5-2.4 0-1.2-1-2.1-2.2-2.1-1.7 0-2.8 2-2.8 4.5Z"
      />
    </svg>
  );
}

export const GiftIcon = GiftIconBody;

export const FlameIcon = ({ size = 24, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <path
      {...BASE}
      d="M12 3c.5 3-1.8 4.2-3.2 6.2A6 6 0 0 0 12 21a6 6 0 0 0 6-6c0-2.4-1.3-3.7-2.4-5.2-.9 1-1.6 1.4-2.3 1.4 1-2.6-.2-5.4-1.3-8.2Z"
    />
    <path {...BASE} d="M10.2 17.2a2 2 0 0 0 3.6-1.2c0-1-.8-1.6-1.3-2.4-.7.9-2.3 1.5-2.3 3.6Z" />
  </svg>
);

export const VaultIcon = ({ size = 24, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <rect {...BASE} x="3" y="4.5" width="18" height="15" rx="2.5" />
    <circle {...BASE} cx="11" cy="12" r="3.5" />
    <path {...BASE} d="M11 8.5v1.2M11 14.3v1.2M14.5 12h-1.2M8.7 12H7.5" />
    <path {...BASE} d="M18 9.5v5" />
  </svg>
);

export const UsersIcon = FriendsIcon;

/** Single person — the Profile identity. */
export const UserIcon = ({ size = 24, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <circle {...BASE} cx="12" cy="8" r="3.6" />
    <path {...BASE} d="M5.5 20a6.5 6.5 0 0 1 13 0" />
  </svg>
);

export const PlusIcon = ({ size = 24, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <path {...BASE} d="M12 5v14M5 12h14" />
  </svg>
);

export const CheckIcon = ({ size = 24, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <path {...BASE} d="m4.5 12.5 4.5 4.5 10.5-11" />
  </svg>
);

export const CopyIcon = ({ size = 24, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <rect {...BASE} x="9" y="9" width="11" height="11" rx="2.6" />
    <path
      {...BASE}
      d="M5 15h-.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"
    />
  </svg>
);

export const SendIcon = ({ size = 24, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <path {...BASE} d="M20.5 3.5 11 13" />
    <path {...BASE} d="M20.5 3.5 14 20.5l-3-7.5-7.5-3 17-6.5Z" />
  </svg>
);

export const LockIcon = ({ size = 24, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <rect {...BASE} x="4.5" y="10.5" width="15" height="10" rx="2.5" />
    <path {...BASE} d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    <path {...BASE} d="M12 14.5v2.5" />
  </svg>
);

export const ChevronRightIcon = ({ size = 24, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <path {...BASE} d="m9 5 7 7-7 7" />
  </svg>
);

export const ClockIcon = ({ size = 24, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <circle {...BASE} cx="12" cy="12" r="8.5" />
    <path {...BASE} d="M12 7.5V12l3 2" />
  </svg>
);

export const TrophyIcon = ({ size = 24, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <path {...BASE} d="M7 4.5h10v4a5 5 0 0 1-10 0v-4Z" />
    <path {...BASE} d="M7 6H4.5v1.5A3 3 0 0 0 7 10.4M17 6h2.5v1.5A3 3 0 0 1 17 10.4" />
    <path {...BASE} d="M12 13.5V17M9 20h6M9.5 20a2.5 2.5 0 0 1 5 0" />
  </svg>
);

/** Crown — the #1 marker on the leaderboard podium. */
export const CrownIcon = ({ size = 24, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <path
      {...BASE}
      d="M4 8.4 7.3 15.5h9.4L20 8.4l-4.4 3.1L12 5l-3.6 6.5L4 8.4Z"
    />
    <path {...BASE} d="M7 18.5h10" />
  </svg>
);
