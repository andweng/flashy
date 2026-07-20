# Nightly encrypted Supabase → R2 backup

## Problem

Flashy's production data lives in a **Supabase cloud** project
(`dogwbpsuhzomvzaotzcv.supabase.co`). Supabase gates automated backups behind a
paid plan. We want free, self-owned, automated backups.

The repo `andweng/flashy` is **public**, and dumps contain user PII (accounts,
children's names, card data). No plaintext dump may land anywhere publicly
readable (this repo, GitHub Releases, or unencrypted Actions artifacts).

## Solution overview

A scheduled GitHub Action dumps the database, encrypts the dump, and uploads it
to a private Cloudflare R2 bucket. R2 is chosen because the project already runs
on Cloudflare (the web app deploys to a Cloudflare Worker), R2 has a 10 GB free
tier, and it is a genuine off-GitHub, off-Supabase copy.

```
GitHub Actions (cron 0 8 * * *  +  manual dispatch)
  -> pg_dump -Fc   (Supabase session pooler, IPv4, PG17 client)
  -> age encrypt   (recipient = our public key; private key offline)
  -> aws s3 cp     (private R2 bucket flashy-backups, key flashy/YYYY-MM-DD.dump.age)
R2 lifecycle rule: delete objects older than 30 days
```

Public-repo Actions minutes are free, so the schedule costs nothing.

## Components

### 1. Workflow — `.github/workflows/backup.yml`

- **Triggers:** `schedule: cron "0 8 * * *"` (daily 08:00 UTC) and
  `workflow_dispatch` (manual run button).
- **Runner:** `ubuntu-latest`.
- **Steps:**
  1. Install a **PostgreSQL 17 client** (matching Supabase's server major
     version) so `pg_dump` output is compatible. Use the PGDG apt repo rather
     than the runner's bundled client, which may lag.
  2. Install `age` and the `awscli`.
  3. `pg_dump -Fc "$SUPABASE_DB_URL" -f dump.pgc` — custom format, compressed,
     restorable via `pg_restore`. `SUPABASE_DB_URL` points at the **session
     pooler** (`...pooler.supabase.com:5432`), not the direct
     `db.<ref>.supabase.co` host — the direct host is IPv6-only on the free
     tier and GitHub runners are IPv4-only, so it is unreachable.
  4. `age -r "$AGE_PUBLIC_KEY" -o dump.pgc.age dump.pgc` — encrypt to our
     recipient key.
  5. `aws s3 cp dump.pgc.age s3://$R2_BUCKET/flashy/$(date -u +%F).dump.age
     --endpoint-url https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com`.
  6. Do **not** persist the plaintext dump as an artifact or in the workspace
     beyond the job. The job's ephemeral filesystem is discarded on completion.

### 2. Restore path — `scripts/restore-backup.sh` + DEPLOY.md section

A restore is only a backup if it has been exercised. The script:
- Takes an object key (or defaults to the latest) and a target DB URL.
- Downloads from R2, `age -d` with the private key (read from a path or env),
  and `pg_restore` into the target.
- DEPLOY.md gains a "Restoring from backup" section with the exact commands and
  a note to test-restore into a scratch database periodically.

### 3. Secrets & configuration (set by the user in GitHub repo settings)

| Name | Kind | Purpose |
|---|---|---|
| `SUPABASE_DB_URL` | secret | Session-pooler connection string incl. password |
| `R2_ACCOUNT_ID` | secret | Cloudflare account id (R2 endpoint host) |
| `R2_ACCESS_KEY_ID` | secret | R2 S3 API token id |
| `R2_SECRET_ACCESS_KEY` | secret | R2 S3 API token secret |
| `R2_BUCKET` | secret (or var) | Bucket name, e.g. `flashy-backups` |
| `AGE_PUBLIC_KEY` | secret (or var) | age recipient (public; not sensitive) |

The **age private key is never stored in GitHub.** The user keeps it offline
(password manager / local file) and supplies it only at restore time.

## Encryption choice: `age`

`age` over GPG: single small binary, one-line encrypt/decrypt, modern X25519,
no keyring ceremony. Recipient public key is safe to expose. A public-repo leak
or a compromised R2 object yields only ciphertext.

## Retention

An R2 bucket **lifecycle rule** deletes objects older than 30 days. The runner
only writes; it never lists or prunes, keeping its R2 token scoped to
`PutObject`. (A wider token is needed only for restore, done locally.)

## Free-tier risk & fallback

Some Supabase free projects restrict `pg_dump` over the pooler. **Plan step 1 is
to verify a manual `pg_dump` over the session pooler succeeds** before wiring
the Action. If blocked, fall back to the Supabase CLI `supabase db dump`
(schema + `--data-only` for data), same encrypt-and-upload tail. Destination and
everything downstream are unchanged.

## Out of scope

- Point-in-time recovery (Supabase paid feature; not replicable with dumps).
- Backing up Storage buckets / auth provider config (only the Postgres DB).
- Automated restore verification in CI (documented as a manual periodic task).

## Success criteria

1. Manual `workflow_dispatch` run produces `flashy/YYYY-MM-DD.dump.age` in R2.
2. `scripts/restore-backup.sh` restores that object into a scratch Postgres and
   the schema + row counts match production.
3. Scheduled run fires nightly without manual intervention.
4. No plaintext dump exists in the repo, artifacts, or any public surface.
