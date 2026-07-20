# Nightly encrypted Supabase → R2 backup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scheduled GitHub Action dumps the Supabase Postgres nightly, encrypts it with `age`, and uploads it to a private Cloudflare R2 bucket; a script restores it.

**Architecture:** GitHub Actions cron → `pg_dump -Fc` over the Supabase **session pooler** (IPv4) → `age` encrypt to our public key → `aws s3 cp` to private R2 bucket. Restore is a local script (download → `age -d` → `pg_restore`). Nothing plaintext ever leaves the ephemeral runner.

**Tech Stack:** GitHub Actions, PostgreSQL 17 client (`pg_dump`/`pg_restore`), `age`, AWS CLI v2 (S3 API against R2), Cloudflare R2.

## Global Constraints

- Repo `andweng/flashy` is **public** — no plaintext dump may exist in the repo, in Actions artifacts, or in any public surface. Only `age` ciphertext leaves the runner.
- Supabase connection MUST use the **session pooler** host (`...pooler.supabase.com:5432`). The direct `db.<ref>.supabase.co` host is IPv6-only on the free tier; GitHub runners are IPv4-only.
- `pg_dump`/`pg_restore` client MUST be **PostgreSQL 17** to match the Supabase server major version.
- AWS CLI v2 against R2 requires `AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED` and `AWS_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED`, else R2 rejects the request with a checksum/`x-amz-content-sha256` error. Region is `auto`.
- The **age private key is never stored in GitHub.** Only the public recipient (`AGE_PUBLIC_KEY`) is used by the Action.
- Backup object key format: `flashy/YYYY-MM-DD.dump.age`.

---

### Task 1: Verify `pg_dump` works over the session pooler (risk gate)

Confirms the whole approach before any code. Some Supabase free projects restrict `pg_dump` over the pooler; if this fails, the fallback is `supabase db dump` (same encrypt/upload tail) and the workflow's dump step changes accordingly.

**Files:** none (verification only).

**Interfaces:**
- Produces: a confirmed-working `SUPABASE_DB_URL` (session-pooler connection string) that the user will store as a GitHub secret, and a go/no-go on `pg_dump`.

- [ ] **Step 1 (USER ACTION): Get the session-pooler connection string**

In the Supabase dashboard → Project Settings → Database → **Connection string** → **Session pooler** (port 5432). It looks like:
```
postgresql://postgres.dogwbpsuhzomvzaotzcv:[PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres
```
Do NOT use the "Direct connection" (IPv6) or "Transaction pooler" (port 6543 — not compatible with `pg_dump`).

- [ ] **Step 2: Test the dump locally**

Requires a local PostgreSQL 17 client. With the URL exported as `$SUPABASE_DB_URL`:
```bash
pg_dump -Fc "$SUPABASE_DB_URL" -f /tmp/test.pgc && ls -la /tmp/test.pgc
```
Expected: a non-empty `/tmp/test.pgc` file, no error.

- [ ] **Step 3: Confirm it is restorable (listing is enough)**

```bash
pg_restore -l /tmp/test.pgc | head
```
Expected: a table-of-contents listing (types, tables, etc.), proving the dump is valid.

- [ ] **Step 4: Decide**

If Steps 2–3 succeed → proceed with `pg_dump` (Task 3 as written). If Step 2 fails with a permission/pooler error → the dump command in Task 3 Step 1 becomes `supabase db dump --db-url "$SUPABASE_DB_URL" -f dump.sql` (plain SQL) and restore uses `psql` instead of `pg_restore`; note this in the plan before continuing. Then clean up: `rm -f /tmp/test.pgc`.

---

### Task 2: Provision R2, encryption key, and GitHub secrets (USER ACTION)

One-time infrastructure. No repo files change; this produces the six secrets the workflow consumes.

**Files:** none.

**Interfaces:**
- Produces: GitHub repo secrets `SUPABASE_DB_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `AGE_PUBLIC_KEY`; and an offline `age` private key file the user keeps.

- [ ] **Step 1: Create the private R2 bucket**

Cloudflare dashboard → R2 → Create bucket → name `flashy-backups` (region: automatic; keep it **private** — no public access). Or via CLI (already have wrangler): `npx wrangler r2 bucket create flashy-backups`.

- [ ] **Step 2: Add a 30-day lifecycle rule**

Bucket → Settings → Object lifecycle rules → add rule: delete objects older than **30 days**. (CLI alt: `npx wrangler r2 bucket lifecycle add flashy-backups --expire-days 30` — verify flag name against `npx wrangler r2 bucket lifecycle --help`.)

- [ ] **Step 3: Create an R2 S3 API token**

R2 → **Manage R2 API Tokens** → Create API token → permission **Object Read & Write**, scoped to `flashy-backups`. Save the **Access Key ID**, **Secret Access Key**, and note your **Account ID** (shown on the R2 overview page; it is the host prefix in `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`).

- [ ] **Step 4: Generate the age keypair**

```bash
age-keygen -o ~/flashy-backup-age.key
```
This prints `Public key: age1...` and writes the private key to `~/flashy-backup-age.key`. **Store that file in your password manager and delete it from disk if this is a shared machine.** The `age1...` public string is `AGE_PUBLIC_KEY`.

- [ ] **Step 5: Set the six GitHub secrets**

Repo → Settings → Secrets and variables → Actions → New repository secret, for each of: `SUPABASE_DB_URL` (from Task 1), `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (`flashy-backups`), `AGE_PUBLIC_KEY` (the `age1...` string).

