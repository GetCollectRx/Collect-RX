# Website vs practice app: two release tracks

CollectRx is **two products** that share a monorepo and API today, but they have different users, deploy cadence, and risk profile. Treat them as separate tracks in git and in planning.

## The two tracks

| | **Website track** | **App track** |
|---|-------------------|---------------|
| **What it is** | Public marketing site | Practice portal + API + desktop |
| **Who uses it** | Prospects, SEO, investors | Logged-in dental staff |
| **Typical URLs** | `/`, `/landing`, `/demo`, `/demo/process`, legal pages | `/login`, `/dashboard`, `/insurance`, Electron |
| **Contains PHI?** | No | Yes |
| **Git branch** | `website/marketing` | `app/practice-home` |
| **Merge target** | `main` when marketing is ready | `main` when portal changes are ready |
| **Host (today)** | Same `collectrx-web` service* | Same `collectrx-web` service* |

\*One Docker image still serves both route groups. Branches separate **what you ship**, not separate hosts yet. Longer term you can split `www.collectrx.ca` (marketing) and `app.collectrx.ca` (portal) into two services.

## Code ownership

```
Collect-RX-main/src/
  website/           ← Website track only (e.g. WebsiteLogo.tsx)
  pages/
    LandingPage.tsx  ← Website
    ProcessDemo.tsx  ← Website
    landing/         ← Website
    Dashboard.tsx    ← App
    LoginPage.tsx    ← App
  components/
    brand/           ← App shell logo (app track)
    app/             ← App chrome (sidebar, top bar)
```

**Rule:** Website pages must not import from `components/app/`, `components/brand/`, or practice portal pages. App pages must not depend on `src/website/`.

Shared API (`src/server/`) ships with the **app track**; the website only needs public routes and static marketing UI.

## Branch workflow

1. **Website work** → branch from `main`: `website/marketing` (or `website/<feature>`)
2. **App work** → branch from `main`: `app/practice-home` (or `app/<feature>`)
3. Open **separate PRs** to `main`. Either can merge first; they should not stack (website PR must not require app PR).

Deprecated: `feature/website-brand-updates` was stacked on the app branch. Use `website/marketing` instead.

## Deploy (current setup)

- **Production** deploys from `main` on push (`collectrx-web`).
- To preview **app only**: host → Source → branch `app/practice-home` → redeploy.
- To preview **website only**: host → Source → branch `website/marketing` → redeploy.
- **Desktop app** loads the hosted URL; it follows whichever branch the host is building.

## Local dev

Same repo, same `npm run dev`. Routes decide what you see:

- Marketing: http://localhost:5173/landing or `/demo/process`
- App: http://localhost:5173/login → dashboard

## Future split (optional)

If marketing and app deploy schedules diverge heavily:

1. Second service for static/marketing (`website/` Vite entry or static export)
2. Custom domain: `www.collectrx.ca` → website, `app.collectrx.ca` → portal
3. Electron `dashboard-url.txt` points at `app.collectrx.ca` only

Until then, **two git tracks + clear folder ownership** is enough to keep the teams (or PRs) independent.
