# Mobile Joe store

Customer storefront and store admin for Mobile Joe, built with React, TypeScript and Vite. The catalog contains the existing 18 accessories and uses designed placeholders until product photos are ready. Prices are in CAD; the store is set up for Canada-wide checkout.

## Run the storefront

```sh
npm install
npm run dev
```

## Download catalog product images

Image URLs in `src/data/catalog.json` are saved to variant SKU folders under `images/products/`. Run this from the project root in Windows PowerShell:

```powershell
.\tools\download-catalog-images.ps1
```

If script execution is disabled, run it once through PowerShell with `powershell -ExecutionPolicy Bypass -File .\tools\download-catalog-images.ps1`. The script creates missing folders, numbers multiple images `1`, `2`, etc., and skips files already downloaded. Use `.\tools\download-catalog-images.ps1 -Force` to replace existing numbered images. Vite includes local image files in the production build; the storefront uses image `1` if a Supabase image URL is not set. Check that you have permission to use the linked images in your store.

Without credentials the storefront runs from its bundled catalog with a local shopping bag. Checkout and admin screens show their setup state. Make a `.env.local` from `.env.example` when connecting a backend:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
VITE_CHECKOUT_ENABLED=false
```

The public anon key is safe to use in the storefront because table access is controlled by row-level security. Never put the Supabase service role key or Stripe secret key in a `VITE_` variable or in client code.

## Deploy to Vercel

1. Push this project to a GitHub repository. Keep `.env.local` and `data/inventory.csv` out of the repository; `.gitignore` excludes both.
2. In Vercel, choose **Add New → Project**, connect GitHub, and import the store repository.
3. Vercel detects Vite. Confirm the build command is `npm run build` and the output directory is `dist`.
4. Add these project environment variables for **Production** and **Preview**:
   - `VITE_SUPABASE_URL` — your Supabase project URL.
   - `VITE_SUPABASE_ANON_KEY` — your Supabase public anon/publishable key.
   - `VITE_CHECKOUT_ENABLED` — `false` until Stripe Checkout and its webhook are configured.
5. Choose **Deploy**. Vercel provides a `*.vercel.app` URL. Add that URL to Supabase **Authentication → URL Configuration → Redirect URLs** so the admin account can sign in on the hosted site.

You can deploy the catalog before creating a Stripe account. Customers can browse and add items to their bag; the checkout panel tells them online payments are not live yet and gives them Joe’s contact email. Once Stripe is configured and both Supabase Edge Functions are deployed, change `VITE_CHECKOUT_ENABLED` to `true` in Vercel and redeploy. Vite environment values are included at build time, so changing them requires a new deployment. Do not add Supabase service-role or Stripe secret keys to Vercel variables prefixed with `VITE_`.

## Phase 1 — React + TypeScript + Vite

- Responsive storefront, product categories, search, product pages, variant selection, cart and local persistence.
- The catalog moved from `catalog.js` to `src/data/catalog.json`.
- Product photos can be downloaded from the catalog into `images/products/<sku>/` with the script above, or uploaded to Supabase Storage from the admin Inventory tab. Until photos are available, category based product illustrations are shown.
- Without a populated backend, the storefront uses its bundled catalog.

## Phase 2 — Supabase database, auth and storage

1. Create a Supabase project and install the Supabase CLI.
2. Link this folder and apply the schema:

   ```sh
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

3. Copy `.env.example` to `.env.local` and set the project URL and anon key.
4. Start the site, open `#/admin`, sign in with a Supabase Auth email/password account, and promote the account in the Supabase SQL editor:

   ```sql
   insert into public.admin_users(user_id)
   select id from auth.users where email = 'joe@example.com';
   ```

5. In Admin → Overview, import the storefront catalog. In Admin → Inventory, upload the private `data/inventory.csv` stock sheet to load exact quantities. The import understands the `sku` and `qty_internal_only` column names. Keep that source file private; it is ignored by git and is never bundled into the website.

Supabase stores public product details and variant prices in `products` / `product_variants`. Exact quantities and reservations live in the admin-only `inventory` table. Public users can see whether a variant is in stock, never its quantity. Product photos use the public `product-images` bucket; uploads are admin-only.

## Phase 3 — Stripe payments

Set Edge Function secrets in Supabase:

```sh
supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_... SITE_URL=https://YOUR_STORE_DOMAIN
```

