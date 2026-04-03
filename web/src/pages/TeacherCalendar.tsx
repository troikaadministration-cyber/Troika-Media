import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useTeacherLessonsRange } from '../hooks/useTeacherLessonsRange';
import { ChevronLeft, ChevronRight, CheckCircle, Clock, Ban, MapPin, ArrowRight } from 'lucide-react';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function toDateStr(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Returns an array of 42 cells (6 weeks) for the calendar grid */
function buildCalendarGrid(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const cells: { date: Date; isCurrentMonth: boolean }[] = [];

  // Fill leading days from previous month
  for (let i = firstDay - 1; i >= 0; i--) {
    cells.push({ date: new Date(year, month - 1, prevMonthDays - i), isCurrentMonth: false });
  }
  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), isCurrentMonth: true });
  }
  // Fill trailing days from next month to complete 6 rows
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    cells.push({ date: new Date(year, month + 1, d), isCurrentMonth: false });
  }
  return cells;
}

export function TeacherCalendarPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-based
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  // Date range for the entire month
  const startDate = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-01`;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const endDate = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  const { byDate, loading } = useTeacherLessonsRange(profile?.id, startDate, endDate);

  const cells = buildCalendarGrid(viewYear, viewMonth);

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  }
  function goToday() {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
    setSelectedDate(todayStr);
  }

  // Monthly stats
  const monthLessons = Object.values(byDate).flat();
  const monthTotal = monthLessons.length;
  const monthCompleted = monthLessons.filter(l => l.status === 'completed').length;
  const monthPending = monthLessons.filter(l => l.status === 'scheduled').length;

  // Selected day data
  const selectedLessons = byDate[selectedDate] ?? [];
  const selectedDateObj = new Date(selectedDate + 'T00:00:00');
  const selectedLabel = selectedDateObj.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  return (
    <div className="max-w-3xl mx-auto space-y-4">

      {/* Monthly summary bar */}
      <div className="bg-white rounded-xl border-l-4 border-coral p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h2 className="font-bold text-navy text-lg">
            {MONTH_NAMES[viewMonth]} {viewYear}
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">Monthly overview</p>
        </div>
        <div className="flex gap-3">
          <div className="bg-gray-50 rounded-lg px-4 py-2 text-center min-w-[60px]">
            <p className="text-xl font-bold text-navy">{monthTotal}</p>
            <p className="text-[10px] text-gray-400">Total</p>
          </div>
          <div className="bg-teal-light rounded-lg px-4 py-2 text-center min-w-[60px]">
            <p className="text-xl font-bold text-teal">{monthCompleted}</p>
            <p className="text-[10px] text-teal">Done</p>
          </div>
          <div className="bg-coral-light rounded-lg px-4 py-2 text-center min-w-[60px]">
            <p className="text-xl font-bold text-coral">{monthPending}</p>
            <p className="text-[10px] text-coral">Pending</p>
          </div>
        </div>
      </div>

      {/* Calendar card */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {/* Month navigation header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <button
            onClick={prevMonth}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-navy transition-colors"
            aria-label="Previous month"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="text-center">
            <h3 className="font-bold text-navy text-base">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </h3>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={goToday}
              className="px-3 py-1.5 text-xs font-medium text-teal hover:bg-teal/10 rounded-lg transition-colors"
            >
              Today
            </button>
            <button
              onClick={nextMonth}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-navy transition-colors"
              aria-label="Next month"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 border-b border-gray-100">
          {DAY_LABELS.map(d => (
            <div key={d} className="py-2 text-center text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        {loading ? (
          <div className="h-64 flex items-center justify-center text-gray-300 text-sm">
            <div className="w-5 h-5 border-2 border-coral border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {cells.map((cell, idx) => {
              const cellStr = cell.date.toISOString().split('T')[0];
              const cellLessons = byDate[cellStr] ?? [];
              const isToday = cellStr === todayStr;
              const isSelected = cellStr === selectedDate;
              const hasLessons = cellLessons.length > 0;
              const completedCount = cellLessons.filter(l => l.status === 'completed').length;
              const pendingCount = cellLessons.filter(l => l.status === 'scheduled').length;
              const cancelledCount = cellLessons.filter(l => l.status === 'cancelled').length;

              return (
                <button
                  key={idx}
                  onClick={() => setSelectedDate(cellStr)}
                  className={`
                    relative min-h-[64px] p-1.5 flex flex-col items-center
                    border-b border-r border-gray-50
                    transition-colors focus:outline-none
                    ${cell.isCurrentMonth ? 'hover:bg-gray-50' : 'hover:bg-gray-50/50'}
                    ${isSelected ? 'bg-coral/5 ring-1 ring-inset ring-coral/30' : ''}
                  `}
                >
                  {/* Date number */}
                  <span className={`
                    w-7 h-7 flex items-center justify-center rounded-full text-sm font-medium
                    ${isToday ? 'bg-coral text-white font-bold' : ''}
                    ${isSelected && !isToday ? 'bg-navy text-white' : ''}
                    ${!isToday && !isSelected ? (cell.isCurrentMonth ? 'text-navy' : 'text-gray-300') : ''}
                  `}>
                    {cell.date.getDate()}
                  </span>

                  {/* Lesson dots */}
                  {hasLessons && (
                    <div className="flex gap-0.5 mt-1 flex-wrap justify-center max-w-full">
                      {completedCount > 0 && (
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-teal"
                          title={`${completedCount} completed`}
                        />
                      )}
                      {pendingCount > 0 && (
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-coral"
                          title={`${pendingCount} pending`}
                        />
                      )}
                      {cancelledCount > 0 && (
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-gray-300"
                          title={`${cancelledCount} cancelled`}
                        />
                      )}
                    </div>
                  )}

                  {/* Lesson count badge for days with many lessons */}
                  {cellLessons.length > 2 && (
                    <span className="text-[9px] text-gray-400 mt-0.5 leading-none">
                      {cellLessons.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Legend */}
        <div className="flex items-center gap-4 px-5 py-3 border-t border-gray-100 bg-gray-50/50">
          <span className="text-xs text-gray-400 font-medium">Legend:</span>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-teal inline-block" />
            <span className="text-xs text-gray-500">Completed</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-coral inline-block" />
            <span className="text-xs text-gray-500">Pending</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-gray-300 inline-block" />
            <span className="text-xs text-gray-500">Cancelled</span>
          </div>
        </div>
      </div>

      {/* Selected day panel */}
      <div className="bg-white rounded-xl border-l-4 border-yellow overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between border-b border-gray-100">
          <div>
            <h3 className="font-bold text-navy">{selectedLabel}</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {selectedLessons.length === 0
                ? 'No lessons'
                : `${selectedLessons.length} lesson${selectedLessons.length > 1 ? 's' : ''}`}
            </p>
          </div>
          {selectedDate === todayStr ? (
            <span className="text-xs bg-coral/10 text-coral font-medium px-2.5 py-1 rounded-full">Today</span>
          ) : null}
        </div>

        {selectedLessons.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">
            No lessons on this day
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {selectedLessons.map(lesson => {
              const student = lesson.students?.[0]?.student;
              const studentName = student?.full_name || 'Unknown';
              const isCompleted = lesson.status === 'completed';
              const isCancelled = lesson.status === 'cancelled';

              return (
                <div key={lesson.id} className="px-5 py-3.5 flex items-center gap-3">
                  {/* Time */}
                  <div className="w-12 text-sm font-bold text-navy shrink-0">
                    {lesson.start_time?.slice(0, 5)}
                  </div>

                  {/* Status icon */}
                  <div className="shrink-0">
                    {isCompleted ? (
                      <CheckCircle size={18} className="text-teal" />
                    ) : isCancelled ? (
                      <Ban size={18} className="text-gray-300" />
                    ) : (
                      <Clock size={18} className="text-coral" />
                    )}
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-navy truncate">{lesson.title}</p>
                    <p className="text-xs text-teal truncate">{studentName}</p>
                    {lesson.location && (
                      <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-400">
                        <MapPin size={10} />
                        <span className="truncate">{(lesson.location as { name: string }).name}</span>
                      </div>
                    )}
                  </div>

                  {/* Status badge */}
                  <span className={`
                    text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0
                    ${isCompleted ? 'bg-teal/10 text-teal' : isCancelled ? 'bg-gray-100 text-gray-400' : 'bg-coral/10 text-coral'}
                  `}>
                    {isCompleted ? 'Done' : isCancelled ? 'Cancelled' : 'Pending'}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* View full day button */}
        {selectedLessons.length > 0 && (
          <div className="px-5 py-3 border-t border-gray-100">
            <button
              onClick={() => navigate(`/schedule?date=${selectedDate}`)}
              className="flex items-center gap-2 text-sm font-medium text-coral hover:text-coral/80 transition-colors"
            >
              Open full day view
              <ArrowRight size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
