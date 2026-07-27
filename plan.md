# Shop Management System — Complete Build Plan (Web-Only)
## Pakistan kiryana/mart/wholesale management SaaS — Build Plan

> No AI features. No Electron. No mobile apps. Pure web app (Next.js + Supabase), deployable free
> on Vercel + Supabase. Goal: sellable, working product — build fast, sell fast, iterate with real
> paying customers.

---

## 1. Final Tech Stack (locked)

| Layer | Choice |
|---|---|
| Frontend + Backend | **Next.js 15 (App Router) + TypeScript** — single app, API routes for backend logic |
| Database | **PostgreSQL via Supabase** (with Row Level Security for tenant isolation) |
| Auth | Supabase Auth (phone/email + PIN for counter switching) |
| UI | Tailwind CSS + shadcn/ui |
| State/data fetching | TanStack Query |
| Hosting | Vercel (frontend+API) + Supabase Cloud (DB) — both free tier to start |
| Notifications | WhatsApp Business Cloud API (manual/free tier initially) |
| Payments (customer-facing) | Raast QR / JazzCash / Easypaisa — manual entry field for now, no gateway integration yet |
| Printing | Browser print (CSS print stylesheet) for receipts; ESC/POS web-print later if needed |
| Barcode | USB barcode scanner works natively — it types into any focused input field, no integration needed |

**Absolute rules:**
1. Money = integer paisa. Never float.
2. Weight = integer grams. Never float.
3. Every table has `tenant_id` + Postgres RLS policy. Test cross-tenant isolation on day one.
4. No hard deletes on financial records — soft delete with reason.

---

## 2. Feature Scope for v1 (from the agreed feature list — modules A–K, no AI, no L/FBR yet)

Building modules **A, B, C, D, F (light), G (light), H** fully. **E (wholesale)** and full **I
(multi-branch)** come after first paying customers, in Phase 7. **L (FBR)** is not touched at all
in this plan — separate future engagement.

---

## 3. Phases — Full Plan (start to finish, including polish & testing)

### PHASE 1 — Foundation & Setup
**Goal:** working skeleton, auth, database, deployed.
- Next.js 15 project setup, Tailwind + shadcn/ui, Turborepo not needed (single app, skip monorepo overhead)
- Supabase project: schema for tenants, users, roles, permissions
- RLS policies on every table + write a test that tries cross-tenant read and confirms it fails
- Auth: phone/email login, PIN-based counter login for cashier
- Basic role model: Owner, Manager, Cashier
- Deploy skeleton to Vercel, confirm Supabase connection live
- **Testing:** auth flow works, tenant isolation test passes, deployed URL is live

### PHASE 2 — Product & Inventory Core
**Goal:** product catalog fully manageable.
- Product master: name (EN+UR), barcode(s), category, brand, base unit, tax rate, image
- Multi-UOM: purchase unit vs stock unit vs sale unit with conversion factors (carton→packet→gram)
- Category management
- Opening stock bulk import (CSV/Excel upload with validation + error report)
- Stock ledger (append-only movement log) — this is the source of truth for all stock
- Low stock alerts + reorder level
- Stock adjustment (with reason: damage/theft/wastage)
- **Testing:** import 1000+ row CSV without failure; UOM conversion math verified with unit tests

### PHASE 3 — Point of Sale (Billing)
**Goal:** a cashier can actually sell something end to end.
- Billing screen: barcode scan (input focus + Enter detection), manual search, weight entry (manual typing for now)
- Cart: add/remove/edit line items, line discount, bill discount (permission-gated)
- Checkout: multiple payment modes on one bill (cash + khata + JazzCash/Easypaisa reference field)
- Hold/recall bill
- Sale return/exchange with reason
- Receipt: browser print + WhatsApp share (send as text/link) + PDF download
- Round-off handling for cash
- Shift open/close: opening cash, expected vs actual closing cash, variance report
- **Testing:** full sale flow (scan → cart → checkout → receipt) manually tested with 20+ dummy products; shift variance math verified

