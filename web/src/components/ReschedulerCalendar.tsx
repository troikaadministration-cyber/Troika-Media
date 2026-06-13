import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { PendingLesson } from '../types';

interface Props {
  lesson: PendingLesson | null;
  onDateSelect: (date: string) => void;
}

const DAY_HEADERS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildCalendarGrid(year: number, month: number): (Date | null)[][] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const firstDow = (firstDay.getDay() + 6) % 7; // Mon=0 ... Sun=6

  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const rows: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

export function ReschedulerCalendar({ lesson, onDateSelect }: Props) {
  const today = new Date();
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [lessonDates, setLessonDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!lesson) { setLessonDates(new Set()); return; }
    const monthStart = toDateStr(month);
    const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const monthEnd = toDateStr(lastDay);

    supabase
      .from('lessons')
      .select('date')
      .eq('teacher_id', lesson.teacher_id)
      .gte('date', monthStart)
      .lte('date', monthEnd)
      .neq('status', 'cancelled')
      .then(({ data }) => {
        setLessonDates(new Set((data ?? []).map((l: { date: string }) => l.date)));
      });
  }, [lesson?.teacher_id, month]);

  const todayStr = toDateStr(today);
  const rows = buildCalendarGrid(month.getFullYear(), month.getMonth());
  const monthLabel = month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  if (!lesson) {
    return (
      <div className="flex items-center justify-center min-h-[200px] bg-white rounded-xl border border-gray-100 p-4">
        <p className="text-sm text-gray-400">Select a lesson to see teacher availability</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <p className="text-xs font-medium text-gray-500 mb-3">
        {lesson.teacher.full_name} · {lesson.students[0]?.student?.full_name ?? ''}
      </p>

      <div className="flex items-center justify-between mb-3">
        <button onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))} className="p-1 hover:bg-gray-100 rounded-lg">
          <ChevronLeft size={16} className="text-gray-500" />
        </button>
        <span className="text-sm font-semibold text-navy">{monthLabel}</span>
        <button onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))} className="p-1 hover:bg-gray-100 rounded-lg">
          <ChevronRight size={16} className="text-gray-500" />
        </button>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {DAY_HEADERS.map(h => (
          <div key={h} className="text-center text-xs font-medium text-gray-400 py-1">{h}</div>
        ))}
      </div>

      <div className="space-y-1">
        {rows.map((row, ri) => (
          <div key={ri} className="grid grid-cols-7">
            {row.map((date, ci) => {
              if (!date) return <div key={ci} />;
              const dateStr = toDateStr(date);
              const isPast = dateStr < todayStr;
              const hasLesson = lessonDates.has(dateStr);
              const isToday = dateStr === todayStr;

              return (
                <button
                  key={ci}
                  onClick={() => !isPast && onDateSelect(dateStr)}
                  disabled={isPast}
                  className={`relative flex flex-col items-center justify-center py-1.5 rounded-lg text-sm transition-colors
                    ${isPast ? 'text-gray-300 cursor-not-allowed' : 'hover:bg-teal/10 cursor-pointer text-navy'}
                    ${isToday ? 'font-bold text-teal' : ''}
                  `}
                >
                  <span>{date.getDate()}</span>
                  {hasLesson && (
                    <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-coral" />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-4 mt-3 pt-2 border-t border-gray-100">
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <span className="inline-block w-2 h-2 rounded-full bg-coral" />
          Existing lesson
        </div>
        <span className="text-xs text-gray-400">Click any future date to reschedule</span>
      </div>
    </div>
  );
}
