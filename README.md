# Wardrobe

A personal closet and outfit-planning board that lives on your phone.

- **Closet** – photograph your clothes (or paste a picture / shop link). Each photo is cut out from its background automatically, on the device.
- **Wishlist** – add things you're thinking of buying and see what they'd go with.
- **Outfit boards** – drop pieces on a board, drag, pinch to resize, twist to rotate, layer, flip, add notes, change the backdrop, and save or share the result as a picture.
- **Private & free** – no account, no server, no API keys. Photos stay in the browser's storage on your device; use *Settings → Save a backup file* to keep a copy.

## Run it locally

```bash
npm install
```

```bash
npm run dev
```

## Publish

Pushing to this repository builds the app and publishes it with GitHub Pages
(`.github/workflows/deploy.yml`). One-time setup: **Settings → Pages → Source → GitHub Actions**.

## How it's built

React + TypeScript + Vite, installable as a PWA. Background removal uses
[`@imgly/background-removal`](https://github.com/imgly/background-removal-js) (AGPL) with its model
served from this site, so cleanup runs fully in the browser and works offline after the first use.
