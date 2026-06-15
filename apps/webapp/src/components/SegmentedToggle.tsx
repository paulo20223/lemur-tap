/**
 * SegmentedToggle — the app's N-segment switcher.
 *
 * A carved, sunken track with one raised clay thumb that glides (and momentarily
 * squashes, like a liquid drop) between the segments — the same motion language
 * as the bottom-nav indicator. Generalises the control that the Shop and Profile
 * pages use to merge former screens behind one header.
 *
 * Geometry is data-driven: `--seg-count` sizes the grid and the thumb (one slot
 * = 100/n%), so the same component handles a 2-up Profile toggle and a 3-up Shop
 * toggle. Pass any number of `segments`.
 *
 * Accessibility: renders an ARIA tablist with roving tabindex and Left/Right
 * arrow navigation across all n segments. The parent owns the panels and must
 * give each one id={`${idPrefix}-panel-${value}`} so aria-controls resolves.
 */
import {
  useEffect,
  useRef,
  type ComponentType,
  type KeyboardEvent,
} from 'react';
import './segmented-toggle.css';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  Icon?: ComponentType<{ size?: number; className?: string }>;
}

interface SegmentedToggleProps<T extends string> {
  /** Two or more segments; geometry adapts via `--seg-count`. */
  segments: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the tablist. */
  label: string;
  /** Id prefix; panels must use id={`${idPrefix}-panel-${value}`}. */
  idPrefix: string;
}

export function SegmentedToggle<T extends string>({
  segments,
  value,
  onChange,
  label,
  idPrefix,
}: SegmentedToggleProps<T>) {
  const count = segments.length;
  const activeIndex = Math.max(
    0,
    segments.findIndex((s) => s.value === value),
  );

  // Squash-stretch the sliding thumb while it travels between segments.
  const thumbRef = useRef<HTMLSpanElement>(null);
  const prevIndex = useRef(activeIndex);
  useEffect(() => {
    if (prevIndex.current === activeIndex) return;
    prevIndex.current = activeIndex;
    const el = thumbRef.current;
    if (!el) return;
    el.setAttribute('data-moving', '');
    const t = window.setTimeout(() => el.removeAttribute('data-moving'), 230);
    return () => window.clearTimeout(t);
  }, [activeIndex]);

  // Left/Right arrows move between segments (roving-tab keyboard support).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const next = (activeIndex + dir + count) % count;
    const seg = segments[next];
    if (seg) onChange(seg.value);
  };

  return (
    <div
      className="segtab"
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      style={
        {
          '--active-index': activeIndex,
          '--seg-count': count,
        } as React.CSSProperties
      }
    >
      <span className="segtab__thumb" ref={thumbRef} aria-hidden />
      {segments.map(({ value: v, label: segLabel, Icon }) => {
        const selected = v === value;
        return (
          <button
            key={v}
            role="tab"
            type="button"
            id={`${idPrefix}-tab-${v}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${v}`}
            tabIndex={selected ? 0 : -1}
            className={
              selected ? 'segtab__seg segtab__seg--active' : 'segtab__seg'
            }
            onClick={() => onChange(v)}
          >
            {Icon && <Icon size={17} className="segtab__seg-icon" />}
            {segLabel}
          </button>
        );
      })}
    </div>
  );
}
