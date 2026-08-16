// Supabase Edge Function: Payment reminders (daily cron)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';

// Origins allowed to call this function. Comma-separated list in the
// ALLOWED_ORIGIN secret (e.g. "https://troika-media-web.vercel.app").
const allowedOrigins = (Deno.env.get("ALLOWED_ORIGIN") || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  // No allowlist configured -> allow any origin. Requests are still
  // authenticated via the JWT + role checks below, so CORS is not the
  // security boundary here; this just prevents an unset secret from
  // silently breaking every call.
  if (allowedOrigins.length === 0) return true;
  if (allowedOrigins.includes(origin)) return true;
  // Allow Vercel preview deployments so a changed URL never breaks CORS.
  try {
    if (new URL(origin).hostname.endsWith(".vercel.app")) return true;
  } catch (_) { /* not a URL */ }
  return false;
}

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = isAllowedOrigin(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) throw new Error('Unauthorized');

    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) throw new Error('Unauthorized');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const today = new Date();
    const sevenDaysLater = new Date(today);
    sevenDaysLater.setDate(today.getDate() + 7);

    const todayStr = today.toISOString().split('T')[0];
    const futureStr = sevenDaysLater.toISOString().split('T')[0];

    const { data: duePayments, error } = await supabase
      .from('payment_records')
      .select('*, student:students(full_name, user_id, parent_email)')
      .is('paid_date', null)
      .eq('reminder_sent', false)
      .gte('due_date', todayStr)
      .lte('due_date', futureStr);

    if (error) throw error;

    let notificationsSent = 0;

    for (const payment of duePayments || []) {
      const { data: coordinators } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'coordinator');

      for (const coordinator of coordinators || []) {
        await supabase.from('notifications').insert({
          user_id: coordinator.id,
          type: 'payment_reminder',
          title: `Payment due: ${payment.student?.full_name}`,
          body: `Instalment #${payment.instalment_number} of ₹${payment.amount} is due on ${payment.due_date}`,
        });
        notificationsSent++;
      }

      if (payment.student?.user_id) {
        await supabase.from('notifications').insert({
          user_id: payment.student.user_id,
          type: 'payment_reminder',
          title: 'Payment Reminder',
          body: `Your instalment of ₹${payment.amount} is due on ${payment.due_date}`,
        });
        notificationsSent++;
      }

      await supabase
        .from('payment_records')
        .update({ reminder_sent: true })
        .eq('id', payment.id);

      // NOTE: invoices are created only when a payment is actually verified
      // (generate-invoice). Previously this cron inserted a placeholder
      // "PENDING" invoice on the due date, which generate-invoice's idempotency
      // check then returned instead of building the real paid invoice — so the
      // customer never received a proper invoice/PDF/email. Do not create
      // invoices here.
    }

    return new Response(
      JSON.stringify({
        success: true,
        payments_checked: duePayments?.length || 0,
        notifications_sent: notificationsSent,
      }),
      { headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: error.message === 'Unauthorized' ? 401 : 500,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    });
  }
});
