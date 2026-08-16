import { toDateStr } from '../lib/dates';
import { useState, useEffect } from 'react';
import { usePayments } from '../hooks/usePayments';
import type { PaymentWithStudent } from '../hooks/usePayments';
import { supabase } from '../lib/supabase';
import { openInvoiceHtml } from '../lib/invoice';
import { DollarSign, AlertTriangle, Clock, CheckCircle, RefreshCw, Download, FileText, MessageCircle, Plus, X } from 'lucide-react';
import { SkeletonCards, SkeletonList } from '../components/Skeleton';

function buildWhatsAppUrl(
  phone: string,
  studentName: string,
  parentName: string | null,
  amount: number,
  dueDate: string,
  instalmentNumber: number | null,
  invoiceUrl?: string | null
): string {
  const recipient = parentName || studentName;
  const amountStr = amount.toLocaleString('en-IN');
  const dueDateStr = new Date(dueDate + 'T00:00:00').toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  const instalmentNote = instalmentNumber ? ` (Instalment ${instalmentNumber})` : '';
  const invoiceLine = invoiceUrl ? `\n\nView your invoice here: ${invoiceUrl}` : '';
  const msg =
    `Hi ${recipient}, this is a friendly reminder that ${studentName}'s lesson fee${instalmentNote} ` +
    `of ₹${amountStr} is due on ${dueDateStr}. ` +
    `Please arrange payment at your earliest convenience.${invoiceLine}\n\nThank you — Troika Music`;
  const digits = phone.replace(/\D/g, '');
  const normalized = digits.startsWith('91') ? digits : `91${digits}`;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(msg)}`;
}

export function PaymentsPage() {
  const { payments, loading, error, verifyPayment, generateInvoice, downloadInvoice, refresh } = usePayments();
  const [verifying, setVerifying] = useState<string | null>(null);
  const [waLoading, setWaLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; url?: string; error?: boolean } | null>(null);

  // Misc charge (add-on) creation
  const [students, setStudents] = useState<{ id: string; full_name: string }[]>([]);
  const [chargeOpen, setChargeOpen] = useState(false);
  const [chargeSaving, setChargeSaving] = useState(false);
  const [charge, setCharge] = useState({
    student_id: '', label: '', amount: '', due_date: toDateStr(new Date()),
  });

  useEffect(() => {
    supabase.from('students').select('id, full_name').eq('is_active', true).order('full_name')
      .then(({ data }) => setStudents((data || []) as any));
  }, []);

  async function saveCharge() {
    if (!charge.student_id || !charge.label.trim() || !(Number(charge.amount) > 0)) {
      setToast({ message: 'Student, name and a positive amount are required', error: true });
      return;
    }
    setChargeSaving(true);
    const { error: err } = await supabase.from('payment_records').insert({
      student_id: charge.student_id,
      plan: null,
      label: charge.label.trim(),
      amount: Number(charge.amount),
      instalment_number: 1,
      due_date: charge.due_date,
    });
    setChargeSaving(false);
    if (err) { setToast({ message: err.message, error: true }); return; }
    setToast({ message: 'Charge added' });
    setChargeOpen(false);
    setCharge({ student_id: '', label: '', amount: '', due_date: toDateStr(new Date()) });
    refresh();
  }

  const today = toDateStr(new Date());
  const overdue = payments.filter((p) => !p.paid_date && p.due_date < today);
  const upcoming = payments.filter((p) => !p.paid_date && p.due_date >= today);
  const paid = payments.filter((p) => p.paid_date);

  async function handleVerify(id: string) {
    setVerifying(id);
    try {
      const result = await verifyPayment(id);
      if (result.invoiceError) {
        setToast({
          message: `Payment marked paid, but the invoice failed to generate (${result.invoiceError}). Use "Generate invoice" to retry.`,
          error: true,
        });
      } else {
        setToast({
          message: `Payment marked paid. Invoice ${result.invoice?.invoice_number || ''} generated.`,
          url: result.invoice?.pdf_url,
        });
      }
      setTimeout(() => setToast(null), 6000);
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to mark payment as paid', error: true });
      setTimeout(() => setToast(null), 6000);
    } finally {
      setVerifying(null);
    }
  }

  async function handleDownload(invoiceId: string) {
    const url = await downloadInvoice(invoiceId);
    if (url) await openInvoiceHtml(url);
  }

  async function handleGenerateInvoice(id: string) {
    setVerifying(id);
    try {
      const inv = await generateInvoice(id);
      setToast({ message: `Invoice ${inv?.invoice_number || ''} generated.`, url: inv?.pdf_url });
    } catch (e: any) {
      setToast({ message: e.message || 'Invoice generation failed', error: true });
    } finally {
      setVerifying(null);
      setTimeout(() => setToast(null), 6000);
    }
  }

  if (loading) return (
    <div className="space-y-6">
      <SkeletonCards count={3} className="grid-cols-1 sm:grid-cols-3" />
      <SkeletonList rows={6} />
    </div>
  );

  if (error) return (
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

      {/* Toast */}
      {toast && (
        <div className={`${toast.error ? 'bg-coral/10 border-coral/20' : 'bg-teal/10 border-teal/20'} border rounded-xl p-4 flex items-center justify-between`}>
          <div className="flex items-center gap-2">
            <CheckCircle size={16} className={toast.error ? 'text-coral' : 'text-teal'} />
            <span className="text-sm text-navy font-medium">{toast.message}</span>
          </div>
          {toast.url && (
            <a href={toast.url} target="_blank" rel="noreferrer"
              className="text-xs font-semibold text-teal hover:underline flex items-center gap-1">
              <Download size={12} /> Download
            </a>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {summaryCards.map((c) => (
          <div key={c.label} className="bg-white rounded-xl border border-black/5 p-4">
            <div className={`w-9 h-9 rounded-lg ${c.bg} flex items-center justify-center mb-2`}>
              <c.icon size={18} className={c.color} />
            </div>
            <p className="text-2xl font-bold text-navy">{c.value}</p>
            <p className="text-xs text-gray-500">{c.label}</p>
          </div>
        ))}
      </div>

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
            {payments.map((p: PaymentWithStudent) => {
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
                      {isPaid ? 'Paid' : isOverdue ? 'Overdue' : 'Pending'}
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
                          onClick={() => handleVerify(p.id)}
                          disabled={verifying === p.id}
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
                              onClick={async () => {
                                setWaLoading(p.id);
                                let invoiceUrl: string | null = null;
                                if (p.invoice?.pdf_path) {
                                  const { data } = await supabase.storage
                                    .from('invoices')
                                    .createSignedUrl(p.invoice.pdf_path, 604800);
                                  invoiceUrl = data?.signedUrl ?? null;
                                }
                                const url = buildWhatsAppUrl(phone, student.full_name, student.parent_name, p.amount, p.due_date, p.instalment_number, invoiceUrl);
                                setWaLoading(null);
                                window.open(url, '_blank');
                              }}
                              className="text-green-600 hover:underline flex items-center gap-0.5 text-xs disabled:opacity-50"
                              title="Send via WhatsApp"
                            >
                              <MessageCircle size={10} /> {waLoading === p.id ? '...' : 'Remind'}
                            </button>
                          );
                        })()}
                      </div>
                    )}
                    {isPaid && !invoice && <span className="text-xs text-gray-400">{p.paid_date}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {payments.map((p: PaymentWithStudent) => {
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
                  {isPaid ? 'Paid' : isOverdue ? 'Overdue' : 'Pending'}
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
                        onClick={() => handleVerify(p.id)}
                        disabled={verifying === p.id}
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
                            onClick={async () => {
                              setWaLoading(p.id);
                              let invoiceUrl: string | null = null;
                              if (p.invoice?.pdf_path) {
                                const { data } = await supabase.storage
                                  .from('invoices')
                                  .createSignedUrl(p.invoice.pdf_path, 604800);
                                invoiceUrl = data?.signedUrl ?? null;
                              }
                              const url = buildWhatsAppUrl(phone, student.full_name, student.parent_name, p.amount, p.due_date, p.instalment_number, invoiceUrl);
                              setWaLoading(null);
                              window.open(url, '_blank');
                            }}
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
            </div>
          );
        })}
      </div>

      {/* Add misc charge modal */}
      {chargeOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-navy text-lg">Add charge</h3>
              <button onClick={() => setChargeOpen(false)} className="text-gray-400 hover:text-navy"><X size={20} /></button>
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
                  <input type="number" min={0} value={charge.amount}
                    onChange={e => setCharge(p => ({ ...p, amount: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none"
                    placeholder="0" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Due date</label>
                  <input type="date" value={charge.due_date}
                    onChange={e => setCharge(p => ({ ...p, due_date: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 pt-5">
              <button onClick={() => setChargeOpen(false)}
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