Deploy both functions:

```sh
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook
```

In the Stripe Dashboard, add a webhook endpoint at `https://YOUR_PROJECT.supabase.co/functions/v1/stripe-webhook` for:

- `checkout.session.completed`
- `checkout.session.expired`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`

The checkout function reads prices and inventory from Supabase, reserves stock before redirecting to Stripe Checkout, restricts shipping to Canada, offers the existing $10 standard and $25 express shipping options, and enables Stripe Tax. The signed webhook completes paid orders and releases reservations when checkout expires. Configure Stripe tax registrations and confirm rates, shipping fees, delivery estimates and the live/test mode in the Stripe account before accepting live orders.

## Phase 4 — Admin area

The `#/admin` area is protected by Supabase Auth and the `admin_users` allowlist. It includes stock editing, private CSV stock imports, catalog initialization, product image uploads, order review and fulfillment status, and inventory export. Customers do not receive access to the inventory table or admin records.

## Phase 5 — Marketplace stock sync

Admin → Marketplace sync supports a CSV export/import flow now. Export `sku,quantity` for marketplace listings. Import a marketplace snapshot with a SKU column and one of `quantity`, `qty`, `stock` or `available`; matched counts update the store stock and marketplace comparison record. Unmatched SKUs are skipped. A provider-specific API connection can be added once the marketplaces and their credentials are selected; they are not identified in the current roadmap.

## Phase 6 - Shopper experience

**Goal:** Turn the shopper-experience roadmap below into complete, connected storefront features. Keep the local catalog/bag fallback working, and use Supabase as the source of truth whenever it is configured.

1. **Confirm the product and store policies.** Define a consistent compatibility vocabulary for phone models, connectors, and charging power. Confirm what Mobile Joe can reliably provide for refurbished condition, battery health, warranty, included items, shipping rates and delivery estimates, returns, and review permissions. Mark unknown product facts as unknown instead of guessing.
2. **Extend the catalog and admin data model.** Add typed fields and a Supabase migration for compatibility, condition/grade, battery health when known, warranty, box contents, and multiple product images. Add structured review records with the customer quote, marketplace, source reference, date, related product when known, rating type, and publication/verification state. Update the bundled catalog, Supabase catalog import, admin editing, and validation so staff can maintain the same fields in either catalog mode. Keep private customer data and unapproved reviews out of public reads; expose only approved review content under RLS.
3. **Build a product finder and comparison flow.** Add filters for brand, price, stock, device compatibility, connector, charging wattage, condition, and storage where applicable, plus useful price/availability sorting. Keep search, category, filters, and sort in the URL so links can be shared and browser Back works. Add a mobile-friendly comparison view for up to three products, with a clear empty state and a way to remove compared items.
4. **Make product pages answer fit and condition questions.** Display a responsive, keyboard-accessible photo gallery with useful alt text; show compatibility and specs in a consistent layout; and display condition, testing, battery-health information when available, warranty, and included items for refurbished phones. Preserve variant selection and SKU-level stock. Clearly distinguish confirmed compatibility from missing information.
5. **Make bag totals and delivery information predictable.** On bag open and before checkout, refresh item prices and availability from the backend and explain any changed or unavailable line. Show CAD item subtotal, the available shipping choices and their current prices, and delivery estimates before redirecting to Stripe; make displayed choices match Stripe's configured rates and tax handling. Preserve the current $10 standard and $25 express options only if those amounts and estimates are still the approved policy. Keep final taxes and charges authoritative in Stripe and handle checkout failures without losing the bag.
6. **Publish attributable reviews.** Replace unstructured quote content with approved review records. Show the customer's words separately from marketplace seller ratings, with the marketplace, date, and product when known. Keep seller scores clearly labeled as seller scores; show a verified-purchase label only when the source confirms it. Provide an admin review/publish workflow and an empty state when no approved reviews are available.
7. **Complete post-purchase support.** Add an order confirmation and status email flow, shipment carrier/tracking details, and customer-facing order lookup and returns instructions. Use an expiring, unguessable email access link or equivalent verification for order lookup; do not expose order details through a guessable order number. Add the order statuses and admin actions needed to support the published fulfillment, cancellation, and return policies.
8. **Validate and roll out the whole journey.** Add automated coverage for URL-persisted filters, comparison, product variants, bag price/stock refresh, shipping display, review visibility, and order access. Manually review keyboard and screen-reader flows, reduced motion, phone/tablet layouts, slow image loading, empty/error states, and the checkout-enabled and checkout-disabled states. Populate and review the product facts and approved reviews before launch, deploy migrations and functions to staging first, then verify the production configuration and support emails.

