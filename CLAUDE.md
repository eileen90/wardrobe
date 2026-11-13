# Working on Wardrobe

- Commit straight to `main` and push it. No feature branches, no pull requests. Pushing `main`
  deploys the site through GitHub Pages.
- Before pushing, `npm run build` must pass (it type-checks first).

## What the app is for

A personal closet app. The owner should never have to do logistics by hand:

- No forms before an action. Things are added, removed, moved and saved directly; anything
  destructive happens at once and offers Undo instead of asking first.
- Anything the app can work out, it works out: kind, name, brand, link, size, currency.
- Mechanical before AI. Reach for a model only where code can't do the job, use the cheapest
  one that can, and never repeat a paid call whose answer is already stored. See the table in
  `README.md` for what costs what.
- Paid work that can't run right now (no credits, rate limit, offline) waits in the backlog in
  `src/lib/studio.ts` and resumes on its own. Don't surface it as an error to fix.
- Default currency is TWD.
- Keep interface text short. No decorative notes or explanations of how things work.
