# Deploying Flashy

Flashy is an Expo Router app exported as a static web bundle and served by a
**Cloudflare Worker with static assets** at **https://flashy.weng.dev**. Every
push to `main` triggers a Workers Build that runs the export and redeploys.

> Note: this is a **Worker** (`flashy.andrew-weng.workers.dev`), not a Pages
> project. Cloudflare has put Pages into maintenance, so the Worker + static
> assets path is the supported one. The custom domain is attached to the Worker.

## How it works

`npm run build:web` runs `expo export --platform web` (output → `dist/`).
`wrangler.jsonc` then tells the Worker to serve `dist/` as static assets:

```jsonc
{
  "name": "flashy",            // must match the existing Worker
  "compatibility_date": "2026-06-21",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application"
  }
}
```

`not_found_handling: "single-page-application"` serves `index.html` (200) for
unmatched paths like `/decks/<id>`, so the Expo Router client renders the route.
This replaces the Pages-only `_redirects` / `app.html` SPA-fallback trick
(Workers ignore `_redirects`).

`dist/` and `.env*.local` are gitignored; Cloudflare builds remotely, so
nothing built or secret is committed.

## Cloudflare Worker build settings (one-time)

Workers & Pages → the `flashy` Worker → Settings → Build:

| Setting | Value |
|---|---|
| Git repository | `andweng/flashy`, branch `main` |
| Build command | `npm run build:web` |
| Deploy command | `npx wrangler deploy` (reads `wrangler.jsonc`) |

Node version comes from `.nvmrc` (`24`).

## Environment variables — required

> ⚠️ Expo inlines `EXPO_PUBLIC_*` vars **at build time**. They must be set as
> **build variables** on the Worker, or the build silently falls back to the
> in-memory mock DB (`EXPO_PUBLIC_USE_MOCK` defaults to `true`) with an empty
> Supabase URL.

Set under the Worker's Build → Variables:

```
EXPO_PUBLIC_USE_MOCK          = false
EXPO_PUBLIC_SUPABASE_URL      = https://dogwbpsuhzomvzaotzcv.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY = <publishable anon key from .env.local>
```

The anon key is a publishable key (safe in the client bundle). The current
value lives in `.env.local`.

## Custom domain

The custom domain `flashy.weng.dev` is attached to the Worker (Settings →
Domains & Routes → Custom Domain). Since `weng.dev` is on Cloudflare, the CNAME
and TLS cert are provisioned automatically — HTTPS is free and required (the app
registers a service worker in `src/app/+html.tsx`, which only works over HTTPS).

> `<name>.pages.dev` subdomains are globally unique across all of Cloudflare —
> `flashy.pages.dev` belongs to an unrelated user, not this project. Ignore it.

## Supabase auth URLs

In the Supabase dashboard → Authentication → URL Configuration, add
`https://flashy.weng.dev` to **Site URL** and **Redirect URLs**. Otherwise
sign-in / email redirects bounce to the wrong origin. This is the most common
"deployed fine but auth is broken" gotcha.

## Local build check

To reproduce the production build locally before pushing:

```bash
npm run build:web   # outputs to dist/
```
