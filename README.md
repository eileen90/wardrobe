# Wardrobe

My closet on any screen: every piece as a clean cut-out, laid out on a studio floor at its real
size, to mix into outfits.

- **Closet**: scattered on the floor or lined up by kind. Drag pieces wherever you like; in the
  rails, dragging reorders them or moves a piece to another kind.
- **Looks**: the mixer on top (swipe the rails, or use the arrow keys) and the saved looks under
  it. A saved look opens as a free board: drag, resize, turn, layer, share as a picture.
- **Private**: no account and no server of our own. Everything stays in the browser;
  *Settings → Backup* saves it all to one file.

## Adding a piece

There is nothing to fill in. Drop pictures on the window, paste a picture or a shop link
anywhere, or use the **add** button (camera, files, link). The app works out the rest:

| What | How | Cost |
| --- | --- | --- |
| Kind, name | from the product title or file name; otherwise one small look by a vision model | free, or ~0.00002 credits |
| Brand, link | from the shop page; tracking junk is stripped from the address | free |
| Mine or wishlist | your own picture is yours, a shop page is a wish | free |
| Cut-out of a shop picture on a plain background | done on the device | free |
| Cut-out of your own photo | redrawn by the image model in a frame shaped like the piece, then keyed out | 0.005 credits |
| The same file twice | recognised by its fingerprint and skipped | free |

iPhone photos (HEIC) open everywhere; where the browser can't read them the converter is
downloaded once, on first use.

## The studio key

Redrawing photos uses [Pollinations](https://enter.pollinations.ai). Sign in there, create a secret
key and paste it under **Settings**. It is stored on that device only.

Credits ("pollen") do not refill on a timer: they come from the Quests page or from topping up.
When they run out, or the service is busy, or the device is offline, photos wait in a backlog
that survives closing the app and finishes by itself the next time the app is open and the
studio is reachable again. Checking the balance is free.

## Keys

| Where | Keys |
| --- | --- |
| Anywhere | paste a picture or a link to add it |
| A piece | ← → previous / next, Delete removes (with undo), Esc closes |
| Mixer | ← → next outfit, ↑ ↓ pick one rail, Space shuffles, S saves |
| Board | Delete removes the selected piece, arrows nudge, ⌘Z undo, ⌘D copy, [ ] layer, + − size, F flip |

## Run it

```bash
npm install
```

```bash
npm run dev
```

Pushing to `main` builds and publishes the site with GitHub Pages (`.github/workflows/deploy.yml`).

## How a photo becomes a piece

1. The photo is shrunk and fingerprinted (`src/lib/intake.ts`).
2. Words are tried first for the kind (`src/lib/kind.ts`); failing that, one look by a small
   vision model gives kind, name and hem length (`src/lib/pollinations.ts`).
3. A web picture whose border is one flat colour is cut out right there (`src/lib/key.ts`).
4. Anything else is redrawn front-on against a flat backdrop in a colour the piece doesn't
   contain, in a tall, portrait, square or wide frame chosen from its kind and length, and
   that colour is keyed out (`src/lib/studio.ts`).
5. Its real size is estimated from kind, length and outline, and used wherever pieces sit side
   by side (`realSize` in `src/lib/kind.ts`).

Built with React, TypeScript and Vite as an installable PWA. `reference/` holds the prompts the
design was based on.
