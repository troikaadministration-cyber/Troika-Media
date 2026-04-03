import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
import {
  X, Clock, MapPin, Music, Calendar, User, Loader2, ArrowRight
} from 'lucide-react';
import type { LessonWithDetails } from '../types';

interface MakeupMatch {
  id: string;
  full_name: string;
  instrument: string | null;
  location_name: string | null;
  zone: string;
  match_score: number;
  same_location: boolean;
  same_zone: boolean;
  charged_absences: number;
  needs_makeup: boolean;
}

interface TeacherSlot {
  start_time: string;
  end_time: string | null;
  title: string;
  status: string;
}

interface MatchData {
  lesson: {
    id: string;
    date: string;
    start_time: string;
    end_time: string | null;
    teacher: string;
    location: string;
    instrument: string;
  };
  cancelled_students: string[];
  teacher_schedule: TeacherSlot[];
  matches: MakeupMatch[];
}

interface MakeupMatchPanelProps {
  lesson: LessonWithDetails;
  onClose: () => void;
  onScheduled: () => void;
}

export function MakeupMatchPanel({ lesson, onClose, onScheduled }: MakeupMatchPanelProps) {
  const [data, setData] = useState<MatchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<string | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    fetchMatches();
  }, [lesson.id]);

  async function fetchMatches() {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke('find-makeup-matches', {
        body: { lesson_id: lesson.id },
      });
      if (res.error) throw res.error;
      setData(res.data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch matches');
    } finally {
      setLoading(false);
    }
  }

  async function scheduleMakeup(studentId: string, studentName: string) {
    setScheduling(studentId);
    try {
      // Create a makeup lesson with same date/time/location/teacher
      const { data: newLesson, error: createErr } = await supabase
        .from('lessons')
        .insert({
          teacher_id: lesson.teacher_id,
          location_id: lesson.location_id,
          instrument_id: lesson.instrument_id,
          lesson_type: 'makeup',
          status: 'scheduled',
          date: lesson.date,
          start_time: lesson.start_time,
          end_time: lesson.end_time,
          title: `Makeup: ${lesson.title}`,
        })
        .select()
        .single();

      if (createErr) throw createErr;

      // Add the student to the lesson
      await supabase.from('lesson_students').insert({
        lesson_id: newLesson.id,
        student_id: studentId,
      });

      // Send notification if student has a user_id
      const { data: student } = await supabase
        .from('students')
        .select('user_id')
        .eq('id', studentId)
        .single();

      if (student?.user_id) {
        await supabase.from('notifications').insert({
          user_id: student.user_id,
          type: 'makeup_available',
          title: 'Makeup Lesson Scheduled',
          body: `A makeup lesson has been scheduled for you on ${lesson.date} at ${lesson.start_time?.slice(0, 5)}.`,
        });
      }

      showToast('success', `Makeup lesson scheduled for ${studentName}`);
      onScheduled();
      onClose();
    } catch (err: any) {
      showToast('error', err.message || 'Failed to schedule makeup');
    } finally {
      setScheduling(null);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-navy">Find Makeup Match</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-navy"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Lesson info */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-2">
            <p className="text-sm font-semibold text-navy">{lesson.title}</p>
            <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
              <span className="flex items-center gap-1"><Calendar size={12} />{lesson.date}</span>
              <span className="flex items-center gap-1"><Clock size={12} />{lesson.start_time?.slice(0, 5)}{lesson.end_time ? ` - ${lesson.end_time.slice(0, 5)}` : ''}</span>
              {lesson.location?.name && <span className="flex items-center gap-1"><MapPin size={12} />{lesson.location.name}</span>}
              {lesson.teacher?.full_name && <span className="flex items-center gap-1"><User size={12} />{lesson.teacher.full_name}</span>}
              {lesson.instrument?.name && <span className="flex items-center gap-1"><Music size={12} />{lesson.instrument.name}</span>}
            </div>
            {data?.cancelled_students && data.cancelled_students.length > 0 && (
              <p className="text-xs text-gray-400">Cancelled: {data.cancelled_students.join(', ')}</p>
            )}
          </div>

          {/* Teacher's day timeline */}
          {data?.teacher_schedule && data.teacher_schedule.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">Teacher's schedule that day</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {data.teacher_schedule.map((slot, i) => (
                  <div key={i} className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs ${
                    slot.status === 'cancelled' ? 'bg-gray-100 text-gray-400 line-through' :
                    slot.status === 'completed' ? 'bg-teal/10 text-teal' :
                    'bg-coral/5 text-navy'
                  }`}>
                    <span className="font-semibold">{slot.start_time?.slice(0, 5)}</span>
                    {slot.end_time && <span> - {slot.end_time.slice(0, 5)}</span>}
                    <span className="ml-1.5 text-gray-500">{slot.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Loading / Error */}
          {loading && (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <Loader2 size={20} className="animate-spin mr-2" /> Finding matches...
            </div>
          )}

          {error && (
            <div className="bg-coral/10 border border-coral/20 rounded-xl p-4 text-sm text-coral">{error}</div>
          )}

          {/* Match list */}
          {!loading && !error && data && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">
                {data.matches.length > 0 ? `${data.matches.length} potential matches` : 'No matches found'}
              </p>
              <div className="space-y-2">
                {data.matches.map((match) => (
                  <div key={match.id} className="border border-gray-100 rounded-xl p-3 hover:border-gray-200 transition-colors">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-navy">{match.full_name}</p>
                          {match.instrument && <span className="text-xs text-gray-400">{match.instrument}</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {match.location_name && (
                            <span className="text-xs text-gray-500 flex items-center gap-0.5">
                              <MapPin size={10} />{match.location_name}
                              {match.zone && <span className="text-gray-400"> ({match.zone})</span>}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          {match.same_location && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-teal/10 text-teal">Same Location</span>
                          )}
                          {match.same_zone && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-600">Same Zone</span>
                          )}
                          {match.needs_makeup && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-orange-50 text-orange-600">
                              Needs Makeup ({match.charged_absences})
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => scheduleMakeup(match.id, match.full_name)}
                        disabled={scheduling === match.id}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-coral text-white text-xs font-medium hover:bg-coral/90 disabled:opacity-50 flex-shrink-0"
                      >
                        {scheduling === match.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <>Schedule <ArrowRight size={12} /></>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
