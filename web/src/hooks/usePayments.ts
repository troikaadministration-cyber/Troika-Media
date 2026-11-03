import { toDateStr } from '../lib/dates';
import { supabase } from '../lib/supabase';
import { useQuery, invalidateQueries } from '../lib/queryCache';
import { fetchAll } from '../lib/fetchAll';
import type { PaymentRecord } from '../types';

interface Invoice {
  id: string;
  invoice_number: string;
  pdf_path: string | null;
}

export type PaymentWithStudent = PaymentRecord & {
  student?: {
    full_name: string;
    phone: string | null;
    parent_name: string | null;
    parent_phone: string | null;
  };
  invoice?: Invoice | null;
};

/** Edge-function errors hide the server's message in `context`; pull it out for the UI. */
async function functionErrorMessage(err: unknown, fallback: string): Promise<string> {
  const ctx = (err as { context?: Response })?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.clone().json();
      if (body?.error) return String(body.error);
    } catch { /* not JSON */ }
  }
  return (err as Error)?.message || fallback;
}

export function usePayments() {
  const { data, loading, error, refresh } = useQuery<PaymentWithStudent[]>('payments', () =>
    fetchAll<PaymentWithStudent>((from, to) =>
      supabase
        .from('payment_records')
        .select('*, student:students(full_name, phone, parent_name, parent_phone), invoice:invoices(id, invoice_number, pdf_path)')
        .order('due_date', { ascending: true })
        .order('id')
        .range(from, to)),
  );

  async function afterChange() {
    invalidateQueries('dashboard:');
    invalidateQueries('reports:');
    await refresh();
  }

  // Marks the payment paid. Invoice generation is best-effort: if it fails the
  // payment is still recorded as paid and the caller gets an `invoiceError` to
  // surface (with a retry via generateInvoice), rather than the whole action
  // throwing and hiding that the money was recorded.
  async function verifyPayment(id: string) {
    const { data: { user } } = await supabase.auth.getUser();

    const { data: updated, error: err } = await supabase
      .from('payment_records')
      .update({
        paid_date: toDateStr(new Date()),
        verified_at: new Date().toISOString(),
        verified_by: user?.id || null,
      })
      .eq('id', id)
      .is('paid_date', null) // never re-stamp an already-paid record (double click / two tabs)
      .select('id');
    if (err) throw err; // marking paid genuinely failed — surface it
    if (!updated || updated.length === 0) {
      await afterChange();
      throw new Error('This payment was already marked as paid.');
    }

    const { data: invoiceData, error: fnErr } = await supabase.functions.invoke(
      'generate-invoice',
      { body: { payment_id: id } }
    );

    await afterChange();
    if (fnErr) {
      return { paid: true, invoice: null, invoiceError: await functionErrorMessage(fnErr, 'Invoice generation failed') };
    }
    return { paid: true, invoice: invoiceData, invoiceError: null };
  }

  // Retry invoice generation for a payment already marked paid.
  async function generateInvoice(id: string) {
    const { data: invoiceData, error: fnErr } = await supabase.functions.invoke(
      'generate-invoice',
      { body: { payment_id: id } }
    );
    if (fnErr) throw new Error(await functionErrorMessage(fnErr, 'Invoice generation failed'));
    await refresh();
    return invoiceData;
  }

  async function downloadInvoice(invoiceId: string) {
    const { data: invoice, error: err } = await supabase
      .from('invoices')
      .select('pdf_path')
      .eq('id', invoiceId)
      .single();
    if (err) throw err;
    if (!invoice?.pdf_path) return null;

    const { data: signed, error: signErr } = await supabase.storage
      .from('invoices')
      .createSignedUrl(invoice.pdf_path, 3600);
    if (signErr) throw signErr;
    return signed?.signedUrl || null;
  }

  async function sendReminder(id: string) {
    const { error: fnErr } = await supabase.functions.invoke('send-payment-reminder', {
      body: { payment_id: id },
    });
    if (fnErr) throw new Error(await functionErrorMessage(fnErr, 'Could not send reminder'));
    await refresh();
  }

  return { payments: data ?? [], loading, error, verifyPayment, generateInvoice, downloadInvoice, sendReminder, refresh: afterChange };
}
