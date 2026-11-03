import { toDateStr, parseDateStr } from '../lib/dates';
import { useState, useMemo, useDeferredValue } from 'react';
import { usePayments, PAYMENT_METHOD_LABELS } from '../hooks/usePayments';
import type { PaymentWithStudent, PaymentMethod } from '../hooks/usePayments';
import { supabase } from '../lib/supabase';
import { openInvoiceHtml } from '../lib/invoice';
import { useActiveStudentsList } from '../hooks/useReference';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorBanner } from '../components/ErrorBanner';
import { AlertTriangle, Clock, CheckCircle, RefreshCw, Download, FileText, MessageCircle, Plus, X, Undo2 } from 'lucide-react';
import { SkeletonCards, SkeletonList } from '../components/Skeleton';

/** Indian WhatsApp number: digits only, no leading zeros, 10-digit mobiles get the 91 prefix. */
function normalizeWhatsAppPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '').replace(/^0+/, '');
  return digits.length === 10 ? `91${digits}` : digits;
}

function buildWhatsAppUrl(p: PaymentWithStudent, phone: string, invoiceUrl?: string | null): string {
  const studentName = p.student?.full_name || 'your child';
  const recipient = p.student?.parent_name || studentName;
  const amountStr = Number(p.amount).toLocaleString('en-IN');
  const dueDateStr = parseDateStr(p.due_date).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  // Misc charges (recital tickets, books…) carry a label; instalments don't.
  const what = p.label
    ? p.label
    : `lesson fee${p.instalment_number ? ` (Instalment ${p.instalment_number})` : ''}`;
  const invoiceLine = invoiceUrl ? `\n\nView your invoice here: ${invoiceUrl}` : '';
  const msg =
    `Hi ${recipient}, this is a friendly reminder that ${studentName}'s ${what} ` +
    `of ₹${amountStr} is due on ${dueDateStr}. ` +
    `Please arrange payment at your earliest convenience.${invoiceLine}\n\nThank you — Troika Music`;
  return `https://wa.me/${normalizeWhatsAppPhone(phone)}?text=${encodeURIComponent(msg)}`;
}