---

### Task 3: Backup workflow

**Files:**
- Create: `.github/workflows/backup.yml`

**Interfaces:**
- Consumes: the six secrets from Task 2.
- Produces: object `flashy/YYYY-MM-DD.dump.age` in R2 on schedule and on manual dispatch.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/backup.yml`:
```yaml
name: DB backup

on:
  schedule:
    - cron: "0 8 * * *"   # daily 08:00 UTC
  workflow_dispatch: {}     # manual "Run workflow" button

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - name: Install PostgreSQL 17 client + age
        run: |
          set -euo pipefail
          sudo sh -c 'echo "deb https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
          curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/pgdg.gpg
          sudo apt-get update
          sudo apt-get install -y postgresql-client-17 age

      - name: Dump, encrypt, upload to R2
        env:
          SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}
          AGE_PUBLIC_KEY: ${{ secrets.AGE_PUBLIC_KEY }}
          R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
          R2_BUCKET: ${{ secrets.R2_BUCKET }}
          AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: auto
          AWS_REQUEST_CHECKSUM_CALCULATION: WHEN_REQUIRED
          AWS_RESPONSE_CHECKSUM_VALIDATION: WHEN_REQUIRED
        run: |
          set -euo pipefail
          DATE="$(date -u +%F)"
          /usr/lib/postgresql/17/bin/pg_dump -Fc "$SUPABASE_DB_URL" -f dump.pgc
          age -r "$AGE_PUBLIC_KEY" -o dump.pgc.age dump.pgc
          aws s3 cp dump.pgc.age "s3://$R2_BUCKET/flashy/$DATE.dump.age" \
            --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"
          echo "Uploaded flashy/$DATE.dump.age ($(du -h dump.pgc.age | cut -f1))"
```
Notes: `pg_dump` is called by its absolute PGDG path so the PG17 binary is used regardless of any older client on the runner. `aws` CLI v2 is preinstalled on `ubuntu-latest`; the two checksum env vars are the R2 compatibility fix. No `actions/checkout` is needed — nothing reads the repo tree.

- [ ] **Step 2: Lint the YAML**

Run:
```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/backup.yml')); print('yaml ok')"
```
Expected: `yaml ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/backup.yml
git commit -m "Add nightly Supabase -> R2 backup workflow"
```

---

### Task 4: Restore script

**Files:**
- Create: `scripts/restore-backup.sh`

**Interfaces:**
- Consumes: R2 credentials + `AGE_KEY_FILE` (offline private key) + `TARGET_DB_URL` from the operator's environment.
- Produces: a restored database in `TARGET_DB_URL`. Round-trip tested locally in Task 6.

- [ ] **Step 1: Write the script**

Create `scripts/restore-backup.sh`:
```bash
#!/usr/bin/env bash
# Restore a Flashy backup from R2 into TARGET_DB_URL.
#
#   AGE_KEY_FILE=~/flashy-backup-age.key \
#   TARGET_DB_URL=postgresql://... \
#   R2_ACCOUNT_ID=... R2_BUCKET=flashy-backups \
#   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
#     scripts/restore-backup.sh [flashy/YYYY-MM-DD.dump.age]
#
# With no key argument, restores the most recent object.
set -euo pipefail

: "${AGE_KEY_FILE:?path to your offline age private key}"
: "${TARGET_DB_URL:?postgres url to restore INTO (NOT production)}"
: "${R2_ACCOUNT_ID:?}" ; : "${R2_BUCKET:?}"
: "${AWS_ACCESS_KEY_ID:?}" ; : "${AWS_SECRET_ACCESS_KEY:?}"
export AWS_DEFAULT_REGION=auto
export AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED
export AWS_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

KEY="${1:-}"
if [[ -z "$KEY" ]]; then
  NAME="$(aws s3 ls "s3://${R2_BUCKET}/flashy/" --endpoint-url "$ENDPOINT" \
          | awk '{print $4}' | sort | tail -1)"
  [[ -n "$NAME" ]] || { echo "no backups found in flashy/" >&2; exit 1; }
  KEY="flashy/${NAME}"
