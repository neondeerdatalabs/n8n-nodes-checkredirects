# Project Review Context

This repo is **n8n-nodes-checkredirects** — a published n8n community node package on npm (currently `v1.0.0`) that wraps the public Checkredirects.io API. It ships three n8n nodes (one action, two triggers) plus one credential type.

## Critical constraints

Non-negotiable rules. Flag any diff that breaks these as blocking.

- **The published npm API is a committed contract.** `credentials/CheckredirectsApi.credentials.ts` field names (`apiKey`, `baseUrl`), the credential name (`checkredirectsApi`), node `name` values (`checkredirects`, `checkredirectsTrigger`, `checkredirectsPollTrigger`), resource keys (`inspection`, `batch`, `monitor`, `account`), and operation values (`inspect`, `compareAgents`, `checkAndWait`, etc.) are wired into every installed workflow. Changing them breaks user workflows silently on next n8n start. Renaming any of these requires a major version bump and a migration path, not a quiet refactor.
- **Webhook signature verification must use `crypto.timingSafeEqual`.** `CheckredirectsTrigger.node.ts:130` does this correctly today. Do NOT replace with `===`, `Buffer.compare`, or string equality — that re-introduces a timing oracle on the webhook secret. If signature lengths can differ, the explicit length check before `timingSafeEqual` is required and must stay.
- **Webhook secrets must never appear in logs or NodeOperationError messages.** Currently the trigger silently returns `{ workflowData: [] }` on bad signature — preserve that pattern. Don't add `throw new NodeOperationError(this.getNode(), `Bad signature: expected ${expected}`)` or similar.
- **Credentials password flag must stay on sensitive fields.** `apiKey` uses `typeOptions: { password: true }` — that masks it in the n8n UI and protects from accidental log capture. Same for `webhookSecret` in the trigger. Removing `password: true` is a regression.
- **`baseUrl` defaults to `https://api.checkredirects.io` and is user-overridable on purpose** (self-hosted / dev). Don't hardcode the URL elsewhere — always read from `credentials.baseUrl`. Do not strip the override field.
- **The poll trigger's `staticData.lastSeen` is the idempotency boundary.** `CheckredirectsPollTrigger.node.ts:87-95` uses `getWorkflowStaticData('node')` to track the last seen `created_at`. Changing this without a migration causes duplicate fires on existing workflows.
- **`continueOnFail` semantics must be preserved.** The main node respects `this.continueOnFail()` and emits `{ error: ... }` items instead of throwing (`Checkredirects.node.ts:706-710`). Don't bypass this in new operations.

## Architecture facts

What this project IS:

- **Runtime:** Node.js inside an n8n instance (cloud or self-hosted, any recent n8n version)
- **Language:** TypeScript, target = whatever `tsconfig.json` says (do not assume modern TS features without checking)
- **Build:** `tsc && shx cp <assets> dist/...` — outputs `dist/`, which is what `package.json#n8n.{credentials,nodes}` points to
- **Peer dep:** `n8n-workflow >= 1.0.0` (don't add direct deps on `n8n-core` or `n8n` itself)
- **Auth model:** generic Bearer with `Authorization: Bearer {{$credentials.apiKey}}` via `IAuthenticateGeneric`
- **HTTP:** `this.helpers.httpRequestWithAuthentication` (n8n's wrapper) — NOT `fetch`, NOT `axios`, NOT `got`
- **Three nodes:**
  - `Checkredirects.node.ts` (716 lines) — the big action node. Resources × operations dispatch via a long `if/else` chain; shared `api()` helper with single-retry on 5xx/network errors, mapped error messages by HTTP status; `unwrap()` flattens `data[]` / `checks[]` for n8n's item-per-row model; `splitResults` option fans out batch results to multiple items
  - `CheckredirectsTrigger.node.ts` (161 lines) — webhook receiver, HMAC verification, event filtering. Webhook lifecycle methods (`checkExists`/`create`/`delete`) are intentionally no-ops because the API doesn't register webhooks back; users wire the URL manually
  - `CheckredirectsPollTrigger.node.ts` (99 lines) — polling trigger that reads `/v1/monitors/{id}/runs` and emits new ones based on `created_at`

What this project IS NOT (common wrong assumptions to head off):

- NOT a regular Node service — n8n has its own lifecycle, this code runs inside n8n's process under its constraints
- NOT using `axios` or `node-fetch` — must use `this.helpers.httpRequestWithAuthentication`
- NOT registering webhooks via API (the trigger's `checkExists/create/delete` returning `true` unconditionally is intentional, not a bug — see API design where users paste the webhook URL into their batch/monitor config manually)
- NOT a declarative node (it implements `INodeType` with custom `execute`, not the routing-table style)
- NOT versioned with `nodeVersions` / `INodeVersionedType` — node version is currently `1` baked into the description

## High-risk areas in this repo

Apply extra scrutiny when reviewing diffs in these paths:

- `credentials/CheckredirectsApi.credentials.ts` — credential shape, password flag, test request. Tier 1.
- `nodes/Checkredirects/CheckredirectsTrigger.node.ts` — HMAC verification path (lines 112-133): rawBody handling, signature header parsing, timing-safe compare, fail-closed return on missing/invalid. Tier 1.
- `nodes/Checkredirects/Checkredirects.node.ts` — `api()` retry logic, error message mapping, `splitResults` fan-out, `batch.checkAndWait` 5-minute polling deadline (look for: starvation, no exponential backoff, no jitter, no abort on workflow cancellation)
- `nodes/Checkredirects/CheckredirectsPollTrigger.node.ts` — `lastSeen` watermark logic; first-poll behavior (emits only the newest run, not all runs); sort assumption (`created_at` string comparison — relies on ISO 8601 format from the API)

## Project-specific test posture

No test harness exists. Don't propose Jest / vitest / `n8n-workflow` test utilities as a primary recommendation. If a finding's safety hinges on coverage (e.g., a refactor of HMAC verification), say so and mark it as a follow-up — but treat the missing test infrastructure as a separate decision, not as a fix the audit should require.

`npm run lint` runs `@n8n/scan-community-package .` — that's the publish-time check that matters; new findings should not introduce violations the scanner would flag.

## Project-specific frontend posture

There IS no frontend code. The node description objects (`properties: [...]`) are the UI contract — n8n renders them. Do not recommend extracting them to JSON files (n8n supports both, but TS gives type safety). `displayOptions` filtering is the only UI behavior; verify any new field has matching `displayOptions` so it shows up only when relevant.

## Distribution

- **Published on npm** as `n8n-nodes-checkredirects`, current version 1.0.0
- Backwards compat is **binding** for credential shape, node/operation/resource keys, and webhook event filter values
- Output JSON shapes (the `result` returned by `execute`) feed downstream nodes in user workflows — flag any change that removes or renames fields users likely read
- `package.json#n8n.nodes` array order is part of the public surface (changing the order doesn't break, but adding/removing entries does)

## Docs locations

For `$codex-docs-writer` invocations, default doc files in this repo:

- `README.md` — user-facing intro, install steps, troubleshooting
- `LICENSE` — MIT
- No `CHANGELOG.md` today; if a breaking change is recommended, propose creating one

Do not modify anything outside the above via `$codex-docs-writer` unless explicitly requested.