function longDate(d: string): string {
  return parseDateStr(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** "UPI (Ref: 4521…)" — or null when no method was recorded. */
function paidVia(p: PaymentWithStudent): string | null {
  const method = p.payment_method ? PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method : null;
  if (!method) return p.payment_reference ? `Ref: ${p.payment_reference}` : null;
  return p.payment_reference ? `${method} (Ref: ${p.payment_reference})` : method;
}

/** How many instalments the payment's plan has (same rule as the invoice). */
function instalmentCount(p: PaymentWithStudent, all: PaymentWithStudent[]): number {
  if (p.label) return 1;
  const siblings = all.filter((o) => !o.label && (p.enrolment_id
    ? o.enrolment_id === p.enrolment_id
    : !o.enrolment_id && o.student_id === p.student_id && o.plan === p.plan));
  return Math.max(siblings.length, p.instalment_number);
}

/** What the money was for: the charge label, or "lesson fee — instalment 2 of 3". */
function paymentPurpose(p: PaymentWithStudent, total: number): string {
  if (p.label) return p.label;
  if (p.plan === 'trial') return 'trial lessons';
  return total > 1 ? `lesson fee — instalment ${p.instalment_number} of ${total}` : 'lesson fee';
}

function buildReceiptUrl(p: PaymentWithStudent, phone: string, total: number, invoiceUrl: string | null): string {
  const studentName = p.student?.full_name || 'your child';
  const recipient = p.student?.parent_name || studentName;
  const via = paidVia(p);
  const lines = [
    `Hi ${recipient}, thank you — we have received ${studentName}'s payment.`,
    '',
    '*Payment receipt — Troika Music*',
    `Student: ${studentName}`,
    `Amount: ₹${Number(p.amount).toLocaleString('en-IN')}`,
    `For: ${paymentPurpose(p, total)}`,
    `Paid on: ${p.paid_date ? longDate(p.paid_date) : longDate(toDateStr(new Date()))}`,
    ...(via ? [`Paid by: ${via}`] : []),
    ...(p.invoice?.invoice_number ? [`Invoice: ${p.invoice.invoice_number}`] : []),
    ...(invoiceUrl ? ['', `View your invoice here: ${invoiceUrl}`] : []),
    '',
    'Thank you — Troika Music',
  ];
  return `https://wa.me/${normalizeWhatsAppPhone(phone)}?text=${encodeURIComponent(lines.join('\n'))}`;
}

type Toast = { message: string; url?: string; error?: boolean; receiptFor?: string };

const METHOD_OPTIONS = Object.entries(PAYMENT_METHOD_LABELS) as [PaymentMethod, string][];

export function PaymentsPage() {
  const { payments, loading, error, verifyPayment, undoPayment, generateInvoice, downloadInvoice, invoiceShareUrl, refresh } = usePayments();
  const [verifying, setVerifying] = useState<string | null>(null);
  const [waLoading, setWaLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [confirmPaid, setConfirmPaid] = useState<PaymentWithStudent | null>(null);
  const [paidForm, setPaidForm] = useState<{ date: string; method: PaymentMethod | ''; reference: string }>({
    date: toDateStr(new Date()), method: '', reference: '',
  });
  const [paidFormError, setPaidFormError] = useState<string | null>(null);
  const [confirmUndo, setConfirmUndo] = useState<PaymentWithStudent | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);

  // Misc charge (add-on) creation
  const { students } = useActiveStudentsList();
  const [chargeOpen, setChargeOpen] = useState(false);
  const [chargeSaving, setChargeSaving] = useState(false);
  const [chargeError, setChargeError] = useState<string | null>(null);
  const [charge, setCharge] = useState({
    student_id: '', label: '', amount: '', due_date: toDateStr(new Date()),
  });

  function closeCharge() {
    setChargeOpen(false);
    setChargeError(null);
  }

  async function saveCharge() {
    if (chargeSaving) return;
    const amount = Number(charge.amount);
    const problem = !charge.student_id ? 'Select a student'
      : !charge.label.trim() ? 'Enter a name for the charge'
      : !(amount > 0) ? 'Enter an amount greater than ₹0'
      : !/^\d{4}-\d{2}-\d{2}$/.test(charge.due_date) ? 'Choose a due date'
      : null;
    if (problem) { setChargeError(problem); return; }
    setChargeSaving(true);
    setChargeError(null);
    const { error: err } = await supabase.from('payment_records').insert({
      student_id: charge.student_id,
      plan: null,
      label: charge.label.trim(),
      amount,
      instalment_number: 1,
      due_date: charge.due_date,
    });
    setChargeSaving(false);
    if (err) { setChargeError(`Couldn't add the charge: ${err.message}`); return; }
    showToastFor({ message: `Charge added: ${charge.label.trim()} — ₹${amount.toLocaleString('en-IN')}` });
    closeCharge();
    setCharge({ student_id: '', label: '', amount: '', due_date: toDateStr(new Date()) });
    await refresh();
  }

  function showToastFor(t: Toast) {
    setToast(t);
    setTimeout(() => setToast(cur => (cur === t ? null : cur)), t.receiptFor ? 30000 : t.url ? 15000 : 6000);
  }

  const today = toDateStr(new Date());
  const overdue = payments.filter((p) => !p.paid_date && p.due_date < today);
  const upcoming = payments.filter((p) => !p.paid_date && p.due_date >= today);
  const paid = payments.filter((p) => p.paid_date);

  // Filter + search, and render a page at a time (hundreds of rows at once
  // made this page slow, especially on phones).
  const PAGE_SIZE = 50;
  const [statusFilter, setStatusFilter] = useState<'all' | 'Overdue' | 'Upcoming' | 'Paid'>('all');
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE_SIZE);
  const deferredSearch = useDeferredValue(search);
  const filtered = useMemo(() => {
    // "All": what needs action first — overdue (oldest first), upcoming, then paid (newest first).
    const paidNewestFirst = [...paid].reverse();
    const base = statusFilter === 'Overdue' ? overdue : statusFilter === 'Upcoming' ? upcoming
      : statusFilter === 'Paid' ? paidNewestFirst : [...overdue, ...upcoming, ...paidNewestFirst];
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter((p) => (p.student?.full_name || '').toLowerCase().includes(q) || (p.label || '').toLowerCase().includes(q));
  }, [payments, statusFilter, deferredSearch]); // eslint-disable-line react-hooks/exhaustive-deps
  const visible = filtered.slice(0, shown);

  function openMarkPaid(p: PaymentWithStudent) {
    setPaidForm({ date: toDateStr(new Date()), method: '', reference: '' });
    setPaidFormError(null);
    setConfirmPaid(p);
  }

  // Marking paid generates an invoice, so it's confirmed first (with the date
  // and how it was paid). A mistake can be undone from the Paid row.
  async function handleVerify(id: string) {
    if (verifying) return;
    const todayStr = toDateStr(new Date());
    const problem = !/^\d{4}-\d{2}-\d{2}$/.test(paidForm.date) ? 'Choose the date the payment was received.'
      : paidForm.date > todayStr ? 'The payment date can\'t be in the future.'
      : null;
    if (problem) { setPaidFormError(problem); return; }
    setConfirmPaid(null);
    setVerifying(id);
    try {
      const result = await verifyPayment(id, {
        paidDate: paidForm.date,
        method: paidForm.method || null,
        reference: paidForm.reference,
      });
      if (result.invoiceError) {
        showToastFor({
          message: `Payment marked paid, but the invoice failed to generate (${result.invoiceError}). Use "Generate invoice" to retry.`,
          error: true,
          receiptFor: id,
        });
      } else {
        showToastFor({
          message: `Payment marked paid. Invoice ${result.invoice?.invoice_number || ''} generated.`,
          url: result.invoice?.pdf_url,
          receiptFor: id,
        });
      }
    } catch (err: any) {
      showToastFor({ message: err.message || 'Failed to mark payment as paid', error: true });
    } finally {
      setVerifying(null);
    }
  }

  async function handleDownload(invoiceId: string) {
    try {
      const url = await downloadInvoice(invoiceId);
      if (url) await openInvoiceHtml(url);
      else showToastFor({ message: 'This invoice has no file yet — try "Generate invoice".', error: true });
    } catch (e: any) {
      showToastFor({ message: e.message || 'Could not open the invoice', error: true });
    }
  }

  async function handleGenerateInvoice(id: string) {
    if (verifying) return;
    setVerifying(id);
    try {
      const inv = await generateInvoice(id);
      showToastFor({ message: `Invoice ${inv?.invoice_number || ''} generated.`, url: inv?.pdf_url });
    } catch (e: any) {
      showToastFor({ message: e.message || 'Invoice generation failed', error: true });
    } finally {
      setVerifying(null);
    }
  }

  async function handleUndo(p: PaymentWithStudent) {
    if (undoing) return;
    setConfirmUndo(null);
    setUndoing(p.id);
    try {
      const { invoiceNumber, fileError } = await undoPayment(p.id);
      const who = p.student?.full_name || 'the student';
      showToastFor({
        message: `Payment from ${who} is back to unpaid.`
          + (invoiceNumber ? ` Invoice ${invoiceNumber} was cancelled.` : '')
          + (fileError ? ` (The old invoice file couldn't be deleted: ${fileError})` : ''),
      });
    } catch (e: any) {
      showToastFor({ message: e.message || 'Could not undo the payment', error: true });
    } finally {
      setUndoing(null);
    }
  }

  // WhatsApp receipt for a paid payment. The tab is opened inside the click
  // (so phone browsers don't block it) and pointed at wa.me once the 7-day
  // invoice link is ready.
  async function handleReceipt(p: PaymentWithStudent) {
    const phone = p.student?.parent_phone || p.student?.phone;
    if (!phone) {
      showToastFor({ message: `No phone number on file for ${p.student?.full_name || 'this student'} — add one to send a receipt.`, error: true });
      return;
    }
    const win = window.open('', '_blank');
    setWaLoading(p.id);
    let invoiceUrl: string | null = null;
    try {
      invoiceUrl = await invoiceShareUrl(p.invoice?.pdf_path); // best effort: the receipt still goes without a link
    } catch { /* send without the link */ }
    setWaLoading(null);
    const url = buildReceiptUrl(p, phone, instalmentCount(p, payments), invoiceUrl);
    if (win) {
      try { win.opener = null; } catch { /* cross-origin */ }
      win.location.href = url;
    } else {
      window.open(url, '_blank');
    }
  }

  async function handleWhatsApp(p: PaymentWithStudent, phone: string) {
    setWaLoading(p.id);
    let invoiceUrl: string | null = null;
    if (p.invoice?.pdf_path) {
      const { data } = await supabase.storage.from('invoices').createSignedUrl(p.invoice.pdf_path, 604800);
      invoiceUrl = data?.signedUrl ?? null; // best effort: the reminder still goes without a link
    }
    setWaLoading(null);
    window.open(buildWhatsAppUrl(p, phone, invoiceUrl), '_blank');
  }

  if (loading) return (
    <div className="space-y-6">
      <SkeletonCards count={3} className="grid-cols-1 sm:grid-cols-3" />
      <SkeletonList rows={6} />
    </div>
  );

  // Only replace the page when there's nothing cached to show.
  if (error && payments.length === 0) return (
    <div className="bg-coral/10 border border-coral/20 rounded-xl p-4 flex items-center justify-between">
      <p className="text-coral text-sm">{error}</p>
      <button onClick={refresh} className="flex items-center gap-1 text-coral text-sm font-medium hover:underline"><RefreshCw size={14} />Retry</button>
    </div>
  );

  const summaryCards = [
    { label: 'Overdue', value: overdue.length, icon: AlertTriangle, color: 'text-coral', bg: 'bg-coral/10' },
    { label: 'Upcoming', value: upcoming.length, icon: Clock, color: 'text-yellow-600', bg: 'bg-yellow/10' },
    { label: 'Paid', value: paid.length, icon: CheckCircle, color: 'text-teal', bg: 'bg-teal/10' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy">Payments</h1>
          <p className="text-gray-500 text-sm">{payments.length} payment records</p>
        </div>
        <button onClick={() => setChargeOpen(true)}
          className="flex items-center gap-1.5 bg-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-teal/90">
          <Plus size={16} /> Add charge
        </button>
      </div>

      {error && <ErrorBanner message={error} onRetry={refresh} />}

      {/* Toast */}
      {toast && (
        <div className={`${toast.error ? 'bg-coral/10 border-coral/20' : 'bg-teal/10 border-teal/20'} border rounded-xl p-4 flex items-center justify-between`}>
          <div className="flex items-center gap-2">
            <CheckCircle size={16} className={toast.error ? 'text-coral' : 'text-teal'} />
            <span className="text-sm text-navy font-medium">{toast.message}</span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {toast.receiptFor && (() => {
              const rp = payments.find((x) => x.id === toast.receiptFor && x.paid_date);
              if (!rp) return null;
              return (
                <button onClick={() => handleReceipt(rp)} disabled={waLoading === rp.id}
                  className="text-xs font-semibold text-green-600 hover:underline flex items-center gap-1 disabled:opacity-50">
                  <MessageCircle size={12} /> {waLoading === rp.id ? '...' : 'Send receipt'}
                </button>
              );
            })()}
            {toast.url && (
              <button onClick={() => openInvoiceHtml(toast.url!)}
                className="text-xs font-semibold text-teal hover:underline flex items-center gap-1">
                <Download size={12} /> Download
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {summaryCards.map((c) => (
          <button key={c.label} type="button"
            onClick={() => { setStatusFilter(f => f === c.label ? 'all' : c.label as 'Overdue' | 'Upcoming' | 'Paid'); setShown(PAGE_SIZE); }}
            aria-pressed={statusFilter === c.label}
            className={`text-left bg-white rounded-xl border p-4 transition-shadow hover:shadow-sm ${statusFilter === c.label ? 'border-teal ring-2 ring-teal/20' : 'border-black/5'}`}>
            <div className={`w-9 h-9 rounded-lg ${c.bg} flex items-center justify-center mb-2`}>
              <c.icon size={18} className={c.color} />
            </div>
            <p className="text-2xl font-bold text-navy">{c.value}</p>
            <p className="text-xs text-gray-500">{c.label}{statusFilter === c.label ? ' · showing' : ''}</p>
          </button>
        ))}
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setShown(PAGE_SIZE); }}
        placeholder="Search by student or charge…"
        aria-label="Search payments"
        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-teal/20 focus:border-teal"
      />
      {filtered.length === 0 && (
        <p className="text-center text-gray-400 text-sm py-8">No payments match.</p>
      )}

      {/* Table - Desktop */}
      <div className="hidden md:block bg-white rounded-xl border border-black/5 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50/80 text-left text-xs text-gray-500 uppercase">
              <th className="px-5 py-3 font-medium">Student</th>
              <th className="px-5 py-3 font-medium">Plan</th>
              <th className="px-5 py-3 font-medium">Amount</th>
              <th className="px-5 py-3 font-medium">Instalment</th>
              <th className="px-5 py-3 font-medium">Due Date</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Invoice</th>
              <th className="px-5 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {visible.map((p: PaymentWithStudent) => {
              const isOverdue = !p.paid_date && p.due_date < today;
              const isPaid = !!p.paid_date;
              const invoice = p.invoice;
              return (
                <tr key={p.id} className="hover:bg-gray-50/50">
                  <td className="px-5 py-3 text-sm font-medium text-navy">{p.student?.full_name || '-'}</td>
                  <td className="px-5 py-3">
                    {p.label
                      ? <span className="text-xs bg-yellow/20 text-yellow-700 px-2 py-0.5 rounded-full">{p.label}</span>
                      : <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{p.plan}</span>}
                  </td>
                  <td className="px-5 py-3 text-sm font-medium text-navy">₹{Number(p.amount).toLocaleString('en-IN')}</td>
                  <td className="px-5 py-3 text-sm text-gray-500">{p.label ? '—' : `#${p.instalment_number}`}</td>
                  <td className="px-5 py-3 text-sm text-gray-500">
                    {new Date(p.due_date + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      isPaid ? 'bg-teal/10 text-teal' : isOverdue ? 'bg-coral/10 text-coral' : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {isPaid ? 'Paid' : isOverdue ? 'Overdue' : 'Upcoming'}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {invoice ? (
                      <button
                        onClick={() => handleDownload(invoice.id)}
                        className="flex items-center gap-1 text-xs text-teal hover:underline"
                      >
                        <FileText size={12} />
                        {invoice.invoice_number}
                      </button>
                    ) : isPaid ? (
                      <button
                        onClick={() => handleGenerateInvoice(p.id)}
                        disabled={verifying === p.id}
                        className="text-xs text-coral hover:underline disabled:opacity-50"
                      >
                        {verifying === p.id ? 'Generating...' : 'Generate invoice'}
                      </button>
                    ) : null}
                  </td>
                  <td className="px-5 py-3">
                    {!isPaid && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openMarkPaid(p)}
                          disabled={!!verifying || !!undoing}
                          className="text-xs text-teal hover:underline disabled:opacity-50"
                        >
                          {verifying === p.id ? 'Verifying...' : 'Mark Paid'}
                        </button>
                        {(() => {
                          const student = p.student;
                          const phone = student?.parent_phone || student?.phone;
                          if (!phone) return (
                            <span className="text-gray-300 cursor-not-allowed" title="No phone number on file">
                              <MessageCircle size={12} />
                            </span>
                          );
                          return (
                            <button
                              disabled={waLoading === p.id}
                              onClick={() => handleWhatsApp(p, phone)}
                              className="text-green-600 hover:underline flex items-center gap-0.5 text-xs disabled:opacity-50"
                              title="Send via WhatsApp"
                            >
                              <MessageCircle size={10} /> {waLoading === p.id ? '...' : 'Remind'}
                            </button>
                          );
                        })()}
                      </div>
                    )}
                    {isPaid && (
                      <div className="space-y-1">
                        <p className="text-xs text-gray-400" title={p.payment_reference ? `Ref: ${p.payment_reference}` : undefined}>
                          Paid {parseDateStr(p.paid_date!).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                          {paidVia(p) ? ` · ${paidVia(p)}` : ''}
                        </p>
                        <div className="flex items-center gap-3">
                          <button
                            disabled={waLoading === p.id}
                            onClick={() => handleReceipt(p)}
                            className="text-green-600 hover:underline flex items-center gap-0.5 text-xs disabled:opacity-50"
                            title={(p.student?.parent_phone || p.student?.phone) ? 'Send receipt via WhatsApp' : 'No phone number on file'}
                          >
                            <MessageCircle size={10} /> {waLoading === p.id ? '...' : 'Send receipt'}
                          </button>
                          <button
                            onClick={() => setConfirmUndo(p)}
                            disabled={!!undoing || !!verifying}
                            className="text-gray-500 hover:text-coral hover:underline flex items-center gap-0.5 text-xs disabled:opacity-50"
                          >
                            <Undo2 size={10} /> {undoing === p.id ? 'Undoing...' : 'Undo paid'}
                          </button>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {visible.map((p: PaymentWithStudent) => {
          const isOverdue = !p.paid_date && p.due_date < today;
          const isPaid = !!p.paid_date;
          const invoice = p.invoice;
          return (
            <div key={p.id} className="bg-white rounded-xl border border-black/5 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-medium text-navy text-sm">{p.student?.full_name || '-'}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  isPaid ? 'bg-teal/10 text-teal' : isOverdue ? 'bg-coral/10 text-coral' : 'bg-yellow-100 text-yellow-700'
                }`}>
                  {isPaid ? 'Paid' : isOverdue ? 'Overdue' : 'Upcoming'}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">{p.label ? p.label : `${p.plan} - #${p.instalment_number}`}</span>
                <span className="font-semibold text-navy">₹{Number(p.amount).toLocaleString('en-IN')}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">
                  Due: {new Date(p.due_date + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
                </span>
                <div className="flex items-center gap-3">
                  {invoice && (
                    <button onClick={() => handleDownload(invoice.id)} className="text-teal font-medium flex items-center gap-1">
                      <FileText size={10} /> Invoice
                    </button>
                  )}
                  {!isPaid && (
                    <>
                      <button
                        onClick={() => openMarkPaid(p)}
                        disabled={!!verifying || !!undoing}
                        className="text-teal font-medium disabled:opacity-50"
                      >
                        {verifying === p.id ? '...' : 'Mark Paid'}
                      </button>
                      {(() => {
                        const student = p.student;
                        const phone = student?.parent_phone || student?.phone;
                        if (!phone) return null;
                        return (
                          <button
                            disabled={waLoading === p.id}
                            onClick={() => handleWhatsApp(p, phone)}
                            className="text-green-600 font-medium flex items-center gap-1 disabled:opacity-50"
                          >
                            <MessageCircle size={10} /> {waLoading === p.id ? '...' : 'Remind'}
                          </button>
                        );
                      })()}
                    </>
                  )}
                </div>
              </div>
              {isPaid && (
                <div className="flex items-center justify-between gap-2 text-xs pt-1 border-t border-black/5">
                  <span className="text-gray-400 truncate">
                    Paid {parseDateStr(p.paid_date!).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    {paidVia(p) ? ` · ${paidVia(p)}` : ''}
                  </span>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      disabled={waLoading === p.id}
                      onClick={() => handleReceipt(p)}
                      className="text-green-600 font-medium flex items-center gap-1 disabled:opacity-50"
                    >
                      <MessageCircle size={10} /> {waLoading === p.id ? '...' : 'Receipt'}
                    </button>
                    <button
                      onClick={() => setConfirmUndo(p)}
                      disabled={!!undoing || !!verifying}
                      className="text-gray-500 font-medium flex items-center gap-1 disabled:opacity-50"
                    >
                      <Undo2 size={10} /> {undoing === p.id ? '...' : 'Undo paid'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length > shown && (
        <div className="flex justify-center">
          <button type="button" onClick={() => setShown(n => n + PAGE_SIZE * 2)}
            className="px-5 py-2.5 rounded-xl bg-white border border-black/10 text-sm font-medium text-navy hover:bg-gray-50">
            Show more ({filtered.length - shown} more)
          </button>
        </div>
      )}

      {/* Mark paid confirmation (with date + how it was paid) */}
      {confirmPaid && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="mark-paid-title"
            className="bg-white rounded-2xl border border-black/5 shadow-lg w-full max-w-sm p-6 space-y-4">
            <h3 id="mark-paid-title" className="font-semibold text-navy text-lg">Mark as paid?</h3>
            <p className="text-sm text-gray-500">
              Record ₹{Number(confirmPaid.amount).toLocaleString('en-IN')} from {confirmPaid.student?.full_name || 'this student'}
              {' '}({confirmPaid.label || `instalment #${confirmPaid.instalment_number}`}) as paid?
              An invoice will be generated. If you picked the wrong payment you can undo it afterwards.
            </p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="paid-date" className="block text-xs font-semibold text-gray-500 mb-1">Paid on</label>
                  <input id="paid-date" type="date" value={paidForm.date} max={toDateStr(new Date())}
                    onChange={e => { setPaidForm(f => ({ ...f, date: e.target.value })); setPaidFormError(null); }}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none" />
                </div>
                <div>
                  <label htmlFor="paid-method" className="block text-xs font-semibold text-gray-500 mb-1">Method</label>
                  <select id="paid-method" value={paidForm.method}
                    onChange={e => setPaidForm(f => ({ ...f, method: e.target.value as PaymentMethod | '' }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:border-teal focus:outline-none">
                    <option value="">Not recorded</option>
                    {METHOD_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="paid-ref" className="block text-xs font-semibold text-gray-500 mb-1">Reference (optional)</label>
                <input id="paid-ref" value={paidForm.reference} maxLength={100}
                  onChange={e => setPaidForm(f => ({ ...f, reference: e.target.value }))}
                  placeholder="UPI transaction ID, cheque no…"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none" />
              </div>
              {paidFormError && <p className="text-xs text-coral">{paidFormError}</p>}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmPaid(null)}
                className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={() => handleVerify(confirmPaid.id)} disabled={!!verifying}
                className="flex-1 py-2.5 rounded-lg bg-teal text-white text-sm font-medium hover:bg-teal/90 disabled:opacity-50">
                Mark Paid
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmUndo}
        title="Undo this payment?"
        message={confirmUndo
          ? `₹${Number(confirmUndo.amount).toLocaleString('en-IN')} from ${confirmUndo.student?.full_name || 'this student'}`
            + ` (${confirmUndo.label || `instalment #${confirmUndo.instalment_number}`}) will go back to unpaid. `
            + (confirmUndo.invoice
              ? `Its invoice ${confirmUndo.invoice.invoice_number} will be cancelled and that number won't be reused — `
                + 'if you mark it paid again, a new invoice number is issued.'
              : 'If you mark it paid again, a new invoice is issued.')
          : ''}
        confirmLabel="Undo paid"
        onConfirm={() => confirmUndo && handleUndo(confirmUndo)}
        onCancel={() => setConfirmUndo(null)}
      />

      {/* Add misc charge modal */}
      {chargeOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-navy text-lg">Add charge</h3>
              <button onClick={closeCharge} className="text-gray-400 hover:text-navy"><X size={20} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Student *</label>
                <select value={charge.student_id}
                  onChange={e => setCharge(p => ({ ...p, student_id: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:border-teal focus:outline-none">
                  <option value="">Select student...</option>
                  {students.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Charge name *</label>
                <input value={charge.label}
                  onChange={e => setCharge(p => ({ ...p, label: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none"
                  placeholder="e.g. Recital tickets, Books, Exam fee" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Amount (₹) *</label>
                  <input type="number" min={1} value={charge.amount}
                    onChange={e => setCharge(p => ({ ...p, amount: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none"
                    placeholder="0" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Due date *</label>
                  <input type="date" value={charge.due_date}
                    onChange={e => setCharge(p => ({ ...p, due_date: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none" />
                </div>
              </div>
              {chargeError && <p className="text-xs text-coral">{chargeError}</p>}
            </div>
            <div className="flex gap-3 pt-5">
              <button onClick={closeCharge}
                className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={saveCharge} disabled={chargeSaving}
                className="flex-1 bg-teal text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90 disabled:opacity-50">
                {chargeSaving ? 'Saving...' : 'Add charge'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
