/**
 * LemurMascot — the claymorphic 3D lemur character for Lemur Tap.
 *
 * A single self-contained inline SVG: soft body with radial-gradient shading,
 * a ring-tailed silhouette, big friendly eyes, warm cream + soft-grey palette
 * that pops on the orange theme, a contact shadow ellipse, and glossy
 * highlights so it reads as 3D / clay.
 *
 * `pressed` only shifts an internal gloss highlight — the CALLER owns the
 * wrapper transform/shadow for the actual "push down" motion.
 *
 *   (props: { pressed?: boolean; size?: number; className?: string }) => JSX.Element
 */

interface MascotProps {
  pressed?: boolean;
  size?: number;
  className?: string;
}

export default function LemurMascot({
  pressed = false,
  size = 220,
  className,
}: MascotProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 220 220"
      className={className}
      role="img"
      aria-label="Lemur mascot"
    >
      <defs>
        {/* Body clay shading */}
        <radialGradient id="lm-body" cx="0.4" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#fff6ea" />
          <stop offset="0.55" stopColor="#f3e3d2" />
          <stop offset="1" stopColor="#d8c2ad" />
        </radialGradient>
        {/* Grey head/cap */}
        <radialGradient id="lm-grey" cx="0.42" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#b9b3ad" />
          <stop offset="0.6" stopColor="#938c85" />
          <stop offset="1" stopColor="#6f6862" />
        </radialGradient>
        {/* Muzzle */}
        <radialGradient id="lm-muzzle" cx="0.5" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#efe2d4" />
        </radialGradient>
        {/* Tail rings shading */}
        <linearGradient id="lm-tail" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5c5650" />
          <stop offset="1" stopColor="#34302c" />
        </linearGradient>
        {/* Eye gleam */}
        <radialGradient id="lm-eye" cx="0.4" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#6a4a2c" />
          <stop offset="1" stopColor="#2a1a0c" />
        </radialGradient>
        <radialGradient id="lm-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffb74d" stopOpacity="0.45" />
          <stop offset="1" stopColor="#ffb74d" stopOpacity="0" />
        </radialGradient>
        <filter id="lm-soft" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      {/* Warm halo behind the character */}
      <circle cx="110" cy="104" r="86" fill="url(#lm-glow)" />

      {/* Contact shadow */}
      <ellipse
        cx="110"
        cy="196"
        rx="64"
        ry="13"
        fill="#c9540a"
        opacity="0.18"
        filter="url(#lm-soft)"
      />

      {/* Ring tail — curls up the right side */}
      <g>
        <path
          d="M150 150c34 6 46-22 36-46-8-19-30-24-42-12"
          fill="none"
          stroke="url(#lm-tail)"
          strokeWidth="17"
          strokeLinecap="round"
        />
        <path
          d="M150 150c34 6 46-22 36-46-8-19-30-24-42-12"
          fill="none"
          stroke="#efe7df"
          strokeWidth="17"
          strokeLinecap="round"
          strokeDasharray="2 16"
          opacity="0.9"
        />
      </g>

      {/* Body */}
      <ellipse cx="106" cy="138" rx="52" ry="56" fill="url(#lm-body)" />
      {/* Belly highlight */}
      <ellipse cx="100" cy="132" rx="30" ry="36" fill="#ffffff" opacity="0.45" />

      {/* Feet */}
      <ellipse cx="86" cy="188" rx="14" ry="9" fill="#e7d6c4" />
      <ellipse cx="126" cy="188" rx="14" ry="9" fill="#e7d6c4" />

      {/* Ears */}
      <circle cx="74" cy="58" r="17" fill="url(#lm-grey)" />
      <circle cx="146" cy="58" r="17" fill="url(#lm-grey)" />
      <circle cx="74" cy="58" r="9" fill="#3b3531" opacity="0.55" />
      <circle cx="146" cy="58" r="9" fill="#3b3531" opacity="0.55" />

      {/* Head */}
      <ellipse cx="110" cy="86" rx="50" ry="46" fill="url(#lm-grey)" />

      {/* Face mask (cream) */}
      <ellipse cx="110" cy="92" rx="40" ry="38" fill="url(#lm-muzzle)" />

      {/* Dark eye patches for the lemur look */}
      <ellipse cx="92" cy="84" rx="15" ry="18" fill="#3b3531" opacity="0.85" />
      <ellipse cx="128" cy="84" rx="15" ry="18" fill="#3b3531" opacity="0.85" />

      {/* Big friendly eyes */}
      <circle cx="92" cy="86" r="11" fill="#fff7ec" />
      <circle cx="128" cy="86" r="11" fill="#fff7ec" />
      <circle cx="93" cy="87" r="7.5" fill="url(#lm-eye)" />
      <circle cx="129" cy="87" r="7.5" fill="url(#lm-eye)" />
      {/* Catchlights — nudge with pressed for a touch of life */}
      <circle cx={pressed ? 91 : 90} cy={pressed ? 86 : 84} r="2.6" fill="#ffffff" />
      <circle cx={pressed ? 127 : 126} cy={pressed ? 86 : 84} r="2.6" fill="#ffffff" />

      {/* Muzzle + nose */}
      <ellipse cx="110" cy="106" rx="13" ry="11" fill="#ffffff" opacity="0.85" />
      <path
        d="M104 104h12l-6 6Z"
        fill="#5a4636"
      />
      <path
        d="M110 110c0 4-4 5-7 4M110 110c0 4 4 5 7 4"
        fill="none"
        stroke="#a78a72"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* Glossy clay highlight on the head, shifts slightly when pressed */}
      <ellipse
        cx={pressed ? 92 : 88}
        cy={pressed ? 62 : 58}
        rx="20"
        ry="13"
        fill="#ffffff"
        opacity="0.35"
        filter="url(#lm-soft)"
      />
    </svg>
  );
}
