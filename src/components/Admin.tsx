import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Boxes, Check, CircleAlert, Clock3, ImagePlus, LoaderCircle, LogOut, PackageCheck, RefreshCw, ShieldCheck, ShoppingBag, Store, Upload } from "lucide-react";
import { localCatalogProducts, money } from "../lib/catalog";
import { supabase } from "../lib/supabase";

type Tab = "overview" | "inventory" | "orders" | "sync";
type VariantRow = { id: string; sku: string; attributes: Record<string, string>; price_cad: number; in_stock: boolean; product?: { id?: string; name: string; slug?: string } | { id?: string; name: string; slug?: string }[]; inventory?: { on_hand: number; reserved: number; marketplace_qty: number | null } | { on_hand: number; reserved: number; marketplace_qty: number | null }[] };
type OrderRow = { id: string; email: string; status: string; total_cents: number; created_at: string; order_items?: { product_name: string; sku: string; quantity: number; unit_price_cents: number }[] };
type StockRow = { variant_id: string; sku: string; on_hand: number; reserved: number; marketplace_qty: number | null; name: string; attributes: Record<string, string> };

const flatten = <T,>(row: T | T[] | undefined): T | undefined => Array.isArray(row) ? row[0] : row;

function detectCsvDelimiter(text: string) {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') { index++; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && (char === "\n" || char === "\r")) break;
    if (!quoted && Object.prototype.hasOwnProperty.call(counts, char)) counts[char]++;
  }
  return [",", ";", "\t"].reduce((best, delimiter) => counts[delimiter] > counts[best] ? delimiter : best, ",");
}

function parseCsv(text: string) {
  const delimiter = detectCsvDelimiter(text.replace(/^\uFEFF/, ""));
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quote = false;
  text = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"' && text[index + 1] === '"' && quote) { cell += '"'; index++; }
    else if (char === '"') quote = !quote;
    else if (char === delimiter && !quote) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quote) {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (quote) throw new Error("CSV contains an unclosed quoted field.");
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}

const normalizeCsvHeader = (value: string) => value
  .replace(/^\uFEFF/, "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "");

const skuHeaderAliases = new Set([
  "sku", "productsku", "itemsku", "variantsku", "stockkeepingunit",
  "productcode", "itemcode", "itemnumber", "partnumber", "stockcode",
]);
const quantityHeaderAliases = new Set([
  "quantity", "qty", "stock", "available", "qtyinternalonly",
  "onhand", "onhandqty", "quantityonhand", "qtyonhand",
  "availablequantity", "sellablequantity", "count", "countedquantity",
]);
const brandHeaderAliases = new Set(["brand", "productbrand", "manufacturer", "maker"]);
const modelHeaderAliases = new Set(["brandmodel", "model", "productmodel", "devicemodel", "productname", "itemname"]);
const colorHeaderAliases = new Set(["color", "colour", "devicecolor", "devicecolour"]);
const conditionHeaderAliases = new Set(["condition", "grade", "devicecondition"]);
const storageHeaderAliases = new Set(["storage", "capacity", "memory", "storagesize"]);
const otherTableHeaderAliases = new Set([
  "name", ...modelHeaderAliases, ...colorHeaderAliases, ...conditionHeaderAliases, ...storageHeaderAliases,
]);

type StockCsvColumns = {
  headerRowIndex: number;
  endRowIndex: number;
  kind: "sku" | "product";
  skuIndex: number;
  quantityIndex: number;
  brandIndex: number;
  modelIndex: number;
  colorIndex: number;
  conditionIndex: number;
  storageIndex: number;
};
type StockQuantity =
  | { status: "valid"; quantity: number; hasUnit: boolean }
  | { status: "blank" | "invalid" };

function isStockTableHeader(row: string[]) {
  const headers = row.map(normalizeCsvHeader);
  const recognizedHeaders = headers.filter((header) =>
    skuHeaderAliases.has(header) || quantityHeaderAliases.has(header) || brandHeaderAliases.has(header) || otherTableHeaderAliases.has(header),
  ).length;
  return recognizedHeaders >= 2 && headers.some((header) => skuHeaderAliases.has(header) || quantityHeaderAliases.has(header));
}

function findStockCsvColumns(rows: string[][]): StockCsvColumns[] {
  const tables: StockCsvColumns[] = [];
  for (let headerRowIndex = 0; headerRowIndex < rows.length; headerRowIndex++) {
    const headers = rows[headerRowIndex].map(normalizeCsvHeader);
    const skuIndex = headers.findIndex((header) => skuHeaderAliases.has(header));
    const quantityIndex = headers.findIndex((header) => quantityHeaderAliases.has(header));
    const modelIndex = headers.findIndex((header) => modelHeaderAliases.has(header));
    const colorIndex = headers.findIndex((header) => colorHeaderAliases.has(header));
    if (quantityIndex < 0 || (skuIndex < 0 && (modelIndex < 0 || colorIndex < 0))) continue;
    tables.push({
      headerRowIndex,
      endRowIndex: rows.length,
      kind: skuIndex >= 0 ? "sku" : "product",
      skuIndex,
      quantityIndex,
      brandIndex: headers.findIndex((header) => brandHeaderAliases.has(header)),
      modelIndex,
      colorIndex,
      conditionIndex: headers.findIndex((header) => conditionHeaderAliases.has(header)),
      storageIndex: headers.findIndex((header) => storageHeaderAliases.has(header)),
    });
  }
  if (!tables.length) throw new Error("CSV needs a SKU or a product model and color, plus a Quantity or On-hand column.");
  return tables.map((table) => {
    const nextHeaderIndex = rows.findIndex((row, index) => index > table.headerRowIndex && isStockTableHeader(row));
    return { ...table, endRowIndex: nextHeaderIndex < 0 ? rows.length : nextHeaderIndex };
  });
}

function parseStockQuantity(value: string): StockQuantity {
  const raw = value.trim();
  if (!raw) return { status: "blank" };
  const match = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.0+)?\s*(ea|each|pc|pcs|unit|units|piece|pieces|item|items)?$/i.exec(raw);
  if (!match) return { status: "invalid" };
  const quantity = Number(match[1].replaceAll(",", ""));
  return Number.isSafeInteger(quantity) && quantity >= 0
    ? { status: "valid", quantity, hasUnit: Boolean(match[2]) }
    : { status: "invalid" };
}

