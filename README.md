# Wardrobe

My closet on my phone: every piece photographed, remade as a clean product shot, and laid out
on a studio floor to mix into outfits.

- **Closet**: scattered on the floor or lined up by kind. Tap a piece for its slip (name, brand, price, link, notes).
- **Studio**: any photo you add is remade by an image model as a straight, evenly lit product shot and cut out, so the whole closet matches. Pictures that already sit on a plain background are cut out on the phone without using the studio.
- **Wishlist**: paste a shop link or a picture, mark it "on my wishlist", and see what it goes with.
- **Mix**: swipe the top, bottom and shoe rails independently (jacket and bag rails are optional) and save what works.
- **Looks**: free boards. Drag pieces, resize and turn with two fingers, layer, flip, change the paper, share as a picture.
- **Private**: no account and no server of our own. Everything stays in the browser on the phone; *Studio → Backup* saves it all to one file.

## The studio key

Remaking photos uses [Pollinations](https://enter.pollinations.ai). Sign in there (free), create a secret key,
claim the starter credits on its Quests page, and paste the key under **Studio → Connection** in the app.
The key is stored only on that device. A "quick" remake costs 0.005 credits.

Google's Gemini image models were the first choice but have no free API tier, so they aren't used.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Pushing to `main` builds and publishes the site with GitHub Pages (`.github/workflows/deploy.yml`).

## How a photo becomes a piece

1. The photo is shrunk to 1024 px and its colours are read.
2. If the border is already one flat colour, the piece is cut out right there (`src/lib/key.ts`, flood from the edges).
3. Otherwise the image model redraws it front-on against a flat backdrop in a colour the garment doesn't contain
   (blue, magenta or green; blue jeans never get a blue backdrop), and that colour is keyed out (`src/lib/studio.ts`).
4. The cut-out is trimmed and stored with a small thumbnail in IndexedDB.

Built with React, TypeScript and Vite as an installable PWA. `reference/` holds the prompts the design was based on.
