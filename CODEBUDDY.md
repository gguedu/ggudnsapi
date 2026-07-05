# CODEBUDDY.md This file provides guidance to CodeBuddy when working with code in this repository.

## Development commands

- Install dependencies: `pnpm install`
- Run locally with Cloudflare Wrangler: `pnpm dev`
- Deploy Worker: `pnpm deploy`
- Type-check TypeScript: `pnpm typecheck`
- Run the test suite: `pnpm test`
- Run a single Vitest file: `pnpm exec vitest run path/to/file.test.ts`
- Run tests matching a name: `pnpm exec vitest run -t "test name"`

No lint script is configured in `package.json`. The TypeScript config is strict and includes `src/**/*.ts` plus `test/**/*.ts`.

## Runtime and configuration

This is a Cloudflare Worker project named `ggudnsapi`. Wrangler uses `src/index.ts` as the Worker entrypoint and serves static admin assets from `public/` through the `ASSETS` binding.

Required Worker bindings and variables are defined in `wrangler.toml`:

- KV binding must be named `DNS_KV`; all persistent application state is stored there.
- `MAIL_API_BASE_URL` points to the GGU passport/mail API used for token verification and admin login.
- `ALLOWED_ORIGIN` controls CORS for API responses.
- `DNS_ADMIN_EMAILS` is a comma-separated allowlist for admin access.
- `DEFAULT_INITIAL_POINTS` and `DELETE_REFUND_ENABLED` seed global DNS settings when `settings:global` is absent in KV.
- `CREDENTIALS_ENCRYPTION_KEY` is an optional but recommended Wrangler secret used to encrypt Cloudflare API credentials before storing them in KV. Set it with `pnpm wrangler secret put CREDENTIALS_ENCRYPTION_KEY`.

## High-level architecture

The Worker exposes JSON APIs under `/api/**`; non-API requests are delegated to the static `ASSETS` binding, primarily `public/admin.html`.

`src/index.ts` is the API router and orchestration layer. It handles CORS and errors, routes public user APIs (`/api/auth`, `/api/records`, `/api/points`), routes admin APIs (`/api/admin/**`), and performs request-body validation that is specific to those handlers.

Core modules:

- `src/auth.ts`: reads the `Authorization` header, validates GGU mail/passport tokens against `${MAIL_API_BASE_URL}/my/loginUserInfo`, creates or updates local DNS users in KV, applies initial point grants, and enforces admin email checks.
- `src/records.ts`: owns the DNS record lifecycle: create, update, delete, enable/disable, serialize, list. It coordinates domain validation, blacklist checks, subdomain ownership protection, Cloudflare DNS mutations, KV record indexes, and point spending/refunds.
- `src/domain.ts`: normalizes hostnames, chooses the managed root domain, validates record input, checks blacklist rules, enforces second-level subdomain ownership protection, and detects Cloudflare full-domain/type conflicts.
- `src/cloudflare.ts`: wraps Cloudflare API calls, supports both API Token and API Key + Email auth, and encrypts/decrypts stored credentials when `CREDENTIALS_ENCRYPTION_KEY` is set.
- `src/kv.ts`: centralizes KV key naming and persistence. It stores primary records plus marker/index keys for listing by user, domain, Cloudflare record id, email, etc.
- `src/points.ts`: updates user point balances and writes point logs for initial grants, record creation, delete refunds, and admin adjustments.
- `src/http.ts`: shared response envelopes, `ResponseError`, CORS headers, JSON parsing, timestamp, request IP, and random ID helpers.
- `src/types.ts`: shared interfaces for Worker env, users, settings, Cloudflare accounts, managed domains, DNS records, point logs, owners, blacklist rules, and Cloudflare DTOs.

## Data model notes

KV is used as the database. `src/kv.ts` defines all prefixes; update it whenever adding a new persistent entity or a new listing access pattern. Many entities have both a primary key and lightweight marker keys so list operations can resolve full records later.

Important KV prefixes include:

- `settings:global` for DNS platform settings.
- `user:*` and `user-email:*` for users and email lookup.
- `record:*`, `user-record:*`, `domain-record:*`, and `cf-record:*` for DNS records and indexes.
- `owner:<root>:<secondLevel>` for subdomain ownership protection.
- `cf-account:*` for Cloudflare account credentials and metadata.
- `domain:*` for managed root domains.
- `point-log:<uid>:*` for point history.
- `blacklist:*` for domain/user blacklist rules.

When changing record creation or deletion behavior, keep Cloudflare and KV consistency in mind: `createUserRecord` rolls back the Cloudflare record and KV indexes if local persistence or point spending fails.

## API behavior to preserve

- API responses use the envelope shape `{ success: true, data }` or `{ success: false, message }`.
- CORS headers are added around every `/api/**` response; allowed methods are `GET,POST,PATCH,DELETE,OPTIONS` and allowed headers are `authorization,content-type`.
- User authentication accepts either raw token or `Bearer <token>` in the `Authorization` header.
- Admin endpoints always call `requireAdmin`, which first validates the mail token, syncs the DNS user, then checks `DNS_ADMIN_EMAILS`.
- New DNS users get initial points from saved settings, falling back to `DEFAULT_INITIAL_POINTS`.
- Domain matching chooses the longest enabled managed root that contains the requested full domain.
- DNS settings default to `allowedTypes: []`, so record types must be explicitly allowed from the admin UI before users can create records.
- Deleting a managed domain that still has records disables it instead of removing the KV entry.

## Blacklist rule semantics

Blacklist targets are `domain` or `user` (UID or email). Match modes:

- `exact`: full string match only.
- `suffix`: matches the rule and all sub-paths (e.g. `bad.example.com` also hits `a.bad.example.com`).
- `contains`: substring match anywhere — wide, use with care.
- `wildcard`: supports a single `*` (e.g. `*.bad.example.com`, `test-*.example.com`).

User blacklist can target UID or email; `@example.com` with `suffix` bans an email domain.

## Admin UI

`public/admin.html` is a self-contained static admin page with inline CSS and JavaScript. It logs in through `/api/auth/admin-login`, stores the returned token in the browser, and calls `/api/admin/**` for users, Cloudflare accounts, domain pool, blacklist, settings, and records. Keep endpoint names and response envelope compatibility in mind when changing backend handlers.

A separate `frontend/` directory holds an in-progress rebuild (components, sections, lib, types) but the deployed admin surface is still the static `public/admin.html`.

## External integration

- GGU Web should point `NUXT_PUBLIC_DNS_API_BASE_URL` to this Worker's `/api` base URL.
- Cloudflare credentials added in the admin UI need at least `Zone:Zone:Read` and `Zone:DNS:Edit`.
- Admin login flow: obtain `mail_token` from `localStorage.mail_token` on GGU Web / mail system, paste at `/admin.html`, which calls `/api/auth/me`; the Worker validates the token at `MAIL_API_BASE_URL` then checks `DNS_ADMIN_EMAILS`.
