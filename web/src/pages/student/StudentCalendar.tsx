import { useState } from 'react';
import { ChevronLeft, ChevronRight, CheckCircle, XCircle, Clock } from 'lucide-react';
import { useStudentPortal } from './StudentPortalContext';

export function StudentCalendar() {
  const { upcoming, past } = useStudentPortal();
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const allLessons = [...upcoming, ...past];
  const year = calMonth.getFullYear();
  const month = calMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayStr = new Date().toISOString().split('T')[0];

  const lessonsByDate: Record<string, typeof allLessons> = {};
  for (const item of allLessons) {
    const d = item.lesson.date;
    if (!lessonsByDate[d]) lessonsByDate[d] = [];
    lessonsByDate[d].push(item);
  }

  const cells: { day: number; dateStr: string }[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ day: d, dateStr });
  }

  const monthLessons = allLessons
    .filter((l) => l.lesson.date.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`))
    .sort((a, b) => a.lesson.date.localeCompare(b.lesson.date));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-navy">Calendar</h1>
        <p className="text-gray-500 text-sm mt-1">All your lessons, month by month.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <button onClick={() => setCalMonth(new Date(year, month - 1, 1))} className="p-1.5 rounded-lg hover:bg-gray-100" aria-label="Previous month">
            <ChevronLeft size={18} className="text-gray-500" />
          </button>
          <h2 className="font-semibold text-navy">
            {calMonth.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
          </h2>
          <button onClick={() => setCalMonth(new Date(year, month + 1, 1))} className="p-1.5 rounded-lg hover:bg-gray-100" aria-label="Next month">
            <ChevronRight size={18} className="text-gray-500" />
          </button>
        </div>

        <div className="p-4">
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-px mb-1">
            {dayNames.map((d) => (
              <div key={d} className="text-center text-[10px] font-medium text-gray-400 py-1">{d}</div>
            ))}
          </div>

          {/* Grid */}
          <div className="grid grid-cols-7 gap-px">
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`e${i}`} className="h-12" />
            ))}
            {cells.map(({ day, dateStr }) => {
              const dayLessons = lessonsByDate[dateStr] || [];
              const isToday = dateStr === todayStr;
              const hasLesson = dayLessons.length > 0;
              const allAttended = hasLesson && dayLessons.every((l) => l.attended === true);
              const anyMissed = hasLesson && dayLessons.some((l) => l.attended === false);

              return (
                <div
                  key={day}
                  className={`h-12 rounded-lg flex flex-col items-center justify-center relative transition-colors ${
                    isToday ? 'bg-coral/10 ring-1 ring-coral'
                      : hasLesson && dateStr >= todayStr ? 'bg-teal/5'
                      : ''
                  }`}
                >
                  <span className={`text-xs font-medium ${
                    isToday ? 'text-coral' : hasLesson ? 'text-navy' : 'text-gray-400'
                  }`}>{day}</span>
                  {hasLesson && (
                    <div className="flex gap-0.5 mt-0.5">
                      {dayLessons.map((l, i) => (
                        <div
                          key={i}
                          className={`w-1.5 h-1.5 rounded-full ${
                            allAttended ? 'bg-teal'
                              : anyMissed ? 'bg-coral'
                              : l.lesson.status === 'cancelled' ? 'bg-gray-300'
                              : 'bg-teal'
                          }`}
                          title={`${l.lesson.start_time?.slice(0, 5)} - ${l.lesson.title}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-4 pt-3 border-t border-gray-100 justify-center">
            <div className="flex items-center gap-1.5 text-[10px] text-gray-500"><div className="w-2 h-2 rounded-full bg-teal" />Attended</div>
            <div className="flex items-center gap-1.5 text-[10px] text-gray-500"><div className="w-2 h-2 rounded-full bg-coral" />Missed</div>
            <div className="flex items-center gap-1.5 text-[10px] text-gray-500"><div className="w-2 h-2 rounded-full bg-teal/50" />Upcoming</div>
          </div>

          {/* This month's lessons */}
          {monthLessons.length === 0 ? (
            <p className="text-center text-gray-400 text-sm mt-4">No lessons this month</p>
          ) : (
            <div className="mt-4 divide-y divide-gray-50">
              {monthLessons.map((item) => {
                const teacher = (item.lesson.teacher as any)?.full_name as string | undefined;
                const location = (item.lesson.location as any)?.name as string | undefined;
                return (
                  <div key={item.id} className="flex items-center gap-3 py-3">
                    <div className="text-center flex-shrink-0 w-10">
                      <p className="text-xs font-bold text-navy">{new Date(item.lesson.date + 'T00:00:00').getDate()}</p>
                      <p className="text-[10px] text-gray-400">{new Date(item.lesson.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' })}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-navy truncate">{item.lesson.title}</p>
                      <p className="text-[10px] text-gray-500">
                        {item.lesson.start_time?.slice(0, 5)}
                        {teacher && ` · ${teacher}`}
                        {location && ` · ${location}`}
                      </p>
                    </div>
                    <div className="flex-shrink-0">
                      {item.attended === true && <CheckCircle size={14} className="text-teal" />}
                      {item.attended === false && <XCircle size={14} className="text-coral" />}
                      {item.attended === null && item.lesson.date >= todayStr && <Clock size={14} className="text-gray-300" />}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
