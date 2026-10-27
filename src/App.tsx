import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, Check, ChevronDown, ChevronRight,
  CircleHelp, CreditCard, Headphones, Heart, Menu, Minus, PackageCheck, Plus, Search,
  ShieldCheck, ShoppingBag, ShoppingCart, Sparkles, Truck, X, Zap,
} from "lucide-react";
import { Admin } from "./components/Admin";
import { categoryLabels, loadCatalog, localCatalogProducts, money, type Product, type Variant } from "./lib/catalog";
import { hasBackend, supabase } from "./lib/supabase";

type CartLine = { sku: string; quantity: number };
const categoryList = Object.entries(categoryLabels).filter(([slug]) => slug !== "all");
const checkoutEnabled = import.meta.env.VITE_CHECKOUT_ENABLED === "true";
const readCart = (): CartLine[] => {
  try { return JSON.parse(localStorage.getItem("mj-cart") || "[]") as CartLine[]; } catch { return []; }
};
const pathNow = () => window.location.hash.slice(1) || "/";
const go = (path: string) => { window.location.hash = path; };
const productPrice = (product: Product) => Math.min(...product.variants.map((variant) => variant.price));
const variantName = (variant: Variant) => Object.values(variant.attributes).join(" · ") || "Standard";

function ProductArt({ product, small = false }: { product: Product; small?: boolean }) {
  const image = product.image;
  const Icon = product.category === "earphones" ? Headphones : product.category === "cables" ? Zap : ShoppingBag;
  return (
    <div className={`product-art ${small ? "product-art--small" : ""}`}>
      {image ? <img src={image} alt={product.name} /> : <>
        <div className={`art-shape art-shape--${product.category}`}><Icon strokeWidth={1.3} /></div>
        <span className="art-brand">{product.brand}</span>
      </>}
      <span className="art-glow" />
    </div>
  );
}

function ProductCard({ product, onAdd }: { product: Product; onAdd: (product: Product) => void }) {
  const inStock = product.variants.some((variant) => variant.available);
  return (
    <article className="product-card" onClick={() => go(`/product/${product.slug}`)}>
      <button className="product-card__image" aria-label={`View ${product.name}`}>
        <ProductArt product={product} />
        {product.featured && <span className="flag flag--dark">Joe’s pick</span>}
        <span className="image-arrow"><ArrowUpRight size={19} /></span>
      </button>
      <div className="product-card__content">
        <div className="product-card__meta"><span>{product.brand}</span><span className={inStock ? "stock stock--in" : "stock"}><i />{inStock ? "In stock" : "Sold out"}</span></div>
        <button className="product-card__title" onClick={() => go(`/product/${product.slug}`)}>{product.name}</button>
        <div className="product-card__bottom"><div><strong>{money(productPrice(product))}</strong>{product.variants.length > 1 && <small> from</small>}</div>
          <button className="quick-add" aria-label={`Add ${product.name} to bag`} disabled={!inStock} onClick={(event) => { event.stopPropagation(); onAdd(product); }}><Plus size={17} /></button>
        </div>
      </div>
    </article>
  );
}

