# Deploying Flashy

Flashy is an Expo Router app exported as a static web bundle and hosted on
**Cloudflare Pages** at **https://flashy.weng.dev**. Every push to `main`
auto-builds and deploys.

## How the build works

`npm run build:web` runs `expo export --platform web` (output → `dist/`) and
then copies `dist/index.html` to `dist/app.html`. The `app.html` copy is the
SPA fallback target for dynamic routes — see `public/_redirects`:

```
/decks/*    /app.html   200
```

`dist/` and `.env*.local` are gitignored; Cloudflare builds remotely, so
nothing built or secret is committed.

## Cloudflare Pages settings (one-time)

Workers & Pages → Create → Pages → Connect to Git → `andweng/flashy`,
production branch `main`.

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | `npm run build:web` |
| Build output directory | `dist` |
| Root directory | `/` (default) |

Node version comes from `.nvmrc` (`24`).

## Environment variables — required

> ⚠️ Expo inlines `EXPO_PUBLIC_*` vars **at build time**. The Cloudflare build
> environment must have these, or the production build silently falls back to
> the in-memory mock DB (`EXPO_PUBLIC_USE_MOCK` defaults to `true`) with an
> empty Supabase URL.

Set under Settings → Environment variables → Production:

```
EXPO_PUBLIC_USE_MOCK          = false
EXPO_PUBLIC_SUPABASE_URL      = https://dogwbpsuhzomvzaotzcv.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY = <publishable anon key from .env.local>
```

The anon key is a publishable key (safe in the client bundle). The current
value lives in `.env.local`.

## Custom domain

Pages project → Custom domains → Set up a domain → `flashy.weng.dev`. Since
`weng.dev` is on Cloudflare, the CNAME and TLS cert are provisioned
automatically — HTTPS is free and required (the app registers a service worker
in `src/app/+html.tsx`, which only works over HTTPS).

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
