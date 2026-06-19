import { useState } from 'react';
import { Music } from 'lucide-react';
import { useStudentPortal } from './StudentPortalContext';
import { LessonRow, CancelLessonModal, toCancelTarget, type CancelTarget } from '../../components/student/shared';

export function StudentLessonsList() {
  const { upcoming, past, studentName } = useStudentPortal();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);

  const list = tab === 'upcoming' ? upcoming : past;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-navy">My Lessons</h1>
        <p className="text-gray-500 text-sm mt-1">Your scheduled and completed lessons.</p>
      </div>

      {/* Segmented control */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl max-w-sm">
        <SegBtn active={tab === 'upcoming'} onClick={() => setTab('upcoming')} label={`Upcoming (${upcoming.length})`} />
        <SegBtn active={tab === 'past'} onClick={() => setTab('past')} label={`Past (${past.length})`} />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {list.length === 0 ? (
          <div className="p-10 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center mx-auto mb-3">
              <Music size={22} className="text-gray-300" />
            </div>
            <p className="text-gray-500 text-sm">
              {tab === 'upcoming' ? 'No upcoming lessons scheduled.' : 'No past lessons yet.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {list.map((item) => (
              <LessonRow
                key={item.id}
                item={item}
                variant={tab}
                onCancel={tab === 'upcoming' ? (it) => setCancelTarget(toCancelTarget(it, studentName)) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      <CancelLessonModal target={cancelTarget} onClose={() => setCancelTarget(null)} />
    </div>
  );
}

function SegBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
        active ? 'bg-white text-navy shadow-sm' : 'text-gray-500 hover:text-navy'
      }`}
    >
      {label}
    </button>
  );
}
