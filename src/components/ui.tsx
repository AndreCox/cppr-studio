import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

const PATHS: Record<string, React.ReactNode> = {
  plus: <><path d="M12 5v14M5 12h14" /></>,
  minus: <path d="M5 12h14" />,
  trash: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  undo: <><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></>,
  redo: <><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" /></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5M12 15V3" /></>,
  upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 8l5-5 5 5M12 3v12" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4M12 17h.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></>,
  alert: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></>,
  error: <><circle cx="12" cy="12" r="9" /><path d="M15 9l-6 6M9 9l6 6" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  checkCircle: <><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  chevronUp: <path d="m6 15 6-6 6 6" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  sliders: <><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" /><path d="M1 14h6M9 8h6M17 16h6" /></>,
  cube: <><path d="m21 16-9 5-9-5V8l9-5 9 5v8z" /><path d="M3 8l9 5 9-5M12 21v-8" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  crosshair: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></>,
  zap: <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />,
  spline: <><path d="M4 20c4 0 4-16 8-16s4 16 8 16" /><circle cx="4" cy="20" r="1.5" /><circle cx="20" cy="20" r="1.5" /><circle cx="12" cy="4" r="1.5" /></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>,
  table: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" /></>,
  chart: <><path d="M3 3v18h18" /><path d="M7 14l4-4 3 3 5-6" /></>,
  ruler: <><path d="M21 15 9 3 3 9l12 12 6-6z" /><path d="M7 11l2 2M11 7l2 2M15 15l2 2" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
  play: <path d="m6 3 14 9-14 9V3z" />,
  pause: <><path d="M8 4v16M16 4v16" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  zoomIn: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3M11 8v6M8 11h6" /></>,
  zoomOut: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3M8 11h6" /></>,
  maximize: <><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" /></>,
  external: <><path d="M15 3h6v6M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" /></>,
  save: <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></>,
  folder: <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  wrench: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5 2.5-2.5z" />,
  package: <><path d="m21 16-9 5-9-5V8l9-5 9 5v8z" /><path d="M3 8l9 5 9-5M12 21v-8M7.5 5.5l9 5" /></>,
  arrowRight: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  arrowUp: <path d="M12 19V5M5 12l7-7 7 7" />,
  arrowDown: <path d="M12 5v14M19 12l-7 7-7-7" />,
  sparkles: <><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" /></>,
  rotate: <><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></>,
  scale: <><path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4" /></>,
  dot: <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />,
  layers: <><path d="m12 2 9 5-9 5-9-5 9-5z" /><path d="m3 12 9 5 9-5M3 17l9 5 9-5" /></>,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m16 8-2.5 5.5L8 16l2.5-5.5L16 8z" /></>,
  book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
};

export function Icon({ name, className = '', size, style }: { name: string; className?: string; size?: number; style?: React.CSSProperties }) {
  const path = PATHS[name] ?? PATHS.dot;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`icon ${className}`}
      style={size ? { width: size, height: size, ...style } : style}
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons / chips                                                     */
/* ------------------------------------------------------------------ */