type ResolvedStockCsvRow = {
  sku: string | null;
  quantity: StockQuantity;
  matched: boolean;
  groupKey: string;
  kind: "sku" | "product";
  ambiguous: boolean;
  offset?: number;
};

function resolveStockCsvRow(row: string[], columns: StockCsvColumns, knownSkus: Set<string>): ResolvedStockCsvRow | null {
  if (columns.kind !== "sku") return null;
  const candidates: ResolvedStockCsvRow[] = [];
  const maxOffset = Math.min(8, Math.max(0, row.length - 1 - Math.max(columns.skuIndex, columns.quantityIndex)));
  for (let offset = 0; offset <= maxOffset; offset++) {
    const sku = (row[columns.skuIndex + offset] ?? "").trim();
    if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(sku)) continue;
    const brand = columns.brandIndex >= 0 ? (row[columns.brandIndex + offset] ?? "").trim() : "";
    if (columns.brandIndex >= 0 && !/[a-z]/i.test(brand)) continue;
    const matched = knownSkus.has(sku.toUpperCase());
    if (offset > 0 && columns.brandIndex < 0 && !matched) continue;

    const quantityIndex = columns.quantityIndex + offset;
    let quantity = parseStockQuantity(row[quantityIndex] ?? "");
    if (quantity.status === "invalid") {
      for (let overflow = 1; overflow <= 2; overflow++) {
        const middle = row.slice(quantityIndex, quantityIndex + overflow);
        if (middle.some((cell) => !cell.trim())) break;
        const shiftedQuantity = parseStockQuantity(row[quantityIndex + overflow] ?? "");
        if (shiftedQuantity.status === "valid" && shiftedQuantity.hasUnit) { quantity = shiftedQuantity; break; }
        if (shiftedQuantity.status === "blank") break;
      }
    }
    candidates.push({ sku, quantity, matched, groupKey: `sku:${sku.toUpperCase()}`, kind: "sku", ambiguous: false, offset });
  }

  const quantityRank = (quantity: StockQuantity) => quantity.status === "valid" ? 2 : quantity.status === "blank" ? 1 : 0;
  candidates.sort((a, b) => Number(b.matched) - Number(a.matched) || quantityRank(b.quantity) - quantityRank(a.quantity) || (a.offset ?? 0) - (b.offset ?? 0));
  return candidates[0] ?? null;
}

