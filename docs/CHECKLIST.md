## Phase 1 — Foundation (scaffold, config, schema)

- [x] Next.js 14 App Router + React 18 + TypeScript strict + Tailwind scaffold
      (`package.json`, `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`)
- [x] `.env` / `.env.example` (DATABASE_URL, JWT_SECRET, APP_URL, STORAGE_*, OCR_ENGINE)
- [x] Prisma schema — full model set (users/auth, products/document types,
      applications/documents/processing, extractions/barcodes/cross-validation,
      pricing engine tables, PDF templates/mappings, audit log)
- [x] `npx prisma validate` + `npx prisma generate` pass
- [x] TS compiler clean at checkpoint (`npx tsc --noEmit` exit 0)

## Phase 2 — Authentication

- [ ] Registration (firstName, surname, email, mobileNumber, password)
- [ ] Login / logout, bcryptjs hashing, jose JWT in httpOnly cookie
- [ ] Roles: CUSTOMER / ADMIN / SUPER_ADMIN, server-side authorization helpers
- [ ] Password-reset + email-verification token architecture
- [ ] Auth tests (registration, hashing, login, JWT validation/expiry, authorization)

## Phase 3 — Product architecture

- [ ] Product / DocumentType / ProductDocumentRequirement admin CRUD
- [ ] Seeded initial product `vehicle-licence-renewal` + 3 document types
      (requirements read from DB, never hard-coded in React)

## Phase 4 — Customer application workflow

- [ ] Create application (dynamic requirements from DB)
- [ ] Mobile-first upload / replace / retry for JPG, JPEG, PNG, PDF
- [ ] Status tracking on `/dashboard` (application number, product, date,
      status, price, payment status, last updated)

## Phase 5 — Secure document storage

- [ ] Storage abstraction (local private for dev, S3-compatible for prod)
- [ ] No files under `/public`; no public URLs; authenticated/signed access only
- [ ] Customer can access own documents only; generated admin PDF unreachable

## Phase 6 — OCR (Phase 6–8: processing pipeline)

- [ ] Job-based pipeline (upload request never runs OCR)
- [ ] Preprocess → barcode → OCR → field extraction → normalisation →
      validation → confidence → cross-document validation → save → reprice
- [ ] Tesseract.js provider behind provider interface (`OCR_ENGINE`)

## Phase 7 — Barcode extraction

- [ ] ZXing (or equivalent OSS) decode of licence-disc barcode
- [ ] `BarcodeExtraction` stores rawValue + symbology + parsed JSON + confidence
- [ ] Failures fall back to OCR/manual review (never guess)

## Phase 8 — Structured extraction

- [ ] ID extractor (idNumber, surname, firstNames, initials, dob, gender,
      citizenship) with per-field value/normalised/confidence/source/status
- [ ] SA ID validator: 13 digits, date, checksum — validation separate from
      OCR confidence; low confidence flags review, never auto-rejects
- [ ] Proof-of-residence extractor (format-agnostic)
- [ ] Licence-disc extractor (registration, VIN, make, model, dates, etc.)
- [ ] No fabrication: unknown → `null` + `NEEDS_REVIEW`

## Phase 9 — Cross-document validation

- [ ] ID name/idNumber vs proof of residence; ID vs disc owner id
- [ ] Tolerant of formatting differences; mismatches flagged for admin review

## Phase 10 — Pricing engine

- [ ] Database-driven components/rules/lookups (fixed, %, conditional, lookup,
      range, province/municipality/vehicle-type/weight, penalty, arrears,
      service/delivery/transaction fees)
- [ ] Late-licensing rule (22nd-day threshold + arrears) as config, not code
- [ ] `PriceCalculation` stores inputs/breakdown + pricing version
      (historical calculations reproducible)

## Phase 11 — Admin dashboard

- [ ] `/admin`: dashboard, applications, customers, products, documents,
      pricing, lookup tables, PDF templates, processing queue, audit, settings
- [ ] Side-by-side review (document vs extracted data incl. confidence)
- [ ] Manual corrections (old/new/field/admin/timestamp/reason; original kept)
- [ ] Customer DTOs exclude OCR/confidence/notes/pricing-rules/PDF keys

## Phase 12 — ALV(9)(2011/07) PDF mapping

- [x] PDF inspected: 2pp A4, **no AcroForm** → coordinate-based mapping
- [x] Geometry captured (cell/label dumps under `tmp/`)
- [x] `PdfTemplate` + `PdfFieldMapping` models; field registry
      (`src/lib/pdf/fields.ts`) with sections, admin-only + signature flags
- [ ] Seed `ALV(9)(2011/07)` v1 template + initial field mappings
      (owner, address, vehicle, declaration; office-use left blank/admin-only)
- [ ] Admin mapping UI (template → page → field → data source, coordinates)

## Phase 13 — PDF generation

- [ ] pdf-lib coordinate overlay rendering populated fields
      (checkboxes, character boxes, date segments)
- [ ] Unknown values blank; signatures never fabricated;
      office-use admin-controlled
- [ ] Generated PDF stored privately; admin-only routes with
      `requireAuth` + `requireRole(["ADMIN","SUPER_ADMIN"])`
- [ ] Admin actions: Preview / Download / Regenerate
- [ ] Fixture test (spec §47) verifying mapped values on the real form
- [ ] *(Population deferred for now per current instruction — registry and
      mapping infrastructure only)*

## Phase 14 — Audit logging

- [ ] `AuditLog` on register/login/upload/access/OCR/barcode/correction/price/
      pricing-change/product-change/PDF generate+download/status/admin actions
- [ ] No sensitive document contents in logs

## Phase 15 — Testing & security hardening

- [ ] Auth, documents (own-only, IDOR, admin-PDF denial), SA ID, pricing
      (fees/penalties/arrears/lookups/versions), PDF field-mapping tests
- [ ] Security pass: IDOR, BAC, JWT/cookie security, XSS, CSRF, injection,
      malicious uploads, path traversal, oversized files, PDF attacks,
      sensitive logging, API response exposure
