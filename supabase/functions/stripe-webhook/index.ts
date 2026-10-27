import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function verifySignature(body: string, signature: string, secret: string) {
  const parts = Object.fromEntries(signature.split(",").map((part) => part.split("=", 2)));
  const timestamp = parts.t;
  const supplied = parts.v1;
  if (!timestamp || !supplied || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)));
  const expected = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (expected.length !== supplied.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const body = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";
  if (!secret || !supabaseUrl || !serviceKey) return new Response("Webhook is not configured", { status: 503 });
  if (!await verifySignature(body, signature, secret)) return new Response("Invalid Stripe signature", { status: 400 });

  try {
    const event = JSON.parse(body);
    const object = event.data?.object;
    const orderId = object?.metadata?.order_id;
    if (orderId && event.type === "checkout.session.completed" && object.payment_status === "paid") {
      const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      const { error } = await admin.rpc("complete_store_order", { p_order_id: orderId, p_paid_total_cents: object.amount_total });
      if (error) throw error;
    } else if (orderId && event.type === "checkout.session.async_payment_succeeded") {
      const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      const { error } = await admin.rpc("complete_store_order", { p_order_id: orderId, p_paid_total_cents: object.amount_total });
      if (error) throw error;
    } else if (orderId && ["checkout.session.expired", "checkout.session.async_payment_failed"].includes(event.type)) {
      const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      const { error } = await admin.rpc("release_store_order", { p_order_id: orderId, p_status: "expired" });
      if (error) throw error;
    }
    return Response.json({ received: true });
  } catch (_error) {
    return new Response("Webhook processing failed", { status: 500 });
  }
});