fi

echo ">> restoring ${KEY} into ${TARGET_DB_URL%%@*}@..."
aws s3 cp "s3://${R2_BUCKET}/${KEY}" backup.dump.age --endpoint-url "$ENDPOINT"
age -d -i "$AGE_KEY_FILE" -o backup.pgc backup.dump.age
pg_restore --clean --if-exists --no-owner -d "$TARGET_DB_URL" backup.pgc
rm -f backup.dump.age backup.pgc
echo ">> restore complete"
```

- [ ] **Step 2: Make it executable and shellcheck it**

Run:
```bash
chmod +x scripts/restore-backup.sh
shellcheck scripts/restore-backup.sh || echo "(shellcheck not installed — skip)"
```
Expected: executable bit set; no shellcheck errors (warnings acceptable).

- [ ] **Step 3: Commit**

```bash
git add scripts/restore-backup.sh
git commit -m "Add restore-backup.sh for R2 backups"
```

---

### Task 5: Document restore in DEPLOY.md

**Files:**
- Modify: `DEPLOY.md` (append a new section)

**Interfaces:**
- Consumes: nothing. Produces: operator-facing docs.

- [ ] **Step 1: Append the section**

Add to the end of `DEPLOY.md`:
```markdown
## Database backups

A GitHub Action (`.github/workflows/backup.yml`) dumps the Supabase Postgres
nightly (08:00 UTC), encrypts it with `age`, and uploads it to the private
Cloudflare R2 bucket `flashy-backups` as `flashy/YYYY-MM-DD.dump.age`. R2 keeps
30 days (bucket lifecycle rule). Run it on demand from Actions → **DB backup** →
**Run workflow**.

Secrets live in repo Settings → Secrets → Actions: `SUPABASE_DB_URL` (session
pooler), `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_BUCKET`, `AGE_PUBLIC_KEY`. The **age private key is not in GitHub** — it is
in the password manager (`flashy-backup-age.key`).

### Restoring from backup

Restore into a **scratch** database first — never straight to production:

```bash
AGE_KEY_FILE=~/flashy-backup-age.key \
TARGET_DB_URL="postgresql://postgres:pw@localhost:5432/flashy_restore" \
R2_ACCOUNT_ID=... R2_BUCKET=flashy-backups \
AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
  scripts/restore-backup.sh            # latest, or pass flashy/2026-07-19.dump.age
```

Test-restore periodically and eyeball row counts — an untested backup is not a
backup.
```

- [ ] **Step 2: Commit**

```bash
git add DEPLOY.md
git commit -m "Document DB backup + restore in DEPLOY.md"
```

---

### Task 6: End-to-end verification (USER ACTION, after Tasks 2–5)

Proves the pipeline works and the backup is actually restorable.

**Files:** none.

- [ ] **Step 1: Trigger a manual run**

Repo → Actions → **DB backup** → **Run workflow** (branch `main`). Wait for green.

- [ ] **Step 2: Confirm the object exists in R2**

```bash
AWS_DEFAULT_REGION=auto AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED \
AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
  aws s3 ls "s3://flashy-backups/flashy/" \
  --endpoint-url "https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
```
Expected: today's `YYYY-MM-DD.dump.age` listed, non-zero size.

- [ ] **Step 3: Restore round-trip into a scratch DB**

Create an empty local DB, then run `scripts/restore-backup.sh` (see DEPLOY.md) against it. Expected: `restore complete`. Then spot-check:
```bash
psql "$TARGET_DB_URL" -c "\dt" -c "select count(*) from children;"
```
Expected: the Flashy tables present and plausible row counts, matching production.

- [ ] **Step 4: Confirm no plaintext leaked**

Check the Action run log shows only the `Uploaded flashy/...age` line (no dump contents) and that no artifact was produced. Confirms the public-repo PII constraint holds.

---

## Self-Review

- **Spec coverage:** workflow (Task 3) ✓; restore script + docs (Tasks 4–5) ✓; secrets/config + R2 + retention + age keypair (Task 2) ✓; free-tier `pg_dump` risk gate + fallback (Task 1) ✓; success criteria = Task 6 ✓. Out-of-scope items (PITR, Storage buckets, CI restore verification) intentionally absent.
- **Placeholders:** `<region>`, `<ACCOUNT_ID>` are genuine user-supplied values, not plan gaps. No TBD/TODO.
- **Type/name consistency:** object key `flashy/YYYY-MM-DD.dump.age`, env var names, and the checksum env vars are identical across Tasks 3, 4, 5, 6.
