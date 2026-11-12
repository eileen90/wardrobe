import { useRef, useState } from 'react';
import { importPicture } from './cleaner';
import { importFromClipboard, importFromUrl } from './importers';
import { CATEGORIES, type Category, type Item } from './types';
import { Icon, Segmented, Sheet, say } from './ui';

export default function AddSheet({
  open, onClose, onAdded, defaultCat,
}: {
  open: boolean;
  onClose: () => void;
  /** called with the new item ids */
  onAdded: (ids: string[]) => void;
  defaultCat: Category | 'All';
}) {
  const [status, setStatus] = useState<Item['status']>('owned');
  const [cat, setCat] = useState<Category | null>(null);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const category: Category = cat ?? (defaultCat === 'All' ? 'Tops' : defaultCat);

  async function run(job: () => Promise<string[]>) {
    if (busy) return;
    setBusy(true);
    try {
      const ids = await job();
      if (ids.length) {
        setLink('');
        onAdded(ids);
      }
    } catch (e) {
      say(e instanceof Error ? e.message : 'Something went wrong adding that.', 6000);
    } finally {
      setBusy(false);
    }
  }

  const addFiles = (files: FileList | null) =>
    run(async () => {
      const ids: string[] = [];
      let bad = 0;
      for (const f of Array.from(files ?? [])) {
        try {
          ids.push(await importPicture(f, { status, category }));
        } catch {
          bad++;
        }
      }
      if (bad) say(`${bad} file${bad > 1 ? 's' : ''} couldn't be opened as a picture.`, 5000);
      return ids;
    });

  const addLink = (url: string) =>
    run(async () => {
      const blob = await importFromUrl(url);
      return [await importPicture(blob, { status, category, url: url.trim() })];
    });

  const paste = () =>
    run(async () => {
      const got = await importFromClipboard();
      if (got.image) return [await importPicture(got.image, { status, category })];
      const blob = await importFromUrl(got.text!);
      return [await importPicture(blob, { status, category, url: got.text })];
    });

  return (
    <Sheet open={open} onClose={onClose} label="Add a piece">
      <div className="sheet-body">
        <h2 className="sheet-title">Add a piece</h2>
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: 'owned', label: 'I own it' },
            { value: 'wish', label: 'Thinking of buying' },
          ]}
        />
        <div className="chips wrap">
          {CATEGORIES.map((c) => (
            <button key={c} className={`chip ${category === c ? 'on' : ''}`} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>

        <div className="sources">
          <button className="source" disabled={busy} onClick={() => camRef.current?.click()}>
            <Icon name="camera" size={26} />
            <span>Camera</span>
          </button>
          <button className="source" disabled={busy} onClick={() => libRef.current?.click()}>
            <Icon name="photos" size={26} />
            <span>Photos</span>
          </button>
          <button className="source" disabled={busy} onClick={paste}>
            <Icon name="paste" size={26} />
            <span>Paste</span>
          </button>
        </div>

        <form
          className="link-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (link.trim()) addLink(link);
          }}
        >
          <Icon name="link" size={18} />
          <input
            type="url"
            inputMode="url"
            placeholder="Or paste a picture or shop link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            aria-label="Picture or shop link"
          />
          <button className="btn small" disabled={busy || !link.trim()}>
            {busy ? '…' : 'Add'}
          </button>
        </form>
        <p className="hint">
          Lay the piece flat on a plain surface in good light for the cleanest cut-out. Photos are
          cleaned on your phone and never leave it.
        </p>

        <input
          ref={camRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={libRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
    </Sheet>
  );
}