function App() {
  const [catalog, setCatalog] = useState<Product[]>(localCatalogProducts);
  const [route, setRoute] = useState(pathNow);
  const [cart, setCart] = useState<CartLine[]>(readCart);
  const [cartOpen, setCartOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("featured");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [notice, setNotice] = useState("");
  const [checkoutEmail, setCheckoutEmail] = useState("");
  const [checkingOut, setCheckingOut] = useState(false);

  useEffect(() => {
    const updateRoute = () => { setRoute(pathNow()); setMobileMenu(false); window.scrollTo({ top: 0, behavior: "smooth" }); };
    window.addEventListener("hashchange", updateRoute);
    void loadCatalog().then(setCatalog);
    if (window.location.hash.includes("/checkout/success")) {
      setNotice("Payment received. We’re getting your order ready.");
      setCart([]);
    }
    return () => window.removeEventListener("hashchange", updateRoute);
  }, []);

  useEffect(() => { localStorage.setItem("mj-cart", JSON.stringify(cart)); }, [cart]);

  const cartItems = useMemo(() => cart.flatMap((line) => {
    const product = catalog.find((entry) => entry.variants.some((variant) => variant.sku === line.sku));
    const variant = product?.variants.find((entry) => entry.sku === line.sku);
    return product && variant ? [{ product, variant, quantity: line.quantity }] : [];
  }), [cart, catalog]);
  const cartCount = cart.reduce((count, item) => count + item.quantity, 0);
  const subtotal = cartItems.reduce((total, item) => total + item.variant.price * item.quantity, 0);
  const parsedRoute = route.split("?")[0];
  const productSlug = parsedRoute.startsWith("/product/") ? decodeURIComponent(parsedRoute.slice("/product/".length)) : "";
  const product = catalog.find((entry) => entry.slug === productSlug);
  const shopCategory = parsedRoute.startsWith("/shop/") ? parsedRoute.slice("/shop/".length) : "all";
  const queryFromRoute = new URLSearchParams(route.split("?")[1] || "").get("q") || "";
  const shopProducts = useMemo(() => {
    const normalized = queryFromRoute.toLowerCase();
    const result = catalog.filter((item) => (shopCategory === "all" || item.category === shopCategory)
      && (!normalized || `${item.name} ${item.brand} ${item.category} ${item.description}`.toLowerCase().includes(normalized)));
    return result.sort((a, b) => sort === "price-low" ? productPrice(a) - productPrice(b)
      : sort === "price-high" ? productPrice(b) - productPrice(a)
        : sort === "az" ? a.name.localeCompare(b.name) : Number(b.featured) - Number(a.featured));
  }, [catalog, queryFromRoute, shopCategory, sort]);

  const addToCart = (item: Product, variant = item.variants.find((entry) => entry.available) ?? item.variants[0]) => {
    if (!variant?.available) return;
    setCart((current) => {
      const line = current.find((entry) => entry.sku === variant.sku);
      return line ? current.map((entry) => entry.sku === variant.sku ? { ...entry, quantity: Math.min(20, entry.quantity + 1) } : entry)
        : [...current, { sku: variant.sku, quantity: 1 }];
    });
    setNotice(`${item.name} added to your bag`);
    window.setTimeout(() => setNotice(""), 2600);
  };
  const setQuantity = (sku: string, quantity: number) => setCart((current) => quantity < 1 ? current.filter((item) => item.sku !== sku)
    : current.map((item) => item.sku === sku ? { ...item, quantity: Math.min(20, quantity) } : item));
  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const term = search.trim();
    go(`/shop/all${term ? `?q=${encodeURIComponent(term)}` : ""}`);
  };
  const startCheckout = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !checkoutEnabled || !cartItems.length) { setNotice("Online checkout isn’t live yet. Email Joe if you need a hand."); return; }
    setCheckingOut(true);
    setNotice("");
    const { data, error } = await supabase.functions.invoke("create-checkout-session", {
      body: { email: checkoutEmail, items: cartItems.map((item) => ({ sku: item.variant.sku, quantity: item.quantity })) },
    });
    setCheckingOut(false);
    if (error || !data?.url) { setNotice(error?.message || data?.error || "Checkout could not start. Please try again."); return; }
    window.location.assign(data.url as string);
  };

  const title = product ? product.name : parsedRoute.startsWith("/shop") ? `${categoryLabels[shopCategory] ?? "Shop"} | Mobile Joe` : "Mobile Joe — Phone stuff, sorted.";
  useEffect(() => { document.title = title; }, [title]);

  if (parsedRoute === "/admin" || parsedRoute.startsWith("/admin/")) return <Admin />;

  return (
    <div className={`app-shell ${checkoutEnabled && hasBackend ? "checkout-ready" : ""}`}>
      <div className="announcement"><span>Good gear, fair prices, Canada wide.</span><a href="#/about">Meet your phone guy <ArrowRight size={13} /></a></div>
      <header className="site-header">
        <button className="mobile-menu-button icon-button" aria-label="Open menu" onClick={() => setMobileMenu(!mobileMenu)}>{mobileMenu ? <X /> : <Menu />}</button>
        <a href="#/" className="wordmark" aria-label="Mobile Joe home"><span className="wordmark__mark">mj.</span><span className="wordmark__name">MOBILE JOE<small>YOUR PHONE GUY, ONLINE.</small></span></a>
        <nav className={`main-nav ${mobileMenu ? "main-nav--open" : ""}`} aria-label="Main navigation">
          <a href="#/shop/all" className={parsedRoute.startsWith("/shop") ? "active" : ""}>Shop all</a>
          <div className="nav-categories"><button onClick={() => setMobileMenu(!mobileMenu)}>Accessories <ChevronDown size={14} /></button><div className="category-popover">{categoryList.map(([slug, label]) => <a href={`#/shop/${slug}`} key={slug}>{label}<ChevronRight size={14} /></a>)}</div></div>
          <a href="#/about" className={parsedRoute === "/about" ? "active" : ""}>About Joe</a>
        </nav>
        <form className="header-search" onSubmit={submitSearch}><Search size={17} /><input aria-label="Search products" placeholder="Looking for something?" value={search} onChange={(event) => setSearch(event.target.value)} /><kbd>↵</kbd></form>
        <div className="header-actions"><a href="#/about" className="icon-button header-help" aria-label="About Mobile Joe"><CircleHelp size={20} /></a><button className="bag-button" onClick={() => setCartOpen(true)} aria-label={`Open shopping bag, ${cartCount} items`}><ShoppingCart size={19} /><span>Bag</span><b>{cartCount}</b></button></div>
      </header>

      {notice && !cartOpen && <div className={`toast ${notice.startsWith("Payment") ? "toast--success" : ""}`} role="status"><Check size={16} />{notice}<button aria-label="Dismiss" onClick={() => setNotice("")}><X size={15} /></button></div>}

      <main>
        {parsedRoute === "/" && <>
          <section className="hero wrap">
            <div className="hero-copy"><span className="eyebrow"><Sparkles size={14} /> THE LITTLE THINGS, DONE RIGHT</span><h1>Phone stuff,<br /><span>sorted.</span></h1><p>Chargers that charge. Cables that last. The everyday extras, at prices that make sense.</p><div className="hero-actions"><a className="button button--dark" href="#/shop/all">Shop accessories <ArrowRight size={17} /></a><a href="#/about" className="text-link">A little about Joe <ArrowUpRight size={16} /></a></div><div className="hero-proof"><div className="proof-avatars"><span>J</span><span>M</span><span>+</span></div><div><strong>Real people, real help</strong><small>Here when you need us.</small></div></div></div>
            <div className="hero-art"><div className="hero-sun" /><div className="hero-sticker">GOOD<br />GEAR<br /><b>〰</b></div><div className="hero-device"><div className="device-camera" /><div className="device-ring"><span /></div><div className="device-label">MAGSAFE READY</div></div><div className="hero-note"><span className="note-dot" /> THE EVERYDAY<br />UPGRADE <ArrowDownRight size={17} /></div><span className="hero-spark hero-spark--one">✳</span><span className="hero-spark hero-spark--two">✳</span></div>
            <div className="hero-vertical">MOBILE JOE · EST. 2021</div>
          </section>

          <section className="benefit-strip"><div className="wrap benefit-grid"><div><Truck /><span><b>Canada wide shipping</b><small>Right to your door</small></span></div><div><CreditCard /><span><b>Prices in CAD</b><small>No surprise currency math</small></span></div><div><Headphones /><span><b>Human help</b><small>From a real phone guy</small></span></div><div><ShieldCheck /><span><b>Shop with confidence</b><small>Easy, straight answers</small></span></div></div></section>

          <section className="section wrap category-section"><div className="section-heading"><div><span className="eyebrow">FIND YOUR FIX</span><h2>Small things.<br className="mobile-break" /> Big difference.</h2></div><a href="#/shop/all" className="text-link">Browse everything <ArrowRight size={16} /></a></div><div className="category-grid">{categoryList.map(([slug, label], index) => <a className={`category-card category-card--${index}`} href={`#/shop/${slug}`} key={slug}><span className="category-number">0{index + 1}</span><span className="category-name">{label}</span><span className="category-arrow"><ArrowUpRight size={19} /></span><div className="category-icon">{index === 0 ? <CreditCard /> : index === 1 ? <Zap /> : index === 2 ? <Headphones /> : <Sparkles />}</div></a>)}</div></section>

          <section className="section featured-section"><div className="wrap"><div className="section-heading"><div><span className="eyebrow">JOE’S PICKS</span><h2>Good ones, right here.</h2></div><a href="#/shop/all" className="text-link">All the good stuff <ArrowRight size={16} /></a></div><div className="product-grid">{catalog.filter((item) => item.featured).slice(0, 4).map((item) => <ProductCard key={item.slug} product={item} onAdd={addToCart} />)}</div></div></section>

          <section className="joe-banner wrap"><div className="joe-banner__stamp">A NOTE<br />FROM JOE</div><div><span className="eyebrow">NO GIMMICKS. JUST GOOD GEAR.</span><h2>Buying phone stuff<br />should feel easy.</h2><p>That’s the whole idea. Fair prices, useful products, and a real person if you need a hand.</p><a href="#/about" className="button button--yellow">Get to know us <ArrowRight size={16} /></a></div><div className="joe-banner__scribble">nice<br /><span>& simple</span><Heart size={19} /></div></section>
          <Newsletter />
        </>}

        {parsedRoute.startsWith("/shop/") && <section className="shop-page wrap"><div className="breadcrumbs"><a href="#/">Home</a><ChevronRight size={14} /><span>{categoryLabels[shopCategory] ?? "Shop"}</span></div><div className="shop-heading"><div><span className="eyebrow">THE MOBILE JOE STORE</span><h1>{queryFromRoute ? `Looking for “${queryFromRoute}”` : categoryLabels[shopCategory] ?? "Shop"}</h1><p>Everyday essentials, picked by a phone guy.</p></div><label className="sort-select">Sort by <select value={sort} onChange={(event) => setSort(event.target.value)}><option value="featured">Joe’s picks</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="az">Name: A to Z</option></select></label></div><div className="shop-tabs"><a href="#/shop/all" className={shopCategory === "all" ? "selected" : ""}>Everything <span>{catalog.length}</span></a>{categoryList.map(([slug, label]) => <a href={`#/shop/${slug}`} className={shopCategory === slug ? "selected" : ""} key={slug}>{label}</a>)}</div>{shopProducts.length ? <div className="product-grid">{shopProducts.map((item) => <ProductCard key={item.slug} product={item} onAdd={addToCart} />)}</div> : <div className="empty-state"><Search size={27} /><h2>No matches just yet.</h2><p>Try a different search or browse all the accessories.</p><a className="button button--dark" href="#/shop/all">See everything</a></div>}</section>}

        {parsedRoute.startsWith("/product/") && (product ? <ProductDetail key={product.slug} product={product} addToCart={addToCart} /> : <div className="empty-state wrap"><PackageCheck size={30} /><h2>That item has moved.</h2><a href="#/shop/all" className="button button--dark">Back to the shop</a></div>)}

        {parsedRoute === "/about" && <About />}
        {parsedRoute === "/checkout/success" && <section className="empty-state wrap success-page"><span className="success-icon"><Check /></span><span className="eyebrow">THANKS FOR SHOPPING WITH JOE</span><h1>Order received.</h1><p>Your payment is in, and we’re getting your order ready. A confirmation email is on its way.</p><a href="#/shop/all" className="button button--dark">Keep browsing <ArrowRight size={16} /></a></section>}
      </main>

      <Footer />
      {cartOpen && <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCartOpen(false); }}><aside className="cart-drawer" role="dialog" aria-modal="true" aria-label="Your shopping bag"><div className="drawer-heading"><div><span className="eyebrow">YOUR GOOD STUFF</span><h2>Your bag <span>{cartCount}</span></h2></div><button className="icon-button" onClick={() => setCartOpen(false)} aria-label="Close bag"><X /></button></div>{cartItems.length ? <><div className="drawer-items">{cartItems.map(({ product: item, variant, quantity }) => <div className="cart-line" key={variant.sku}><div className="cart-thumb"><ProductArt product={item} small /></div><div className="cart-line__info"><a href={`#/product/${item.slug}`} onClick={() => setCartOpen(false)}>{item.name}</a><small>{variantName(variant)}</small><b>{money(variant.price)}</b><div className="quantity"><button aria-label="Decrease quantity" onClick={() => setQuantity(variant.sku, quantity - 1)}><Minus size={14} /></button><span>{quantity}</span><button aria-label="Increase quantity" onClick={() => setQuantity(variant.sku, quantity + 1)}><Plus size={14} /></button></div></div><button className="remove-item" aria-label={`Remove ${item.name}`} onClick={() => setQuantity(variant.sku, 0)}><X size={16} /></button></div>)}</div><div className="drawer-bottom"><div className="shipping-progress"><Truck size={16} /><span>Shipping and taxes are calculated at checkout.</span></div><div className="subtotal"><span>Subtotal</span><strong>{money(subtotal)}</strong></div><form onSubmit={startCheckout} className="checkout-form"><label htmlFor="checkout-email">Email for your order updates</label><input id="checkout-email" type="email" required placeholder="you@example.com" value={checkoutEmail} onChange={(event) => setCheckoutEmail(event.target.value)} /><button className="button button--yellow" disabled={checkingOut}>{checkingOut ? "Getting checkout ready…" : "Continue to secure checkout"}<ArrowRight size={17} /></button>{notice && <p className="checkout-message" role="status">{notice}</p>}</form><p className="secure-note"><ShieldCheck size={15} /> Secure checkout powered by Stripe</p></div></> : <div className="cart-empty"><div className="empty-bag"><ShoppingBag /></div><h3>Your bag’s taking a nap.</h3><p>Let’s find it something useful.</p><button className="button button--dark" onClick={() => { setCartOpen(false); go("/shop/all"); }}>Go shopping <ArrowRight size={16} /></button></div>}</aside></div>}

      {!hasBackend && <div className="dev-badge" title="Connect Supabase and Stripe environment keys for checkout and admin features.">Preview store <span>·</span> payments not connected</div>}
    </div>
  );
}