const normalizeMatchValue = (value: string) => normalizeCsvHeader(value).replace(/gray/g, "grey");
const normalizeProductModel = (value: string) => value
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/^\s*(apple|samsung)\s+/, "")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

function resolveProductStockCsvRow(row: string[], columns: StockCsvColumns, stocks: StockRow[]): ResolvedStockCsvRow | null {
  if (columns.kind !== "product") return null;
  const model = (row[columns.modelIndex] ?? "").trim();
  const color = (row[columns.colorIndex] ?? "").trim();
  if (!model || !color) return null;

  const condition = columns.conditionIndex >= 0 ? (row[columns.conditionIndex] ?? "").trim() : "";
  const storage = columns.storageIndex >= 0 ? (row[columns.storageIndex] ?? "").trim() : "";
  const quantity = parseStockQuantity(row[columns.quantityIndex] ?? "");
  const matches = stocks.filter((stock) => {
    if (normalizeProductModel(stock.name) !== normalizeProductModel(model)) return false;
    const attributes = stock.attributes ?? {};
    const stockColor = attributes.Colour ?? attributes.Color ?? attributes.color ?? "";
    if (!stockColor || normalizeMatchValue(stockColor) !== normalizeMatchValue(color)) return false;
    const stockCondition = attributes.Condition ?? attributes.Grade ?? "";
    if (condition && (!stockCondition || normalizeMatchValue(stockCondition) !== normalizeMatchValue(condition))) return false;
    const stockStorage = attributes.Storage ?? attributes.Capacity ?? attributes.Memory ?? "";
    if (storage && (!stockStorage || normalizeMatchValue(stockStorage) !== normalizeMatchValue(storage))) return false;
    return true;
  });
  const identity = [normalizeProductModel(model), normalizeMatchValue(color), normalizeMatchValue(condition), normalizeMatchValue(storage)].join(":");
  const sku = matches.length === 1 ? matches[0].sku : null;
  return {
    sku,
    quantity,
    matched: matches.length === 1,
    groupKey: sku ? `sku:${sku.toUpperCase()}` : `product:${identity}`,
    kind: "product",
    ambiguous: matches.length > 1,
  };
}
function downloadCsv(rows: string[][], name: string) {
  const csv = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); link.download = name; link.click(); URL.revokeObjectURL(link.href);
}

