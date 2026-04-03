import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { PaymentRecord, Invoice } from '@troika/shared';

type PaymentWithStudent = PaymentRecord & {
  student?: { full_name: string };
  invoice?: Invoice | null;
};

export function usePayments() {
  const [payments, setPayments] = useState<PaymentWithStudent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('payment_records')
      .select('*, student:students(full_name), invoice:invoices(id, invoice_number, pdf_path)')
      .order('due_date', { ascending: true });
    setPayments((data || []) as any);
    setLoading(false);
  }, []);

  useEffect(() => { fetchPayments(); }, [fetchPayments]);

  async function verifyPayment(id: string) {
    const { data: { user } } = await supabase.auth.getUser();

    // 1. Update payment record with paid_date + verification
    const { error } = await supabase
      .from('payment_records')
      .update({
        paid_date: new Date().toISOString().split('T')[0],
        verified_at: new Date().toISOString(),
        verified_by: user?.id || null,
      })
      .eq('id', id);
    if (error) throw error;

    // 2. Call generate-invoice edge function
    const { data: invoiceData, error: fnErr } = await supabase.functions.invoke(
      'generate-invoice',
      { body: { payment_id: id } }
    );
    if (fnErr) throw fnErr;

    await fetchPayments();
    return invoiceData;
  }

  async function downloadInvoice(invoiceId: string) {
    const { data: invoice } = await supabase
      .from('invoices')
      .select('pdf_path')
      .eq('id', invoiceId)
      .single();
    if (!invoice?.pdf_path) return null;

    const { data } = await supabase.storage
      .from('invoices')
      .createSignedUrl(invoice.pdf_path, 3600);
    return data?.signedUrl || null;
  }

  async function sendReminder(id: string) {
    const { error } = await supabase
      .from('payment_records')
      .update({ reminder_sent: true })
      .eq('id', id);
    if (error) throw error;
    await fetchPayments();
  }

  return { payments, loading, verifyPayment, downloadInvoice, sendReminder, refresh: fetchPayments };
}