export function Button({
  children, onClick, variant = 'default', size, icon, disabled, title, type = 'button', className = '',
}: {
  children?: React.ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'xs';
  icon?: string;
  disabled?: boolean;
  title?: string;
  type?: 'button' | 'submit';
  className?: string;
}) {
  return (
    <button
      type={type}
      className={`btn ${variant !== 'default' ? variant : ''} ${size ?? ''} ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {icon && <Icon name={icon} className={size === 'xs' ? 'sm' : ''} />}
      {children}
    </button>
  );
}

export function IconButton({
  icon, label, onClick, size = 'default', variant = 'ghost', disabled, active, title,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  size?: 'sm' | 'default';
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`btn icon ${size === 'sm' ? 'sm' : ''} ${variant !== 'default' ? variant : ''} ${active ? 'primary' : ''}`}
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} className={size === 'sm' ? 'sm' : ''} />
    </button>
  );
}

export function Chip({ children, tone = 'gray', icon }: { children: React.ReactNode; tone?: 'gray' | 'ok' | 'warn' | 'err' | 'info'; icon?: string }) {
  return (
    <span className={`chip ${tone}`}>
      {icon ? <Icon name={icon} className="sm" /> : <span className="dot" />}
      {children}
    </span>
  );
}

export function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const hostRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const host = hostRef.current;
    const tip = tipRef.current;
    if (!host || !tip) return;
    const r = host.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    const margin = 8;
    const gap = 10;
    // Keep the popover over the canvas rather than over an input. If the field
    // lives in a sidebar, anchor to the outside edge of that sidebar.
    const panel = host.closest('.sidebar') as HTMLElement | null;
    let left: number;
    let top: number;
    if (panel) {
      const pr = panel.getBoundingClientRect();
      left = pr.left - tr.width - gap;
      if (left < margin) left = pr.right + gap;
      top = r.top + r.height / 2 - tr.height / 2;
    } else {
      left = r.left - tr.width - gap;
      top = r.top + r.height / 2 - tr.height / 2;
      if (left < margin) left = r.right + gap;
    }
    if (left + tr.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - tr.width - margin);
      top = r.bottom + gap;
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - tr.height - margin));
    setPos({ left, top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (hostRef.current?.contains(target) || tipRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onFocus = (e: FocusEvent) => {
      const target = e.target as Node;
      if (hostRef.current?.contains(target) || tipRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <span className="tooltip-host" ref={hostRef}>
      <button
        type="button"
        className="tooltip-trigger"
        aria-label="Show field help"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {children}
      </button>
      {open && createPortal(
        <span
          ref={tipRef}
          className="tooltip"
          role="tooltip"
          style={pos
            ? { left: pos.left, top: pos.top }
            : { left: -9999, top: -9999, visibility: 'hidden' }}
        >
          {text}
        </span>,
        document.body,
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

export function Field({ label, hint, tooltip, children, htmlFor }: {
  label: string; hint?: React.ReactNode; tooltip?: string; children: React.ReactNode; htmlFor?: string;
}) {
  return (
    <div className="field">
      <div className="field-label">
        <span className="label-help">
          <label htmlFor={htmlFor}>{label}</label>
          {tooltip && (
            <Tooltip text={tooltip}>
              <Icon name="help" className="sm" />
            </Tooltip>
          )}
        </span>
        {hint !== undefined && <span className="hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

const clampNum = (v: number, min?: number, max?: number) => {
  if (min !== undefined && v < min) return min;
  if (max !== undefined && v > max) return max;
  return v;
};

export function NumberField({
  label, value, onChange, unit, min, max, step = 0.1, precision = 2, hint, tooltip,
  disabled, placeholder, className = '',
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  hint?: React.ReactNode;
  tooltip?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  const [text, setText] = useState(() => (Number.isFinite(value) ? value.toFixed(precision) : ''));
  const [focused, setFocused] = useState(false);
  const invalid = !Number.isFinite(Number(text)) || text.trim() === '';

  useEffect(() => {
    if (!focused) setText(Number.isFinite(value) ? value.toFixed(precision) : '');
  }, [value, precision, focused]);

  const commit = (raw: string, clamp: boolean) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || raw.trim() === '') return;
    const v = clamp ? clampNum(n, min, max) : n;
    if (v !== value) onChange(v);
    if (clamp) setText(v.toFixed(precision));
  };

  return (
    <div className={className}>
      <div className="field-label">
        <span className="label-help">
          <label htmlFor={id}>{label}</label>
          {tooltip && (
            <Tooltip text={tooltip}>
              <Icon name="help" className="sm" />
            </Tooltip>
          )}
        </span>
        {hint !== undefined && <span className="hint">{hint}</span>}
      </div>
      <div className="input-wrap">
        <input
          id={id}
          className={`input ${unit ? 'with-unit' : ''} ${invalid && focused ? 'err' : ''}`}
          type="number"
          inputMode="decimal"
          value={text}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={() => setFocused(true)}
          onChange={(e) => {
            setText(e.target.value);
            commit(e.target.value, false);
          }}
          onBlur={(e) => {
            setFocused(false);
            commit(e.target.value, true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        {unit && <span className="input-unit">{unit}</span>}
      </div>
    </div>
  );
}

export function SelectField({
  label, value, onChange, options, hint, tooltip, disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  hint?: React.ReactNode;
  tooltip?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} tooltip={tooltip} htmlFor={id}>
      <div className="input-wrap">
        <select id={id} className="input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
          ))}
        </select>
      </div>
    </Field>
  );
}

export function Slider({
  label, value, min, max, step, onChange, display, hint, tooltip,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display?: React.ReactNode;
  hint?: React.ReactNode;
  tooltip?: string;
}) {
  return (
    <div className="field">
      <div className="field-label">
        <span className="label-help">
          {label}
          {tooltip && (
            <Tooltip text={tooltip}>
              <Icon name="help" className="sm" />
            </Tooltip>
          )}
        </span>
        <span className="hint" style={{ color: 'var(--text)', fontWeight: 600 }}>{display}</span>
      </div>
      <input
        className="range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : min}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
      {hint !== undefined && <div className="range-labels"><span>{hint}</span></div>}
    </div>
  );
}

export function LogSlider({
  label, value, min, max, onChange, format, hint, tooltip,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  hint?: React.ReactNode;
  tooltip?: string;
}) {
  const lo = Math.log10(Math.max(1e-6, min));
  const hi = Math.log10(Math.max(1e-5, max));
  const t = (Math.log10(Math.max(1e-6, value)) - lo) / (hi - lo);
  return (
    <div className="field">
      <div className="field-label">
        <span className="label-help">
          {label}
          {tooltip && (
            <Tooltip text={tooltip}>
              <Icon name="help" className="sm" />
            </Tooltip>
          )}
        </span>
        <span className="hint" style={{ color: 'var(--text)', fontWeight: 600 }}>{format(value)}</span>
      </div>
      <input
        className="range"
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={Math.max(0, Math.min(1, t))}
        onChange={(e) => {
          const tt = Number(e.target.value);
          onChange(Math.pow(10, lo + tt * (hi - lo)));
        }}
        aria-label={label}
      />
      {hint !== undefined && <div className="range-labels"><span>{hint}</span></div>}
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint, disabled }: {
  label: React.ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: string; disabled?: boolean;
}) {
  return (
    <label className="toggle" title={hint} style={{ opacity: disabled ? 0.5 : 1 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span>{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string; icon?: string }[];
}) {
  return (
    <div className="btn-group">
      {options.map((o) => (
        <button key={o.value} type="button" className={`btn sm ${value === o.value ? 'on' : ''}`} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} className="sm" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export function Collapsible({
  title, children, defaultOpen = true, badge, id,
}: {
  title: string; children: React.ReactNode; defaultOpen?: boolean; badge?: React.ReactNode; id?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="insp-section" id={id}>
      <button type="button" className={`insp-head ${open ? '' : 'closed'}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="flex gap6">
          <span className="t">{title}</span>
          {badge}
        </span>
        <Icon name="chevronDown" className="chev" size={14} />
      </button>
      {open && <div className="insp-body">{children}</div>}
    </section>
  );
}

export function Modal({
  title, subtitle, children, footer, onClose, narrow,
}: {
  title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode; onClose: () => void; narrow?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${narrow ? 'narrow' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="stat">
      <div className="v">{value}</div>
      <div className="l">{label}</div>
    </div>
  );
}

export function useDebounced<T>(value: T, delay: number): T {
  const [v, setV] = useState(value);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setV(value), delay);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [value, delay]);
  return v;
}

export const fmt = {
  mm: (v: number, d = 2) => `${v.toFixed(d)} mm`,
  deg: (v: number, d = 1) => `${(v * 180) / Math.PI > 0 ? '+' : ''}${((v * 180) / Math.PI).toFixed(d)}°`,
  pct: (v: number, d = 1) => `${(v * 100).toFixed(d)}%`,
  kappa: (v: number) => `${(v * 1000).toFixed(1)} 1/m`,
  radius: (v: number) => (Math.abs(v) > 1e-9 ? `${(1 / Math.abs(v)).toFixed(1)} mm` : '∞'),
  num: (v: number, d = 2) => v.toFixed(d),
};
