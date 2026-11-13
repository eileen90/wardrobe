# Wardrobe

[![Made with pollinations.ai](https://raw.githubusercontent.com/pollinations/pollinations/main/packages/ui/src/brand/badge-made-with.svg)](https://pollinations.ai/?ref=badge)

Try it: https://eileen90.github.io/wardrobe/

My closet on any screen: every piece as a clean cut-out, laid out on a studio floor at its real
size, to mix into outfits.

- **Closet**: scattered on the floor or lined up by kind. Drag pieces wherever you like; in the
  rails, dragging reorders them or moves a piece to another kind.
- **Looks**: the mixer on top (swipe the rails, or use the arrow keys) and the saved looks under
  it. A saved look opens as a free board: drag, resize, turn, layer, share as a picture.
- **Private**: everything lives in the browser first and works offline. An optional account
  (*Settings → Account*) keeps the same closet on the phone and the laptop; *Settings → Backup*
  saves it all to one file.

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

Credits ("pollen", 1 pollen = $1) do not refill on a timer: the
[Quests page](https://enter.pollinations.ai/quests) gives a few one-time starter credits, and after
that you [top up](https://enter.pollinations.ai/pollen#buy-pollen). A quick redraw costs 0.005
(about 1,000 photos for $5), a careful one 0.03. Checking the balance is free.

When credits run out, photos go through the free community model `flux-2-dev-free` instead of
waiting. It has no quota (8 requests a minute), but it is rougher on prints, sometimes refuses
harmless photos, and its owner logs the pictures sent to it. The paid model comes back as soon as
the balance covers a photo again. If the service is busy or the device is offline, photos wait in
a backlog that survives closing the app and finishes by itself once the studio is reachable.

## Accounts

Sign-in and sync run on a free [Supabase](https://supabase.com) project. Until it is set up, the
Account section in Settings says so and nothing else changes.

1. Sign in at [supabase.com](https://supabase.com) and create a new project (free plan). Any name,
   a strong database password (you won't need it again), the region nearest you.
2. Open **SQL Editor**, paste all of [`supabase/schema.sql`](supabase/schema.sql) and **Run** it.
   It creates the `items` and `looks` tables, the private `pictures` bucket, and the rules that
   let each person reach only their own rows and pictures.
3. Open **Authentication → URL Configuration**. Set **Site URL** to
   `https://eileen90.github.io/wardrobe/`, and under **Redirect URLs** add
   `https://eileen90.github.io/wardrobe/**` and `http://localhost:5173/**`.
4. Open **Project Settings → API** (or **Connect**). Copy the **Project URL** and the
   **anon / publishable** key into [`src/lib/cloud-config.ts`](src/lib/cloud-config.ts), then push.
   Both are meant to be public: the row-level security from step 2 protects the data. Never use
   the `service_role` / secret key here.

How it works: each device keeps its full closet and keeps working offline. Changes wait in an
outbox and go up when there is a connection; changes from the other device come down when the app
opens, comes to the front, or every few minutes. The newer change to a piece or look wins. The
first sign-in on a device adds its closet to the account and the account's to it; nothing is wiped.
Signing out leaves the closet on the device. Restoring a backup while signed in replaces the
closet in the account too.

The free plan's built-in email allows only a few messages an hour (sign-up confirmations and
password resets), and a free project pauses after a week without use: opening it again on
supabase.com wakes it.

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
