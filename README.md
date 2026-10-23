# Mobile Joe store

Direct-to-customer storefront for Mobile Joe. Canada only, prices in CAD. Accessories for now; phones to follow.

## Run it
Open `index.html` in a browser, or upload this folder to any static host. There is no build step.

## Product images
Each SKU has its own folder: `images/products/<sku>/` (lowercase SKU, folders already created).
Add files as `1.webp` (main image), `2.webp`, `3.webp`, `4.webp`. `.jpg`, `.jpeg` and `.png` also work.
No code changes needed. Missing images fall back to a placeholder.
Recommended: square, at least 1200 x 1200 px, plain white or transparent background, under 300 KB each (WebP preferred).
In the Supabase build this layout becomes a Storage bucket (`product-images/<sku>/1.webp`).

## SKUs and renaming
SKUs come from the inventory sheet's ITEM text (uppercased, symbols replaced by hyphens) and never change.
Rename products in `catalog.js` (field `n`). The URL slug (`s`) is stored separately so renaming does not break links.

## Data
- `catalog.js`: what customers see. It holds no stock quantities, only in stock or out of stock.
- `data/inventory.csv`: internal quantities and prices. It is listed in `.gitignore` so it is never published.
- `data/image-sources.csv`: Newegg listing and image for each SKU (`use`, `review` or `missing`). `tools/download-images.py` can save the `use` images into the SKU folders.

## Roadmap
React + TypeScript + Vite port, Supabase (database, auth, storage), Stripe payments, admin area, marketplace stock sync.
