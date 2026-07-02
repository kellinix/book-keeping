# VoiceLedger

VoiceLedger is an AI-assisted bookkeeping and tax-estimate web app for small businesses and freelancers. This repository contains an MVP built with Next.js (App Router), TypeScript, Tailwind CSS and Supabase.

> Important: Tax calculations in this project are estimates for planning purposes only and are not accounting or legal advice.

## Features (MVP)
- Email/password auth via Supabase
- Dashboard with totals, recent transactions and charts
- Transactions CRUD (manual entry, edit, delete)
- CSV / XLSX upload preview and import
- Voice recorder -> transcription -> suggested transaction extraction
- AI categorisation with OpenAI
- Reports and CSV export
- Business settings (base currency, default corporation tax rate)

## Tech Stack
- Next.js (App Router)
- TypeScript
- Tailwind CSS
- Supabase (Auth, Postgres, Storage)
- OpenAI API

## Prerequisites
- Node.js 18+ and npm
- A Supabase project (https://app.supabase.com)
- OpenAI API key (for AI features)

## Quick start (local)

1. Clone the repo and install dependencies

```bash
git clone <repo-url>
cd book-keeping
npm install
```

2. Configure Supabase

- Create a Supabase project and note the `Project URL` and `anon/public` key.
- Create a Storage bucket named `uploads` (used for audio/receipts/files).
- Open the SQL editor and run `db/schema.sql` from this repo. This creates tables and recommended RLS policies.

3. Configure environment variables

```bash
cp .env.local.example .env.local
# Edit .env.local and set values for your Supabase and OpenAI keys
```

4. Start the dev server

```bash
npm run dev
```

5. Open http://localhost:3000 and sign up

## Important environment variables
See `.env.local.example`. Key variables:

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL (public)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon/public key (public)
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (server-only; NEVER commit)
- `OPENAI_API_KEY` — OpenAI API key (server-only)
- `NEXT_PUBLIC_DEFAULT_CORPORATION_TAX_RATE` — Optional default corporation tax rate (percent)

## Security notes

- Never expose `SUPABASE_SERVICE_ROLE_KEY` or `OPENAI_API_KEY` to the browser or commit them to source control.
- Server-side routes use `lib/supabaseAdmin.ts` and require the service role key; those routes must only run on the server.
- Database schema in `db/schema.sql` enables Row Level Security (RLS) and includes example policies. Review policies before deploying to production.

## Supabase checklist

- Run `db/schema.sql` in the SQL editor
- Create the `uploads` storage bucket
- Add Service Role key to your environment (server-only)

## Automated migrations & CI

This repo includes a simple DB migration helper and a GitHub Actions workflow for CI.

- Apply schema locally using `psql` or the included Node helper:

```bash
# Using the Node helper (reads DATABASE_URL):
npm run db:apply

# Or use psql directly (if you have postgres client installed):
DATABASE_URL=postgres://user:pass@host:5432/dbname npm run db:apply:psql
```

- CI: `.github/workflows/ci.yml` runs lint/build on pushes and pull requests. If you set the `DATABASE_URL` secret in GitHub, the workflow will attempt to apply `db/schema.sql` during the CI run.

## Using the app (short)

- Register or sign in
- Add transactions manually via the Transactions page
- Upload CSV/XLSX on Transactions page to preview and import
- Record a voice note from the Transactions sidebar to create a transaction
- Visit Reports to export CSVs and view summaries
- Use Ask VoiceLedger to query your stored transactions

## Next steps and roadmap
 - PDF/OCR receipt parsing (OCR endpoint included at `app/api/receipts/ocr/route.ts`).
	 - By default receipts are stored in Supabase Storage. To enable server-side OCR using Tesseract, set `ENABLE_TESSERACT=1` in your server environment. OCR may be slow and requires additional runtime resources.
 - Improve AI categorisation (train/store models or rules)
 - Add Stripe for SaaS billing and multi-business/team support
