import localCatalog from "../data/catalog.json";
import { supabase } from "./supabase";

export interface Variant {
  id?: string;
  sku: string;
  attributes: Record<string, string>;
  price: number;
  available: boolean;
  format?: string;
}

export interface Product {
  id?: string;
  slug: string;
  name: string;
  brand: string;
  category: string;
  description: string;
  specs: [string, string][];
  featured: boolean;
  image?: string | null;
  variants: Variant[];
}

type LocalVariant = { k: string; a: Record<string, string>; p: number; i: number; f?: string };
type LocalProduct = { s: string; n: string; b: string; c: string; d: string; sp: [string, string][]; ft: number; v: LocalVariant[] };

const fallback = localCatalog as LocalProduct[];

const localProductImages = import.meta.glob<string>("../../images/products/**/*.{jpg,jpeg,png,webp,avif}", {
  eager: true,
  query: "?url",
  import: "default",
});

function findLocalImage(variants: Pick<Variant, "sku">[]): string | undefined {
  for (const variant of variants) {
    const skuFolder = `/images/products/${variant.sku.toLowerCase()}/`;
    const match = Object.entries(localProductImages).find(([path]) =>
      path.toLowerCase().includes(skuFolder) && /\/1\.(jpg|jpeg|png|webp|avif)$/i.test(path),
    );
    if (match) return match[1];
  }
  return undefined;
}

function fromLocal(row: LocalProduct): Product {
  const variants = row.v.map((variant) => ({
    sku: variant.k,
    attributes: variant.a,
    price: Number(variant.p),
    available: variant.i === 1,
    format: variant.f,
  }));
  return {
    slug: row.s,
    name: row.n,
    brand: row.b,
    category: row.c,
    description: row.d,
    specs: row.sp,
    featured: row.ft === 1,
    image: findLocalImage(variants),
    variants,
  };
}

export async function loadCatalog(): Promise<Product[]> {
  if (supabase) {
    const { data, error } = await supabase
      .from("products")
      .select("id, slug, name, brand, category, description, specs, featured, image_url, product_variants(id, sku, attributes, price_cad, in_stock)")
      .eq("active", true)
      .order("name");

    if (!error && data?.length) {
      return data.map((row) => {
        const variants = (row.product_variants ?? []) as {
          id: string; sku: string; attributes: Record<string, string>; price_cad: number; in_stock: boolean;
        }[];
        return {
          id: row.id,
          slug: row.slug,
          name: row.name,
          brand: row.brand,
          category: row.category,
          description: row.description ?? "",
          specs: (row.specs ?? []) as [string, string][],
          featured: row.featured,
          image: row.image_url ?? findLocalImage(variants),
          variants: variants.map((variant) => ({
            id: variant.id, sku: variant.sku, attributes: variant.attributes ?? {},
            price: Number(variant.price_cad), available: variant.in_stock,
          })),
        };
      });
    }
  }
  return fallback.map(fromLocal);
}

export const localCatalogProducts = fallback.map(fromLocal);

export const categoryLabels: Record<string, string> = {
  all: "Everything",
  chargers: "Chargers",
  cables: "Cables",
  earphones: "Earphones",
  wireless: "Wireless charging",
  smartphones: "Smartphones",
};

export const money = (amount: number) => new Intl.NumberFormat("en-CA", {
  style: "currency", currency: "CAD", maximumFractionDigits: 2,
}).format(amount);
