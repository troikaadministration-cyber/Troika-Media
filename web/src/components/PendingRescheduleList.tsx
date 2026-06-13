import React from 'react';
import { ChevronRight, Zap, Loader2 } from 'lucide-react';
import type { PendingLesson } from '../types';

interface BreakGroup {
  breakId: string;
  breakTitle: string;
  isSchoolWide: boolean;
  lessons: PendingLesson[];
}

interface Props {
  lessons: PendingLesson[];
  selectedLessonId: string | null;
  onSelectLesson: (lesson: PendingLesson) => void;
  onAutoReschedule: (breakId: string) => void;
  autoRescheduleLoadingId: string | null;
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatOriginalDate(date: string, startTime: string): string {
  const d = new Date(date + 'T00:00');
  const formatted = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `${DAY_SHORT[d.getDay()]} ${formatted} · ${startTime.slice(0, 5)}`;
}

export function PendingRescheduleList({
  lessons,
  selectedLessonId,
  onSelectLesson,
  onAutoReschedule,
  autoRescheduleLoadingId,
}: Props) {
  const groups: BreakGroup[] = [];
  const seen = new Map<string, BreakGroup>();

  for (const lesson of lessons) {
    const key = lesson.source_break_id;
    if (!seen.has(key)) {
      const group: BreakGroup = {
        breakId: key,
        breakTitle: lesson.break.title,
        isSchoolWide: lesson.break.student_ids.length === 0,
        lessons: [],
      };
      seen.set(key, group);
      groups.push(group);
    }
    seen.get(key)!.lessons.push(lesson);
  }

  return (
    <div className="space-y-4 overflow-y-auto">
      {groups.map(group => (
        <div key={group.breakId} className="border border-gray-100 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-white border-b border-gray-100">
            <span className="text-base">{group.isSchoolWide ? '🏫' : '👤'}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-navy truncate">{group.breakTitle}</p>
              <p className="text-xs text-gray-500">
                {group.isSchoolWide ? 'School-wide' : 'Individual'} · {group.lessons.length} pending
              </p>
            </div>
          </div>

          <div className="divide-y divide-gray-100 bg-gray-50">
            {group.lessons.map(lesson => {
              const studentName = lesson.students[0]?.student?.full_name ?? 'Unknown Student';
              const extraStudents = lesson.students.length - 1;
              const isSelected = selectedLessonId === lesson.id;

              return (
                <button
                  key={lesson.id}
                  onClick={() => onSelectLesson(lesson)}
                  className={`w-full text-left flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white ${
                    isSelected ? 'bg-white border-l-2 border-teal' : ''
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-navy">
                      {studentName}
                      {extraStudents > 0 && <span className="text-gray-400 font-normal"> +{extraStudents}</span>}
                      <span className="text-gray-400 font-normal"> — {lesson.teacher.full_name}</span>
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {lesson.instrument ? `${lesson.instrument.icon ?? ''} ${lesson.instrument.name} · ` : ''}
                      {formatOriginalDate(lesson.date, lesson.start_time)}
                    </p>
                  </div>
                  <ChevronRight size={14} className={isSelected ? 'text-teal flex-shrink-0' : 'text-gray-300 flex-shrink-0'} />
                </button>
              );
            })}
          </div>

          <div className="px-4 py-3 bg-white border-t border-gray-100">
            <button
              onClick={() => onAutoReschedule(group.breakId)}
              disabled={autoRescheduleLoadingId === group.breakId}
              className="flex items-center gap-2 text-xs font-semibold text-teal hover:text-teal/80 disabled:opacity-50"
            >
              {autoRescheduleLoadingId === group.breakId
                ? <Loader2 size={12} className="animate-spin" />
                : <Zap size={12} />}
              Auto-Reschedule After Break
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
