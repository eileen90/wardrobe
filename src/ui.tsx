import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { imgKey, showsCut, useBlobUrl } from './store';
import type { Item } from './types';

const paths: Record<string, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  back: <path d="M15 5l-7 7 7 7" />,
  hanger: (
    <>
      <path d="M12 9V8a2 2 0 1 0-2-2" />
      <path d="M12 9L3.6 15.4c-.9.7-.4 2.1.7 2.1h15.4c1.1 0 1.6-1.4.7-2.1L12 9z" />
    </>
  ),
  board: (
    <>
      <rect x="4" y="3.5" width="16" height="17" rx="2.5" />
      <path d="M8 8.5h4v5H8zM14.5 11h2M14.5 14.5h2M8 16.5h3" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.3-2h6.4l1.3 2h2A1.5 1.5 0 0 1 20 8.500v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9z" />
      <circle cx="12" cy="13" r="3.4" />
    </>
  ),
  photos: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4 17l5-4.5 3.5 3 3-2.5 4.5 4" />
    </>
  ),
  paste: (
    <>
      <rect x="5" y="5" width="14" height="16" rx="2.5" />
      <path d="M9 5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M9 12h6M9 16h4" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.700l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.700l1-1" />
    </>
  ),
  undo: <path d="M8 5L4 9l4 4M4 9h10a5 5 0 0 1 0 10h-3" />,
  share: <path d="M12 15V4M8 7.500L12 4l4 3.500M5 12v6.500A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.500V12" />,
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.2" fill="currentColor" />
    </>
  ),
  front: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" fill="currentColor" fillOpacity=".18" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  backward: (
    <>
      <rect x="4" y="4" width="12" height="12" rx="2" fill="currentColor" fillOpacity=".18" />
      <path d="M16 8h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-2" strokeDasharray="2.5 2.5" />
    </>
  ),
  flip: <path d="M12 3v18M8.5 7L4 12l4.5 5V7zM15.5 7L20 12l-4.5 5V7z" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2.5" />
      <path d="M16 8V6.500A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.500v7A2.5 2.5 0 0 0 6.5 16H8" />
    </>
  ),
  trash: <path d="M5 7h14M10 7V4.500h4V7M7 7l.8 12a1.5 1.5 0 0 0 1.5 1.400h5.400a1.5 1.5 0 0 0 1.5-1.400L17 7M10.5 11v5.500M13.5 11v5.5" />,
  text: <path d="M5 7V5h14v2M12 5v14M9 19h6" />,
  pen: <path d="M4 20l1-4L16.5 4.500a2.1 2.1 0 0 1 3 3L8 19l-4 1zM14.5 6.500l3 3" />,
  spark: <path d="M12 3l1.8 5.700L19.5 10.500l-5.7 1.800L12 18l-1.8-5.700L4.5 10.500l5.7-1.800L12 3zM19 16.500l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6.6-1.900z" />,
  heart: <path d="M12 20s-7-4.3-7-9.500A4 4 0 0 1 12 8a4 4 0 0 1 7 2.500C19 15.7 12 20 12 20z" />,
  open: <path d="M14 5h5v5M19 5l-8 8M11 6H6.500A1.5 1.5 0 0 0 5 7.500v10A1.5 1.5 0 0 0 6.5 19h10a1.5 1.5 0 0 0 1.5-1.500V13" />,
  download: <path d="M12 4v11M8 11.500l4 3.5 4-3.500M5 19.500h14" />,
  upload: <path d="M12 15V4M8 7.500L12 4l4 3.500M5 19.500h14" />,
  check: <path d="M5 12.500l4.5 4.500L19 7.5" />,
  retry: <path d="M19 12a7 7 0 1 1-2.3-5.200M19 4.500v4h-4" />,
};

export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

/** Bottom sheet. Unmounts after its closing animation. */
export function Sheet({
  open, onClose, children, tall, label,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  tall?: boolean;
  label: string;
}) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(r);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 320);
    return () => clearTimeout(t);
  }, [open]);
  if (!mounted) return null;
  return (
    <div className={`sheet-wrap ${shown ? 'on' : ''}`}>
      <div className="scrim" onClick={onClose} />
      <div className={`sheet ${tall ? 'tall' : ''}`} role="dialog" aria-modal="true" aria-label={label}>
        <div className="grabber" onClick={onClose} />
        {children}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  value, options, onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** An item's picture (thumb or full), cut-out or original as the item is set. */
export function ItemImage({ item, full, className }: { item: Item; full?: boolean; className?: string }) {
  const url = useBlobUrl(imgKey(item, !full), item.rev);
  if (!url) return <div className={`img-ph ${className ?? ''}`} />;
  return (
    <img
      className={`${showsCut(item) ? 'cut' : 'photo'} ${className ?? ''}`}
      src={url}
      alt={item.name || item.category}
      draggable={false}
    />
  );
}

// ---- toasts ----
let toast: { id: number; text: string } | null = null;
const tsubs = new Set<() => void>();
let ttimer: ReturnType<typeof setTimeout>;
export function say(text: string, ms = 3200) {
  toast = { id: Date.now(), text };
  tsubs.forEach((f) => f());
  clearTimeout(ttimer);
  ttimer = setTimeout(() => {
    toast = null;
    tsubs.forEach((f) => f());
  }, ms);
}
export function Toast() {
  const t = useSyncExternalStore(
    (f) => (tsubs.add(f), () => tsubs.delete(f)),
    () => toast,
  );
  return t ? (
    <div className="toast" key={t.id} role="status">
      {t.text}
    </div>
  ) : null;
}