export function Admin() {
  const [tab, setTab] = useState<Tab>("overview");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [filter, setFilter] = useState("");
  const [lastSync, setLastSync] = useState("");

  const loadData = async () => {
    if (!supabase || !userId || !isAdmin) return;
    const [variantResult, orderResult, syncResult] = await Promise.all([
      supabase.from("product_variants").select("id, sku, attributes, price_cad, in_stock, product:products(id,name,slug), inventory(on_hand,reserved,marketplace_qty)").order("sku"),
      supabase.from("orders").select("id,email,status,total_cents,created_at,order_items(product_name,sku,quantity,unit_price_cents)").order("created_at", { ascending: false }).limit(50),
      supabase.from("marketplace_sync_runs").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (variantResult.data) setVariants(variantResult.data as VariantRow[]);
    if (variantResult.error) setMessage(`Could not load inventory: ${variantResult.error.message}`);
    if (orderResult.data) setOrders(orderResult.data as OrderRow[]);
    if (syncResult.data) setLastSync(new Date(syncResult.data.created_at).toLocaleString());
  };

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    void client.auth.getSession().then(async ({ data }) => {
      const sessionUser = data.session?.user;
      if (!sessionUser) return;
      setUserId(sessionUser.id);
      const { data: access } = await client.from("admin_users").select("user_id").eq("user_id", sessionUser.id).maybeSingle();
      setIsAdmin(Boolean(access));
    });
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
      if (!session) setIsAdmin(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => { void loadData(); }, [userId, isAdmin]);
  const stocks = useMemo<StockRow[]>(() => variants.map((variant) => {
    const inventory = flatten(variant.inventory);
    const product = flatten(variant.product);
    return { variant_id: variant.id, sku: variant.sku, on_hand: inventory?.on_hand ?? 0, reserved: inventory?.reserved ?? 0, marketplace_qty: inventory?.marketplace_qty ?? null, name: product?.name ?? "Product", attributes: variant.attributes ?? {} };
  }), [variants]);
  const visibleStocks = stocks.filter((item) => `${item.name} ${item.sku}`.toLowerCase().includes(filter.toLowerCase()));

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!supabase) return;
    setBusy(true); setMessage("");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setMessage(error.message);
    else if (data.user) {
      setUserId(data.user.id);
      const { data: access, error: accessError } = await supabase.from("admin_users").select("user_id").eq("user_id", data.user.id).maybeSingle();
      if (accessError || !access) { await supabase.auth.signOut(); setUserId(null); setMessage("This account does not have store admin access."); }
      else setIsAdmin(true);
    }
    setBusy(false);
  };

  const updateStock = async (stock: StockRow, quantity: number) => {
    if (!supabase || !Number.isInteger(quantity) || quantity < 0) return;
    const { error } = await supabase.from("inventory").upsert({ variant_id: stock.variant_id, on_hand: quantity }, { onConflict: "variant_id" });
    setMessage(error ? error.message : `${stock.sku} stock updated.`); if (!error) void loadData();
  };

  const importCatalog = async () => {
    if (!supabase) return;
    setBusy(true); setMessage("");
    let imported = 0;
    for (const product of localCatalogProducts) {
      const { data, error } = await supabase.from("products").upsert({
        slug: product.slug, name: product.name, brand: product.brand, category: product.category,
        description: product.description, specs: product.specs, featured: product.featured, active: true,
      }, { onConflict: "slug" }).select("id").single();
      if (error || !data) { setMessage(error?.message ?? `Could not import ${product.name}.`); setBusy(false); return; }
      for (const variant of product.variants) {
        const { error: variantError } = await supabase.from("product_variants").upsert({
          product_id: data.id, sku: variant.sku, attributes: variant.attributes, price_cad: variant.price,
        }, { onConflict: "sku" });
        if (variantError) { setMessage(variantError.message); setBusy(false); return; }
      }
      imported++;
    }
    setBusy(false); setMessage(`${imported} products imported. Add stock from the Inventory tab to make items available.`); void loadData();
  };

  const uploadStockFile = async (event: ChangeEvent<HTMLInputElement>, marketplace = false) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || !supabase) return;
    setBusy(true); setMessage("");
    try {
      const parsedRows = parseCsv(await file.text());
      const columns = findStockCsvColumns(parsedRows);
      const dataRows = columns.flatMap((table) =>
        parsedRows.slice(table.headerRowIndex + 1, table.endRowIndex)
          .filter((row) => row.some((cell) => cell.trim()))
          .map((row) => ({ row, table })),
      );
      if (!dataRows.length) throw new Error("This CSV has stock headers but no stock rows.");

      const bySku = new Map(stocks.map((stock) => [stock.sku.toUpperCase(), stock]));
      const knownSkus = new Set(bySku.keys());
      const catalogSkus = new Set(localCatalogProducts.flatMap((product) => product.variants.map((variant) => variant.sku.toUpperCase())));
      const resolvedRows: ResolvedStockCsvRow[] = [];
      let malformedRows = 0;
      for (const { row, table } of dataRows) {
        const resolved = table.kind === "sku"
          ? resolveStockCsvRow(row, table, knownSkus)
          : resolveProductStockCsvRow(row, table, stocks);
        if (resolved) resolvedRows.push(resolved);
        else malformedRows++;
      }

      const sourceKeyCounts = new Map<string, number>();
      for (const row of resolvedRows) sourceKeyCounts.set(row.groupKey, (sourceKeyCounts.get(row.groupKey) ?? 0) + 1);
      const duplicateGroups = [...sourceKeyCounts.values()].filter((count) => count > 1).length;
      const duplicateRows = resolvedRows.filter((row) => (sourceKeyCounts.get(row.groupKey) ?? 0) > 1).length;
      let blankQuantities = 0, invalidQuantities = 0, unmatchedSkus = 0, unmatchedProducts = 0, ambiguousProducts = 0, updated = 0;

      for (const row of resolvedRows) {
        if ((sourceKeyCounts.get(row.groupKey) ?? 0) > 1) continue;
        if (row.quantity.status === "blank") { blankQuantities++; continue; }
        if (row.quantity.status !== "valid") { invalidQuantities++; continue; }
        if (row.ambiguous) { ambiguousProducts++; continue; }
        if (!row.sku) { if (row.kind === "product") unmatchedProducts++; else malformedRows++; continue; }
        const stock = bySku.get(row.sku.toUpperCase());
        if (!stock) { if (row.kind === "product") unmatchedProducts++; else unmatchedSkus++; continue; }
        const values = {
          variant_id: stock.variant_id,
          on_hand: row.quantity.quantity,
          marketplace_qty: marketplace ? row.quantity.quantity : stock.marketplace_qty,
        };
        const { error } = await supabase.from("inventory").upsert(values, { onConflict: "variant_id" });
        if (error) throw error;
        updated++;
      }

      let syncError = "";
      if (marketplace) {
        const recordsSkipped = malformedRows + duplicateRows + blankQuantities + invalidQuantities + unmatchedSkus + unmatchedProducts + ambiguousProducts;
        const { error } = await supabase.from("marketplace_sync_runs").insert({
          source_name: file.name, records_seen: dataRows.length, records_updated: updated, records_skipped: recordsSkipped,
        });
        if (error) syncError = error.message;
        else setLastSync(new Date().toLocaleString());
      }

      const summary = [updated + " SKU" + (updated === 1 ? "" : "s") + " updated"];
      if (duplicateGroups) summary.push(duplicateGroups + " duplicate item groups (" + duplicateRows + " rows) skipped");
      if (blankQuantities) summary.push(blankQuantities + " blank quantities skipped");
      if (invalidQuantities) summary.push(invalidQuantities + " invalid quantities skipped");
      if (unmatchedSkus) summary.push(unmatchedSkus + " unmatched SKUs skipped");
      if (unmatchedProducts) summary.push(unmatchedProducts + " unmatched products skipped");
      if (ambiguousProducts) summary.push(ambiguousProducts + " products matched multiple variants and were skipped");
      if (malformedRows) summary.push(malformedRows + " unreadable rows skipped");
      const unmatchedCatalogSkus = resolvedRows.filter((row) =>
        row.kind === "sku" && row.quantity.status === "valid" && row.sku !== null
          && !bySku.has(row.sku.toUpperCase()) && catalogSkus.has(row.sku.toUpperCase()),
      ).length;
      if (unmatchedCatalogSkus > 0 && unmatchedCatalogSkus === unmatchedSkus) {
        summary.push(stocks.length
          ? "The accessory SKUs are in the local catalog but not the connected database. Apply supabase/migrations/202610290001_replace_catalog_skus.sql, then refresh."
          : "The connected database has no live variants. Import the storefront catalog, then retry.");
      }
      setMessage(summary.join(" · ") + (syncError ? " · Sync history could not be saved: " + syncError : ""));
      void loadData();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not read this CSV."); }
    setBusy(false);
  };
  const uploadImage = async (event: ChangeEvent<HTMLInputElement>, product: ProductSummary) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file || !supabase) return;
    setBusy(true); setMessage("");
    const path = `${product.slug}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    const { error: uploadError } = await supabase.storage.from("product-images").upload(path, file, { upsert: true, contentType: file.type });
    if (uploadError) setMessage(uploadError.message);
    else {
      const { data } = supabase.storage.from("product-images").getPublicUrl(path);
      const { error } = await supabase.from("products").update({ image_url: data.publicUrl }).eq("id", product.id);
      setMessage(error ? error.message : `${product.name} photo uploaded.`);
    }
    setBusy(false);
  };

  const markFulfilled = async (order: OrderRow) => {
    if (!supabase) return;
    const { error } = await supabase.from("orders").update({ status: "fulfilled" }).eq("id", order.id);
    setMessage(error?.message ?? "Order marked fulfilled."); if (!error) void loadData();
  };

  if (!supabase) return <div className="admin-shell"><a className="admin-back" href="#/"><ArrowLeft /> Storefront</a><div className="admin-setup"><span className="admin-symbol"><Store /></span><span className="admin-eyebrow">MOBILE JOE · STORE ADMIN</span><h1>Admin is ready<br />for its keys.</h1><p>Add your Supabase project URL and anon key to <code>.env.local</code> to turn on secure sign-in, live inventory, order management and product photos.</p><div className="admin-setup-steps"><div><b>01</b><span>Create the database with the included Supabase migration.</span></div><div><b>02</b><span>Add your project URL and public anon key.</span></div><div><b>03</b><span>Promote your staff account in <code>admin_users</code>.</span></div></div><a className="button button--dark" href="#/">Back to the storefront <ArrowLeft size={16} /></a></div></div>;

  if (!userId || !isAdmin) return <div className="admin-shell"><a className="admin-back" href="#/"><ArrowLeft /> Storefront</a><div className="admin-login"><span className="admin-symbol"><ShieldCheck /></span><span className="admin-eyebrow">MOBILE JOE · STORE ADMIN</span><h1>Good to see you.</h1><p>Sign in with your approved store account.</p><form onSubmit={signIn}><label>Email address<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="joe@mobilejoe.ca" /></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className="button button--dark" disabled={busy}>{busy ? "Signing in…" : "Sign in to admin"}<ArrowLeft className="admin-arrow" size={16} /></button></form>{message && <p className="admin-message">{message}</p>}<small>Store staff only · Protected by Supabase Auth</small></div></div>;

  const totalUnits = stocks.reduce((total, stock) => total + Math.max(0, stock.on_hand - stock.reserved), 0);
  const lowStock = stocks.filter((stock) => stock.on_hand - stock.reserved <= 5).length;
  const pendingOrders = orders.filter((order) => order.status === "paid").length;
  const signOut = async () => { if (!supabase) return; await supabase.auth.signOut(); setUserId(null); setIsAdmin(false); };
  const tabs: [Tab, string, typeof Store][] = [["overview", "Overview", Store], ["inventory", "Inventory", Boxes], ["orders", "Orders", ShoppingBag], ["sync", "Marketplace sync", RefreshCw]];

  return <div className="admin-console"><header className="admin-topbar"><a className="wordmark" href="#/"><span className="wordmark__mark">mj.</span><span className="wordmark__name">MOBILE JOE<small>STORE ADMIN</small></span></a><div className="admin-top-actions"><span><span className="online-dot" />Store connected</span><button onClick={signOut}><LogOut size={15} /> Sign out</button></div></header><div className="admin-layout"><aside className="admin-sidebar"><div className="admin-welcome"><span className="admin-eyebrow">YOUR WORKSPACE</span><strong>Let’s get it done.</strong><small>{email || "Store team"}</small></div><nav>{tabs.map(([id, label, Icon]) => <button className={tab === id ? "current" : ""} onClick={() => setTab(id)} key={id}><Icon size={17} />{label}{id === "orders" && pendingOrders > 0 && <b>{pendingOrders}</b>}</button>)}</nav><div className="sidebar-footer"><ShieldCheck size={16} /><span>Secure admin session<br /><small>Only approved team members</small></span></div></aside><main className="admin-main"><div className="admin-page-title"><div><span className="admin-eyebrow">MOBILE JOE · OPERATIONS</span><h1>{tab === "overview" ? "Welcome to Mobile Joe." : tabs.find(([id]) => id === tab)?.[1]}</h1><p>{tab === "overview" ? "A quick look at how your store’s doing." : tab === "inventory" ? "Keep online stock accurate and up to date." : tab === "orders" ? "Recent orders and where they’re at." : "Keep your store stock lined up with marketplace listings."}</p></div><button className="admin-refresh" onClick={() => void loadData()}><RefreshCw size={15} /> Refresh</button></div>
      {message && <div className="admin-alert"><CircleAlert size={16} />{message}<button onClick={() => setMessage("")}>Dismiss</button></div>}
      {tab === "overview" && <><div className="admin-stat-grid"><Stat icon={<Boxes />} label="Sellable units" value={String(totalUnits)} detail="On hand, less reserved" /><Stat icon={<CircleAlert />} label="Low stock SKUs" value={String(lowStock)} detail="5 units or fewer" /><Stat icon={<ShoppingBag />} label="Paid to fulfill" value={String(pendingOrders)} detail="Awaiting dispatch" /><Stat icon={<RefreshCw />} label="Last stock sync" value={lastSync || "Not synced"} detail="Upload a marketplace CSV" /></div><div className="admin-work-grid"><div className="admin-panel"><div className="panel-title"><div><h2>What needs a look</h2><p>Little things to keep the store humming.</p></div></div><a className="admin-task" href="#/admin" onClick={(event) => { event.preventDefault(); setTab("orders"); }}><span className="task-icon task-icon--yellow"><PackageCheck /></span><span><b>{pendingOrders} paid {pendingOrders === 1 ? "order" : "orders"} to fulfill</b><small>Check order details and update their status.</small></span><ArrowLeft className="task-arrow" /></a><a className="admin-task" href="#/admin" onClick={(event) => { event.preventDefault(); setTab("sync"); }}><span className="task-icon"><RefreshCw /></span><span><b>Sync marketplace stock</b><small>Import a CSV export to update available quantities.</small></span><ArrowLeft className="task-arrow" /></a><a className="admin-task" href="#/admin" onClick={(event) => { event.preventDefault(); setTab("inventory"); }}><span className="task-icon"><ImagePlus /></span><span><b>Add product photos</b><small>Give customers a closer look at your products.</small></span><ArrowLeft className="task-arrow" /></a></div><div className="admin-panel"><div className="panel-title"><div><h2>Recent orders</h2><p>Your latest customer checkouts.</p></div><button className="panel-link" onClick={() => setTab("orders")}>View all <ArrowLeft size={14} /></button></div>{orders.slice(0, 4).length ? orders.slice(0, 4).map((order) => <OrderMini order={order} key={order.id} />) : <div className="admin-empty"><ShoppingBag /><p>Orders will show up here after your first checkout.</p></div>}</div></div><div className="admin-panel admin-catalog-panel"><div className="panel-title"><div><h2>Your products</h2><p>{variants.length} variants across the storefront.</p></div><button className="admin-secondary" onClick={() => void importCatalog()} disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Upload size={15} />} Import storefront catalog</button></div>{!variants.length && <div className="catalog-empty"><Store /><div><b>No live products in Supabase yet.</b><p>Import the local catalog, then add an inventory CSV to set accurate stock counts.</p></div></div>}</div></>}
      {tab === "inventory" && <div className="admin-panel"><div className="inventory-tools"><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search product or SKU" /><label className="admin-secondary upload-button"><Upload size={15} />Import stock CSV<input type="file" accept=".csv,text/csv" onChange={(event) => void uploadStockFile(event)} /></label><button className="admin-secondary" onClick={() => downloadCsv([["sku", "quantity"], ...stocks.map((stock) => [stock.sku, String(stock.on_hand)])], "mobile-joe-inventory.csv")}><ArrowDownToLine size={15} /> Export stock</button></div><small className="sync-footnote">CSV supports SKU + Quantity/On-hand rows and Model + Color + Quantity rows. Condition or Storage can disambiguate variants; duplicate, blank, unmatched, and ambiguous rows are skipped.</small><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Product / SKU</th><th>Price</th><th>Available now</th><th>Reserved</th><th>Set on-hand</th><th>Photo</th></tr></thead><tbody>{visibleStocks.map((stock) => { const variant = variants.find((item) => item.id === stock.variant_id)!; const productRow = flatten(variant.product); return <tr key={stock.variant_id}><td><b>{stock.name}</b><small>{stock.sku}{Object.values(variant.attributes ?? {}).length ? ` · ${Object.values(variant.attributes).join(" / ")}` : ""}</small></td><td>{money(Number(variant.price_cad))}</td><td><span className={stock.on_hand - stock.reserved > 0 ? "stock stock--in" : "stock"}><i />{Math.max(0, stock.on_hand - stock.reserved)}</span></td><td>{stock.reserved}</td><td><input className="stock-input" type="number" min="0" defaultValue={stock.on_hand} key={`${stock.variant_id}-${stock.on_hand}`} onBlur={(event) => { const value = Number(event.target.value); if (value !== stock.on_hand) void updateStock(stock, value); }} /></td><td>{productRow?.id ? <label className="photo-upload" title={`Add photo to ${stock.name}`}><ImagePlus size={16} /><input type="file" accept="image/*" onChange={(event) => productRow && void uploadImage(event, productRow as ProductSummary)} /></label> : "—"}</td></tr>; })}</tbody></table>{!visibleStocks.length && <div className="admin-empty"><Boxes /><p>Import the storefront catalog to start managing inventory.</p></div>}</div></div>}
      {tab === "orders" && <div className="admin-panel"><div className="panel-title"><div><h2>Recent orders</h2><p>Stripe checkout orders · newest first</p></div><span className="order-count">{orders.length} shown</span></div>{orders.length ? <div className="orders-list">{orders.map((order) => <div className="order-card" key={order.id}><div className="order-card__head"><div><b>#{order.id.slice(0, 8).toUpperCase()}</b><small>{new Date(order.created_at).toLocaleString()} · {order.email}</small></div><span className={`order-status status--${order.status}`}>{order.status}</span></div><div className="order-lines">{order.order_items?.map((item) => <div key={item.sku}><span>{item.quantity} × {item.product_name}<small>{item.sku}</small></span><b>{money(item.unit_price_cents * item.quantity / 100)}</b></div>)}</div><div className="order-card__foot"><span>Total <b>{money(order.total_cents / 100)}</b></span>{order.status === "paid" && <button className="admin-secondary" onClick={() => void markFulfilled(order)}><Check size={15} /> Mark fulfilled</button>}</div></div>)}</div> : <div className="admin-empty"><ShoppingBag /><p>New orders will appear after the first Stripe checkout.</p></div>}</div>}
      {tab === "sync" && <><div className="sync-banner"><span className="sync-banner-icon"><RefreshCw /></span><div><b>Stock in step, wherever it sells.</b><p>Import a marketplace CSV by SKU or by model, color, and condition. Matched on-hand counts update your store; unmatched or ambiguous rows stay unchanged.</p></div></div><div className="sync-cards"><div className="sync-card"><span className="admin-eyebrow">01 · GET YOUR STORE STOCK</span><h2>Export online inventory.</h2><p>Download the current sellable quantities in a marketplace-friendly <code>sku,quantity</code> CSV.</p><button className="admin-secondary" onClick={() => downloadCsv([["sku", "quantity"], ...stocks.map((stock) => [stock.sku, String(Math.max(0, stock.on_hand - stock.reserved))])], "mobile-joe-marketplace-stock.csv")}><ArrowDownToLine size={15} /> Download stock CSV</button></div><div className="sync-card sync-card--yellow"><span className="admin-eyebrow">02 · UPDATE FROM A MARKETPLACE</span><h2>Import a stock snapshot.</h2><p>Upload SKU and quantity rows, or product model, color, quantity, and optional condition/storage columns. Extra columns are ignored; unmatched and ambiguous items are skipped.</p><label className="admin-secondary upload-button"><ArrowUpFromLine size={15} />Choose marketplace CSV<input type="file" accept=".csv,text/csv" onChange={(event) => void uploadStockFile(event, true)} /></label></div></div><div className="admin-panel sync-preview"><div className="panel-title"><div><h2>Marketplace comparison</h2><p>Sellable store quantity compared with your most recent imported marketplace quantities.</p></div></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>SKU</th><th>Store sellable</th><th>Marketplace snapshot</th><th>Difference</th></tr></thead><tbody>{stocks.filter((stock) => stock.marketplace_qty !== null).map((stock) => <tr key={stock.variant_id}><td><b>{stock.sku}</b><small>{stock.name}</small></td><td>{stock.on_hand}</td><td>{stock.marketplace_qty}</td><td><span className={Math.max(0, stock.on_hand - stock.reserved) === stock.marketplace_qty ? "sync-match" : "sync-difference"}>{Math.max(0, stock.on_hand - stock.reserved) === stock.marketplace_qty ? "In sync" : `${Math.max(0, stock.on_hand - stock.reserved) - (stock.marketplace_qty ?? 0) > 0 ? "+" : ""}${Math.max(0, stock.on_hand - stock.reserved) - (stock.marketplace_qty ?? 0)}`}</span></td></tr>)}</tbody></table>{!stocks.some((stock) => stock.marketplace_qty !== null) && <div className="admin-empty"><RefreshCw /><p>Import a marketplace file to see the comparison.</p></div>}</div><small className="sync-footnote"><Clock3 size={13} />{lastSync ? `Last imported ${lastSync}` : "No marketplace snapshots imported yet."} · Direct marketplace API connections need provider credentials.</small></div></>}
      </main></div></div>;
}

type ProductSummary = { id: string; slug: string; name: string };
function Stat({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) { return <div className="admin-stat"><div className="admin-stat__top">{icon}<span>{label}</span></div><strong>{value}</strong><small>{detail}</small></div>; }
function OrderMini({ order }: { order: OrderRow }) { return <div className="order-mini"><span className="order-mini-icon"><PackageCheck /></span><span><b>#{order.id.slice(0, 8).toUpperCase()} · {order.email}</b><small>{new Date(order.created_at).toLocaleDateString()} · {order.status}</small></span><strong>{money(order.total_cents / 100)}</strong></div>; }
