import { useState } from 'react';
import { usePayments } from '../hooks/usePayments';
import { DollarSign, AlertTriangle, Clock, CheckCircle, Send, RefreshCw, Download, FileText } from 'lucide-react';

export function PaymentsPage() {
  const { payments, loading, error, verifyPayment, downloadInvoice, sendReminder, refresh } = usePayments();
  const [verifying, setVerifying] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; url?: string } | null>(null);

  const today = new Date().toISOString().split('T')[0];
  const overdue = payments.filter((p) => !p.paid_date && p.due_date < today);
  const upcoming = payments.filter((p) => !p.paid_date && p.due_date >= today);
  const paid = payments.filter((p) => p.paid_date);

  async function handleVerify(id: string) {
    setVerifying(id);
    try {
      const result = await verifyPayment(id);
      setToast({
        message: `Invoice ${result?.invoice_number || ''} generated`,
        url: result?.pdf_url,
      });
      setTimeout(() => setToast(null), 5000);
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to verify payment' });
      setTimeout(() => setToast(null), 5000);
    } finally {
      setVerifying(null);
    }
  }

  async function handleDownload(invoiceId: string) {
    const url = await downloadInvoice(invoiceId);
    if (url) window.open(url, '_blank');
  }

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-gray-400">Loading...</p></div>;

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
      <div>
        <h1 className="text-2xl font-bold text-navy">Payments</h1>
        <p className="text-gray-500 text-sm">{payments.length} payment records</p>
      </div>

      {/* Toast */}
      {toast && (
        <div className="bg-teal/10 border border-teal/20 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle size={16} className="text-teal" />
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
          <div key={c.label} className="bg-white rounded-xl border border-gray-100 p-4">
            <div className={`w-9 h-9 rounded-lg ${c.bg} flex items-center justify-center mb-2`}>
              <c.icon size={18} className={c.color} />
            </div>
            <p className="text-2xl font-bold text-navy">{c.value}</p>
            <p className="text-xs text-gray-500">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Table - Desktop */}
      <div className="hidden md:block bg-white rounded-xl border border-gray-100 overflow-hidden">
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
          <tbody className="divide-y divide-gray-50">
            {payments.map((p) => {
              const isOverdue = !p.paid_date && p.due_date < today;
              const isPaid = !!p.paid_date;
              const invoice = (p as any).invoice;
              return (
                <tr key={p.id} className="hover:bg-gray-50/50">
                  <td className="px-5 py-3 text-sm font-medium text-navy">{(p as any).student?.full_name || '-'}</td>
                  <td className="px-5 py-3"><span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{p.plan}</span></td>
                  <td className="px-5 py-3 text-sm font-medium text-navy">₹{Number(p.amount).toLocaleString('en-IN')}</td>
                  <td className="px-5 py-3 text-sm text-gray-500">#{p.instalment_number}</td>
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
                      <span className="text-xs text-gray-400">—</span>
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
                        {!p.reminder_sent && (
                          <button onClick={() => sendReminder(p.id)} className="text-xs text-coral hover:underline flex items-center gap-0.5">
                            <Send size={10} />Remind
                          </button>
                        )}
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
        {payments.map((p) => {
          const isOverdue = !p.paid_date && p.due_date < today;
          const isPaid = !!p.paid_date;
          const invoice = (p as any).invoice;
          return (
            <div key={p.id} className="bg-white rounded-xl border border-gray-100 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-medium text-navy text-sm">{(p as any).student?.full_name || '-'}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  isPaid ? 'bg-teal/10 text-teal' : isOverdue ? 'bg-coral/10 text-coral' : 'bg-yellow-100 text-yellow-700'
                }`}>
                  {isPaid ? 'Paid' : isOverdue ? 'Overdue' : 'Pending'}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">{p.plan} - #{p.instalment_number}</span>
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
                      {!p.reminder_sent && (
                        <button onClick={() => sendReminder(p.id)} className="text-coral font-medium">Remind</button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
