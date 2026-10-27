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

## Build

```sh
npm run build
npm run preview
```
