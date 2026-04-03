// Supabase Edge Function: Payment reminders (daily cron)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';

const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN') || '';

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allowed = allowedOrigin && origin === allowedOrigin ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

      // Auto-generate PENDING invoice if due date is today
      if (payment.due_date === todayStr) {
        // Check if invoice already exists
        const { data: existing } = await supabase
          .from('invoices')
          .select('id')
          .eq('payment_id', payment.id)
          .maybeSingle();

        if (!existing) {
          const { data: invoiceNumber } = await supabase.rpc('next_invoice_number');
          if (invoiceNumber) {
            await supabase.from('invoices').insert({
              invoice_number: invoiceNumber,
              payment_id: payment.id,
              student_id: payment.student_id,
              amount: payment.amount,
              currency: 'INR',
              description: `PENDING — Instalment #${payment.instalment_number}`,
              issued_date: todayStr,
            });
          }
        }
      }
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