function ProductDetail({ product, addToCart }: { product: Product; addToCart: (product: Product, variant?: Variant) => void }) {
  const [selected, setSelected] = useState(product.variants[0]);
  return <section className="product-page wrap"><div className="breadcrumbs"><a href="#/">Home</a><ChevronRight size={14} /><a href={`#/shop/${product.category}`}>{categoryLabels[product.category] ?? "Shop"}</a><ChevronRight size={14} /><span>{product.name}</span></div><div className="product-detail"><div className="product-detail__visual"><ProductArt product={product} /><span className="product-detail__caption">GOOD GEAR, PICKED BY JOE.</span></div><div className="product-detail__info"><span className="eyebrow">{product.brand} · {categoryLabels[product.category]}</span><h1>{product.name}</h1><p className="detail-price">{money(selected?.price ?? productPrice(product))}</p><p className="detail-description">{product.description}</p>{product.variants.length > 1 && <fieldset className="variant-picker"><legend>Choose your option</legend><div>{product.variants.map((variant) => <button className={selected.sku === variant.sku ? "variant-option selected" : "variant-option"} key={variant.sku} disabled={!variant.available} onClick={() => setSelected(variant)}><span>{variantName(variant)}</span>{selected.sku === variant.sku && <Check size={15} />}</button>)}</div></fieldset>}<div className="detail-availability"><span className={selected?.available ? "stock stock--in" : "stock"}><i />{selected?.available ? "In stock and ready to go" : "Currently sold out"}</span><span>SKU: {selected?.sku}</span></div><button className="button button--dark detail-add" disabled={!selected?.available} onClick={() => addToCart(product, selected)}>{selected?.available ? "Add to bag" : "Sold out"}<ShoppingBag size={17} /></button><div className="detail-promises"><div><Truck /><span><b>Ships across Canada</b><small>Delivery options at checkout</small></span></div><div><ShieldCheck /><span><b>Need a hand?</b><small>Joe’s here to help</small></span></div></div></div></div>{product.specs.length > 0 && <div className="specs"><div><span className="eyebrow">THE DETAILS</span><h2>Good to know.</h2></div><dl>{product.specs.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div>}<section className="related-products"><div className="section-heading"><div><span className="eyebrow">KEEP IT ROLLING</span><h2>More useful stuff.</h2></div><a href={`#/shop/${product.category}`} className="text-link">Shop this category <ArrowRight size={16} /></a></div><div className="product-grid">{localCatalogProducts.filter((item) => item.category === product.category && item.slug !== product.slug).slice(0, 4).map((item) => <ProductCard key={item.slug} product={item} onAdd={addToCart} />)}</div></section></section>;
}

function Newsletter() {
  return <section className="newsletter wrap"><div className="newsletter-icon"><Sparkles /></div><div><span className="eyebrow">A LITTLE NOTE FROM JOE</span><h2>Need a hand picking?</h2><p>Tell Joe what you’re looking for. He’s happy to help you find the right fit.</p></div><a className="button button--dark" href="mailto:hello@mobilejoe.ca?subject=Help%20me%20pick%20an%20accessory">Email Joe <ArrowRight size={16} /></a></section>;
}

function About() {
  return <><section className="about-hero wrap"><span className="eyebrow">HI, I’M JOE.</span><h1>Your phone guy.<br /><span>Now online.</span></h1><p>Phones and accessories can be confusing. Finding the right gear shouldn’t be. So I made a place where it’s easier to find what you need at a price that feels right.</p><a href="#/shop/all" className="button button--dark">Find your thing <ArrowRight size={16} /></a><div className="about-doodle">good<br /><span>to meet you</span><Heart /></div></section><section className="about-values"><div className="wrap"><div className="section-heading"><div><span className="eyebrow">THE SHORT VERSION</span><h2>Here’s what matters.</h2></div></div><div className="values-grid"><div><span>01</span><Truck /><h3>Fair, clear prices.</h3><p>Everyday essentials at a price that makes sense. All prices shown in Canadian dollars.</p></div><div><span>02</span><ShieldCheck /><h3>Good picks only.</h3><p>Useful gear for the devices you already own. No pressure and no mystery specs.</p></div><div><span>03</span><Headphones /><h3>A real person.</h3><p>Questions are welcome. You’re dealing with a small Canadian business, not a maze of menus.</p></div></div></div></section><Newsletter /></>;
}

function Footer() {
  return <footer className="site-footer"><div className="wrap footer-top"><a href="#/" className="wordmark"><span className="wordmark__mark">mj.</span><span className="wordmark__name">MOBILE JOE<small>YOUR PHONE GUY, ONLINE.</small></span></a><p>Good gear. Fair prices.<br />A real phone guy.</p><div className="footer-links"><div><b>THE SHOP</b><a href="#/shop/all">Shop everything</a><a href="#/shop/chargers">Chargers</a><a href="#/shop/cables">Cables</a><a href="#/shop/earphones">Earphones</a></div><div><b>HERE TO HELP</b><a href="#/about">About Joe</a><a href="mailto:hello@mobilejoe.ca">Email Joe</a><a href="#/about">Shipping & returns</a><a href="#/admin">Team sign in</a></div></div></div><div className="wrap footer-bottom"><span>© {new Date().getFullYear()} Mobile Joe. Made for Canada.</span><span>Prices in CAD <span className="footer-heart">♥</span> Canada-wide shipping</span></div></footer>;
}

export default App;