### PHASE 4 — Purchases & Suppliers
**Goal:** stock coming in is tracked and costed correctly.
- Supplier master + credit terms
- Purchase invoice entry: batch, expiry date, cost price, discount, free-goods/scheme flag
- Weighted-average costing engine (unit tested — this is the highest-risk logic in the whole app)
- Purchase return
- Supplier ledger + payables aging report
- Goods Receipt (partial receipt supported)
- **Testing:** costing engine gets a dedicated test suite — multiple purchases at different rates, free goods, returns — verify average cost is always correct

### PHASE 5 — Customer & Khata (Credit Ledger)
**Goal:** the #1 requested feature — digital udhaar book.
- Customer master + credit limit + optional price tier field (tier logic itself comes in Phase 7)
- Digital khata ledger — running balance, full transaction history
- Credit limit enforcement at checkout (block or warn based on permission)
- Aging report (kitna purana udhaar)
- WhatsApp reminder — manual "send reminder" button per customer (automated scheduling comes later)
- Partial payment allocation against balance
- Blacklist/stop-supply flag
- **Testing:** ledger balance math verified against manual calculation on 10 sample scenarios

### PHASE 6 — Reports, Roles & Security Polish
**Goal:** owner can trust the numbers and trust the staff.
- Daily WhatsApp sales summary (manual trigger first, cron job later)
- Sales by day/item/category/brand; gross margin report; top/worst sellers
- Cashier-wise sales/discount/return report (theft visibility)
- Stock valuation report
- Full audit log (who changed what, when) — read-only view for owner
- Permission refinement: cost price hidden from cashier role, enforced at both UI and API layer
- Cash book + expense entry + simplified daily closing summary
- **Testing:** every report cross-checked against raw ledger data for at least one full day of dummy transactions

### PHASE 7 — Final Polish, Hardening & Full Testing
**Goal:** this is what actually gets sold. Do not skip or shorten this phase.
- UI polish pass: consistent spacing, loading states, empty states, error states across every screen
- Urdu labels for key UI (product names, receipts) — full RTL UI can wait, but Urdu product
  names and Urdu receipt text should work now since shopkeepers expect this
- Performance check: product search must feel instant even with 5,000+ SKUs
- Full manual QA pass: every module, every role, on both desktop browser and Android phone browser
- Data export: every ledger/report exportable to Excel/PDF (removes lock-in fear, builds trust)
- Onboarding flow: guided first-time setup wizard (add shop → add products → add first sale)
- Backup: manual "export all my data" button per tenant
- Basic subscription/trial gate: trial countdown banner, manual "contact to subscribe" flow
  (no payment gateway integration yet — you'll invoice/collect manually from first customers)
- Bug bash: use the app yourself for 2 full days as if you were the shopkeeper
- **Testing:** end-to-end test of a full business day — opening shift → purchases → 20 sales
  (mixed cash/khata) → returns → closing shift → reports — numbers must reconcile perfectly

### PHASE 8 — Pilot & Sell (parallel with Phase 7's final week)
**Goal:** first real rupees.
- Deploy final build, set up 1 real tenant with your own test data removed
- Go to 15-20 wholesale-cum-retail shops with a live demo on your laptop/phone
- Get 2-3 shops to pay an advance and onboard for real
- You personally do their data migration and on-site setup
- Sit with them for their first real business day, fix what breaks immediately
- **This phase has no new features — only real-world bug fixes and onboarding**

---

## 4. What Is Deliberately Excluded From This Plan (add later, only after paying customers exist)

- Wholesale/order-booker module (Module E)
- Multi-branch (Module I) beyond a single branch
- Automated FBR/tax compliance (Module L)
- Any AI feature
- Native mobile apps
- Full offline-first sync (PowerSync/Electron) — if a paying customer's internet is too unreliable
  for the current online-first + short buffer approach, that's the trigger to revisit this, not before

---

## 5. Execution Order

Build one phase at a time, in order, phase by phase — don't start a later phase until the current
one is complete and tested. After each phase, run its testing checklist before moving to the next.
