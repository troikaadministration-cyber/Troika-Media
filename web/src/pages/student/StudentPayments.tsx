import { BookOpen, CreditCard, FileText, AlertCircle, Clock } from 'lucide-react';
import { useStudentPortal } from './StudentPortalContext';
import { fmtDate, fmtMoney } from './format';

export function StudentPayments() {
  const { enrolments, payments } = useStudentPortal();

  const today = new Date().toISOString().split('T')[0];
  const overdue = payments.filter((p) => !p.paid_date && p.due_date < today);
  const nextPay = payments.find((p) => !p.paid_date && p.due_date >= today);
  const paidCount = payments.filter((p) => p.paid_date).length;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-navy">Payments</h1>
        <p className="text-gray-500 text-sm mt-1">Your enrolment, fees and invoices.</p>
      </div>

      {/* Alerts */}
      {overdue.length > 0 && (
        <div className="bg-coral/10 border border-coral/20 rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-coral/10 flex items-center justify-center flex-shrink-0">
            <AlertCircle size={20} className="text-coral" />
          </div>
          <div>
            <p className="text-sm font-medium text-coral">Overdue Payment</p>
            <p className="text-xs text-coral/80">
              {fmtMoney(overdue[0].amount)} was due on {fmtDate(overdue[0].due_date, { month: 'short', day: 'numeric' })}
            </p>
          </div>
        </div>
      )}
      {!overdue.length && nextPay && (
        <div className="bg-yellow/10 border border-yellow/20 rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-yellow/10 flex items-center justify-center flex-shrink-0">
            <Clock size={20} className="text-yellow-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-yellow-700">Next Payment</p>
            <p className="text-xs text-yellow-600">
              {fmtMoney(nextPay.amount)} due on {fmtDate(nextPay.due_date, { month: 'short', day: 'numeric' })}
            </p>
          </div>
        </div>
      )}

      {/* Enrolment summary */}
      {enrolments.map((enr) => {
        const enrRemaining = enr.total_lessons - enr.lessons_used;
        const pct = Math.min((enr.lessons_used / enr.total_lessons) * 100, 100);
        return (
          <div key={enr.id} className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-teal/10 flex items-center justify-center">
                <BookOpen size={16} className="text-teal" />
              </div>
              <h2 className="font-semibold text-navy text-sm">Enrolment — {enr.academic_year}</h2>
            </div>

            <div className="mb-3">
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-gray-500">Lessons Used</span>
                <span className="font-semibold text-navy">{enr.lessons_used} / {enr.total_lessons}</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-3">
                <div className="bg-teal rounded-full h-3 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-gray-400 mt-1">{enrRemaining} lessons remaining</p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-xs text-gray-400">Rate/Lesson</p>
                <p className="font-semibold text-navy">{fmtMoney(enr.rate_per_lesson)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Total Fee</p>
                <p className="font-semibold text-navy">{fmtMoney(enr.total_fee)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Payment Plan</p>
                <p className="font-medium text-gray-700 capitalize">{enr.payment_plan?.replace(/_/g, ' ')}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Start Date</p>
                <p className="font-medium text-gray-700">{fmtDate(enr.start_date)}</p>
              </div>
            </div>
          </div>
        );
      })}

      {/* Payment history */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-navy">Payment History</h2>
          {payments.length > 0 && (
            <span className="text-xs text-gray-400">{paidCount} of {payments.length} paid</span>
          )}
        </div>
        {payments.length === 0 ? (
          <div className="p-10 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center mx-auto mb-3">
              <CreditCard size={22} className="text-gray-300" />
            </div>
            <p className="text-gray-500 text-sm">No payments recorded yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {payments.map((p) => {
              const isPaid = !!p.paid_date;
              const isOverdue = !isPaid && p.due_date < today;
              return (
                <div key={p.id} className="px-5 py-3 flex items-center justify-between hover:bg-gray-50/50">
                  <div>
                    <p className="text-sm font-medium text-navy">Instalment #{p.instalment_number}</p>
                    <p className="text-xs text-gray-500 mt-0.5 capitalize">
                      {p.plan?.replace(/_/g, ' ')} · Due {fmtDate(p.due_date)}
                    </p>
                    {isPaid && p.paid_date && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        Paid {fmtDate(p.paid_date)}
                        {p.invoice && (
                          <span className="ml-2 text-teal">
                            <FileText size={10} className="inline" /> {p.invoice.invoice_number}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-navy">{fmtMoney(p.amount)}</p>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      isPaid ? 'bg-teal/10 text-teal' : isOverdue ? 'bg-coral/10 text-coral' : 'bg-yellow/10 text-yellow-700'
                    }`}>
                      {isPaid ? 'Paid' : isOverdue ? 'Overdue' : 'Pending'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
