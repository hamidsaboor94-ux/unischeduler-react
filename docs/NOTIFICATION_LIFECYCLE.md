# Notification lifecycle integration

Status: **VERIFIED** by `npm run test:notifications` using real Express routes and an isolated in-memory SQLite database.

## Audit summary

The original notification implementation already had an additive `notifications` table, authenticated self-scoped read/read-all routes, a header bell, targeted notice delivery, and an interval-based notice scheduler. It supported in-app delivery only; there was no WebSocket/SSE transport, full inbox, preference model, deterministic retry key, or lifecycle-wide service contract. Most importantly, academic backend services did not call the notification writer, so the lifecycle simulation correctly reported **NOT EXERCISED**. Recipient filtering and the inbox query were not the cause.

This installation is a single-institution database and has no tenant entity. Tenant isolation therefore means validating recipients inside the current database and enforcing `notifications.userId = authenticated user`; no fictitious tenant identifier was introduced.

## Reused architecture

- Existing `notifications` records and authenticated API mount
- Existing notification bell and application navigation system
- Existing targeted announcement recipient resolver
- Existing notice scheduler interval
- Existing RBAC, ownership, audit log, and academic service layers

## Verification

The automated lifecycle calls the real enrollment, attendance, exam, grade-publication, progression, approval, finance, graduation, and notification routes. It verifies recipient/type/entity/action/read state, preference enforcement, mandatory delivery, deterministic deduplication, staff queue delivery, audit entries, failed-action isolation, optional-delivery failure isolation, waitlist promotion, scheduler idempotency, and self-scoped inbox access.

The main isolated student receives **21** transactional lifecycle notifications. Additional recipients and scheduled reminders are asserted separately. The test uses `DB_PATH=:memory:` and never opens, resets, or deletes the production database.

## Delivery limitations

Delivery is currently in-app with safe 30-second polling because the application has no real-time transport. SMTP helper code exists elsewhere in the project, but email is not a general notification channel and the current package manifest does not include its optional `nodemailer` runtime dependency. SMS and push delivery are not implemented. Some lifecycle concepts with no corresponding production workflow yet (for example attendance appeals, grade appeals that automatically alter grades, and finance refund/waiver decisions) can only be connected when those domain actions exist.