**Phase 6 is complete when** shoppers can find and compare products, understand fit and condition, see accurate bag/shipping information before Stripe, read properly attributed reviews, and securely get order and return help after purchase; staff can maintain the supporting catalog and review data; and the full journey passes the checks in step 8.

## Build

```sh
npm run build
npm run preview
```

## Suggested features and quality-of-life improvements

The items below are a forward-looking roadmap based on the current storefront, catalog, checkout, and admin code. The Shopper experience items are expanded into Phase 6 above; the remaining items are suggestions, not implemented features.

### Shopper experience

- **Make product discovery more precise.** The shop currently searches product name, brand, category, and description, with category navigation. Add filters and sorting for price, availability, brand, device compatibility, connector type, charging wattage, and (for refurbished phones) condition and storage. A compare view would help customers choose between similar devices and accessories.
- **Explain fit and product condition.** Extend the catalog and admin editor with structured compatibility, tested condition/grade, battery-health details when available, warranty, and box contents. Add a product photo gallery and make compatibility information easy to scan before purchase.
- **Show delivery details earlier and improve aftercare.** The bag is saved in the browser and shipping options are selected in Stripe Checkout. Show the available shipping prices and delivery estimates in the bag before the customer leaves the store, and recheck saved bag items against current prices and availability. Add a customer order lookup, shipment tracking, clear returns instructions, and order-status emails.
- **Make reviews easier to trust.** For each customer quote, show its marketplace, product (when known), and review date. Keep seller ratings distinct from customer-written reviews, and label a purchase as verified only when Mobile Joe has verified it.

### Store operations

- **Make stock changes safer and easier to trace.** Add a CSV dry run that previews matched, duplicate, invalid, and unmatched rows before applying changes. Record each stock adjustment with its source, staff member, timestamp, and before/after values; allow staff to review or reverse an import. Make the current low-stock threshold configurable and add an alert option.
- **Build out marketplace reconciliation.** The current CSV workflow updates matched SKUs and skips unmatched rows, while the admin shows only the latest sync time. Add a browsable run history, a before/after quantity comparison, a downloadable exceptions report, and a review step for conflicts. Add a direct marketplace integration after choosing the target provider and its supported API.
- **Give the order desk room to grow.** The admin fetches the 50 newest orders and supports marking paid orders fulfilled. Add search, status/date filters, pagination, shipment carrier and tracking details, and a clear cancellation/refund workflow with customer notifications.

### Quality and launch readiness

- **Add repeatable automated checks.** The package currently has build, dev, and preview scripts, but no test or lint script. Add unit tests for catalog mapping, cart quantity limits, and CSV parsing, plus browser-flow coverage for search, bag edits, checkout success/failure, and mobile layouts. Run build and checks in CI on each change.
- **Review accessibility and motion.** Check keyboard operation, focus order and return, dialog announcements, form labels, contrast, and reduced-motion behavior across the navigation, product cards, bag, checkout, and admin. Use the [W3C focus-order guidance](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html) as a baseline.
- **Optimize the product imagery and search previews.** Product photos are rendered without loading hints. Generate appropriately sized responsive images, keep the main above-the-fold image eager, and defer offscreen catalog photos; measure the result on mobile. Google's [image lazy-loading guidance](https://web.dev/articles/lcp-lazy-loading) explains why the initial viewport should not be lazy-loaded indiscriminately. Add product-specific page descriptions, social-sharing metadata, structured product data, and a sitemap to improve sharing and organic discovery.
- **Add payment operations and a recovery runbook.** Stripe checkout creation already uses an idempotency key and database order-state procedures guard inventory updates. Add a durable webhook event log, clear alerts for failed processing, and a reconciliation job for stale reservations or paid orders that need review. Document production checks for RLS, secrets, backups, and restore steps using the [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod); Stripe's [webhook guide](https://docs.stripe.com/webhooks) and [idempotent request reference](https://docs.stripe.com/api/idempotent_requests) cover reliable event and retry handling.
