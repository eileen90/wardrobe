import { useEffect, useRef, useState } from 'react';
import { report, takeFiles, takeLink, takeTransfer, type Taken } from '../lib/intake';
import { cleanUrl } from '../lib/links';
import { describe, isDone } from '../lib/shortcuts';
import { Icon, Sheet, toast } from '../ui';

/** Say what happened to something that was handed over, when it needs saying. */
export function tell(t: Taken) {
  const text = report(t);
  if (text) toast(text);
}

/**
 * The ways in, for when there is nothing to drop or paste: the camera, the photo library,
 * and a field for a link. Nothing to fill in; a piece goes straight to the floor.
 */
export function Add({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [link, setLink] = useState('');
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const touch = matchMedia('(pointer: coarse)').matches;

  useEffect(() => { if (open) setLink(''); }, [open]);

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (!files.length) return;
    onClose();
    void takeFiles(files).then(tell);
  };
  const send = (text: string) => {
    if (!cleanUrl(text)) return toast("That doesn't look like a link");
    onClose();
    void takeLink(text).then(tell);
  };

  return (
    <Sheet open={open} onClose={onClose} label="Add a piece">
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={onFiles} />
      <input ref={library} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={onFiles} />
      <div className="sheet__head"><h2>Add a piece</h2></div>
      <div className="ways">
        {touch && <button className="way" onClick={() => camera.current?.click()}><Icon name="camera" />Take a photo</button>}
        <button className="way" onClick={() => library.current?.click()}><Icon name="photos" />Choose pictures</button>
        <label className="way">
          <Icon name="link" />
          <input value={link} placeholder="paste a link or a picture" inputMode="url" autoCapitalize="off" autoCorrect="off"
            enterKeyHint="go" aria-label="Paste a link or a picture"
            onChange={(e) => setLink(e.target.value)}
            onPaste={(e) => {
              // A pasted picture, or a pasted link, is taken as it lands.
              const text = e.clipboardData.getData('text');
              if (e.clipboardData.files.length || cleanUrl(text)) {
                e.preventDefault();
                onClose();
                void takeTransfer(e.clipboardData).then(tell);
              }
            }}
            onKeyDown={(e) => isDone(e) && link.trim() && send(link)} />
        </label>
      </div>
      {!touch && <p className="note">Or drop or paste them anywhere ({describe('mod+v')}).</p>}
    </Sheet>
  );
}
