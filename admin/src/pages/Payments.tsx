import React, { useState } from 'react';
import { CreditCard, Send, CheckCircle, AlertCircle, Clock, Download, FileText } from 'lucide-react';
import { usePayments } from '../hooks/usePayments';

export function PaymentsPage() {
  const { payments, loading, verifyPayment, downloadInvoice, sendReminder } = usePayments();
  const [verifying, setVerifying] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; url?: string } | null>(null);

  const overdue = payments.filter((p) => !p.paid_date && new Date(p.due_date) < new Date());
  const upcoming = payments.filter((p) => !p.paid_date && new Date(p.due_date) >= new Date());
  const paid = payments.filter((p) => p.paid_date);

  async function handleVerify(id: string) {
    setVerifying(id);
    try {
      const result = await verifyPayment(id);
      setToast({
        message: `Invoice ${result?.invoice_number || ''} generated successfully`,
        url: result?.pdf_url,
      });
      setTimeout(() => setToast(null), 5000);
    } catch (err: any) {
      alert(err.message || 'Failed to verify payment');
    } finally {
      setVerifying(null);
    }
  }

  async function handleDownload(invoiceId: string) {
    const url = await downloadInvoice(invoiceId);
    if (url) window.open(url, '_blank');
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy">Payments</h1>
        <p className="text-gray-500 text-sm mt-1">Track and manage student payments</p>
      </div>

      {/* Toast */}
      {toast && (
        <div className="mb-4 bg-teal-light border border-teal/20 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle size={16} className="text-teal" />
            <span className="text-sm text-navy font-medium">{toast.message}</span>
          </div>
          {toast.url && (
            <a href={toast.url} target="_blank" rel="noreferrer"
              className="text-xs font-semibold text-teal hover:underline flex items-center gap-1">
              <Download size={12} /> Download Invoice
            </a>
          )}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border-l-4 border-coral p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-coral-light rounded-lg flex items-center justify-center">
              <AlertCircle size={20} className="text-coral" />
            </div>
            <div>
              <p className="text-2xl font-bold text-navy">{overdue.length}</p>
              <p className="text-xs text-gray-400">Overdue</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border-l-4 border-amber-400 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center">
              <Clock size={20} className="text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-navy">{upcoming.length}</p>
              <p className="text-xs text-gray-400">Upcoming</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border-l-4 border-teal p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-teal-light rounded-lg flex items-center justify-center">
              <CheckCircle size={20} className="text-teal" />
            </div>
            <div>
              <p className="text-2xl font-bold text-navy">{paid.length}</p>
              <p className="text-xs text-gray-400">Paid</p>
            </div>
          </div>
        </div>
      </div>

      {/* Payments table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="text-left text-xs font-semibold text-gray-500 uppercase px-5 py-3">Student</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase px-5 py-3">Plan</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase px-5 py-3">Amount</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase px-5 py-3">Instalment</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase px-5 py-3">Due Date</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase px-5 py-3">Status</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase px-5 py-3">Invoice</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase px-5 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr><td colSpan={8} className="text-center text-gray-400 py-12">Loading...</td></tr>
            ) : payments.length === 0 ? (
              <tr><td colSpan={8} className="text-center text-gray-400 py-12">No payment records</td></tr>
            ) : (
              payments.map((payment: any) => {
                const isOverdue = !payment.paid_date && new Date(payment.due_date) < new Date();
                const isPaid = !!payment.paid_date;
                const invoice = payment.invoice;
                return (
                  <tr key={payment.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3.5 text-sm font-medium text-navy">{payment.student?.full_name || '—'}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">{payment.plan?.replace(/_/g, ' ')}</td>
                    <td className="px-5 py-3.5 text-sm font-semibold text-navy">₹{Number(payment.amount).toLocaleString('en-IN')}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">#{payment.instalment_number}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">{new Date(payment.due_date).toLocaleDateString()}</td>
                    <td className="px-5 py-3.5">
                      {isPaid ? (
                        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-teal-light text-teal">Paid</span>
                      ) : isOverdue ? (
                        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-coral-light text-coral">Overdue</span>
                      ) : (
                        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-600">Pending</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {invoice ? (
                        <button
                          onClick={() => handleDownload(invoice.id)}
                          className="flex items-center gap-1 text-xs text-teal hover:underline"
                        >
                          <FileText size={14} />
                          {invoice.invoice_number}
                        </button>
                      ) : isPaid ? (
                        <span className="text-xs text-gray-400">—</span>
                      ) : null}
                    </td>
                    <td className="px-5 py-3.5">
                      {!isPaid && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleVerify(payment.id)}
                            disabled={verifying === payment.id}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-teal text-white hover:bg-teal/80 disabled:opacity-50"
                          >
                            {verifying === payment.id ? 'Verifying...' : 'Mark Paid'}
                          </button>
                          {!payment.reminder_sent && (
                            <button
                              onClick={() => sendReminder(payment.id)}
                              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 flex items-center gap-1"
                            >
                              <Send size={12} /> Remind
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
