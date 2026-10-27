import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405, headers: cors });

  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const siteUrl = (Deno.env.get("SITE_URL") ?? "http://localhost:5173").replace(/\/$/, "");
  if (!stripeSecret || !supabaseUrl || !serviceKey) {
    return Response.json({ error: "Secure checkout is not configured yet." }, { status: 503, headers: cors });
  }

  try {
    const { email, items } = await request.json();
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: reservation, error: reserveError } = await admin.rpc("reserve_store_order", {
      p_email: email,
      p_items: items,
    });
    if (reserveError) return Response.json({ error: reserveError.message }, { status: 400, headers: cors });

    const lineItems = (reservation.items as { name: string; quantity: number; unit_price_cents: number }[]);
    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("customer_email", email);
    form.set("billing_address_collection", "required");
    form.set("shipping_address_collection[allowed_countries][0]", "CA");
    form.set("automatic_tax[enabled]", "true");
    form.set("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
    form.set("shipping_options[0][shipping_rate_data][fixed_amount][amount]", "1000");
    form.set("shipping_options[0][shipping_rate_data][fixed_amount][currency]", "cad");
    form.set("shipping_options[0][shipping_rate_data][display_name]", "Standard shipping");
    form.set("shipping_options[0][shipping_rate_data][delivery_estimate][minimum][unit]", "business_day");
    form.set("shipping_options[0][shipping_rate_data][delivery_estimate][minimum][value]", "5");
    form.set("shipping_options[0][shipping_rate_data][delivery_estimate][maximum][unit]", "business_day");
    form.set("shipping_options[0][shipping_rate_data][delivery_estimate][maximum][value]", "8");
    form.set("shipping_options[1][shipping_rate_data][type]", "fixed_amount");
    form.set("shipping_options[1][shipping_rate_data][fixed_amount][amount]", "2500");
    form.set("shipping_options[1][shipping_rate_data][fixed_amount][currency]", "cad");
    form.set("shipping_options[1][shipping_rate_data][display_name]", "Express shipping");
    form.set("shipping_options[1][shipping_rate_data][delivery_estimate][minimum][unit]", "business_day");
    form.set("shipping_options[1][shipping_rate_data][delivery_estimate][minimum][value]", "2");
    form.set("shipping_options[1][shipping_rate_data][delivery_estimate][maximum][unit]", "business_day");
    form.set("shipping_options[1][shipping_rate_data][delivery_estimate][maximum][value]", "3");
    form.set("success_url", `${siteUrl}/#/checkout/success?session_id={CHECKOUT_SESSION_ID}`);
    form.set("cancel_url", `${siteUrl}/#/shop/all`);
    form.set("metadata[order_id]", reservation.order_id);
    form.set("expires_at", String(Math.floor(Date.now() / 1000) + 35 * 60));
    lineItems.forEach((item, index) => {
      form.set(`line_items[${index}][quantity]`, String(item.quantity));
      form.set(`line_items[${index}][price_data][currency]`, "cad");
      form.set(`line_items[${index}][price_data][unit_amount]`, String(item.unit_price_cents));
      form.set(`line_items[${index}][price_data][product_data][name]`, item.name);
    });

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${stripeSecret}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": reservation.order_id },
      body: form,
    });
    const session = await stripeResponse.json();
    if (!stripeResponse.ok || !session.url) {
      await admin.rpc("release_store_order", { p_order_id: reservation.order_id, p_status: "expired" });
      return Response.json({ error: session.error?.message ?? "Stripe could not start checkout." }, { status: 502, headers: cors });
    }

    const { error: saveError } = await admin.from("orders").update({ stripe_session_id: session.id }).eq("id", reservation.order_id);
    if (saveError) {
      await fetch(`https://api.stripe.com/v1/checkout/sessions/${session.id}/expire`, {
        method: "POST", headers: { Authorization: `Bearer ${stripeSecret}` },
      });
      await admin.rpc("release_store_order", { p_order_id: reservation.order_id, p_status: "expired" });
      return Response.json({ error: "Could not save this checkout. Please try again." }, { status: 502, headers: cors });
    }
    return Response.json({ url: session.url }, { headers: cors });
  } catch (_error) {
    return Response.json({ error: "Checkout could not start. Please try again." }, { status: 400, headers: cors });
  }
});
