import { toDateStr } from '../lib/dates';
import { supabase } from '../lib/supabase';
import { useQuery, invalidateQueries, errorMessage } from '../lib/queryCache';
import { fetchAll } from '../lib/fetchAll';
import type { PaymentRecord } from '../types';

interface Invoice {
  id: string;
  invoice_number: string;
  pdf_path: string | null;
}

export type PaymentMethod = 'cash' | 'upi' | 'bank_transfer' | 'cheque' | 'other';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  upi: 'UPI',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
  other: 'Other',
};

export interface MarkPaidDetails {
  /** YYYY-MM-DD; defaults to today. */
  paidDate?: string;
  method?: PaymentMethod | null;
  reference?: string | null;
}

export type PaymentWithStudent = PaymentRecord & {
  enrolment_id?: string | null;
  payment_method?: PaymentMethod | null;
  payment_reference?: string | null;
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
    invalidateQueries('student-portal:');
    await refresh();
  }

  // Marks the payment paid. Invoice generation is best-effort: if it fails the
  // payment is still recorded as paid and the caller gets an `invoiceError` to
  // surface (with a retry via generateInvoice), rather than the whole action
  // throwing and hiding that the money was recorded.
  async function verifyPayment(id: string, details: MarkPaidDetails = {}) {
    const { data: { user } } = await supabase.auth.getUser();

    const today = toDateStr(new Date());
    const paidDate = details.paidDate || today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) throw new Error('Choose the date the payment was received.');
    if (paidDate > today) throw new Error('The payment date can\'t be in the future.');
    const reference = details.reference?.trim() || null;
    if (reference && reference.length > 100) throw new Error('The payment reference is too long (100 characters max).');

    const { data: updated, error: err } = await supabase
      .from('payment_records')
      .update({
        paid_date: paidDate,
        verified_at: new Date().toISOString(),
        verified_by: user?.id || null,
        payment_method: details.method || null,
        payment_reference: reference,
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

  // Puts a wrongly-marked payment back to unpaid. The RPC removes the invoice
  // row (its number is cancelled, never reused) and logs the undo; the invoice
  // file is then removed through the Storage API. A file that can't be removed
  // is only an orphan in storage — the undo itself already succeeded.
  async function undoPayment(id: string) {
    const { data, error: err } = await supabase.rpc('undo_payment', { p_payment_id: id });
    if (err) {
      await afterChange();
      throw new Error(errorMessage(err, 'Could not undo the payment'));
    }
    const result = (data ?? {}) as { invoice_number?: string | null; pdf_path?: string | null };
    let fileError: string | null = null;
    if (result.pdf_path) {
      const { error: rmErr } = await supabase.storage.from('invoices').remove([result.pdf_path]);
      if (rmErr) fileError = rmErr.message;
    }
    await afterChange();
    return { invoiceNumber: result.invoice_number ?? null, fileError };
  }

  /** A link to the invoice file that stays valid for 7 days (for WhatsApp messages). */
  async function invoiceShareUrl(pdfPath: string | null | undefined): Promise<string | null> {
    if (!pdfPath) return null;
    const { data: signed } = await supabase.storage.from('invoices').createSignedUrl(pdfPath, 7 * 24 * 3600);
    return signed?.signedUrl ?? null;
  }

  async function sendReminder(id: string) {
    const { error: fnErr } = await supabase.functions.invoke('send-payment-reminder', {
      body: { payment_id: id },
    });
    if (fnErr) throw new Error(await functionErrorMessage(fnErr, 'Could not send reminder'));
    await refresh();
  }

  return {
    payments: data ?? [], loading, error,
    verifyPayment, undoPayment, generateInvoice, downloadInvoice, invoiceShareUrl, sendReminder,
    refresh: afterChange,
  };
}
