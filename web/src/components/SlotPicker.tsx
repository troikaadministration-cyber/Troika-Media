// web/src/components/SlotPicker.tsx
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Instrument, TeacherScheduleTemplate } from '../types';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type SelectedSlot = {
  mode: 'existing';
  templateId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string | null;
  instrumentId: string | null;
  title: string;
} | {
  mode: 'new';
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  instrumentId: string | null;
  title: string;
};

interface SlotPickerProps {
  teacherId: string;
  instruments: Instrument[];
  value: SelectedSlot | null;
  onChange: (slot: SelectedSlot | null) => void;
}

export function SlotPicker({ teacherId, instruments, value, onChange }: SlotPickerProps) {
  const [templates, setTemplates] = useState<TeacherScheduleTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [newSlot, setNewSlot] = useState({
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '10:00',
    instrumentId: '',
    title: '',
  });

  // Fix 1 & 2 — Race condition guard + always run setLoading(false), destructure error
  useEffect(() => {
    if (!teacherId) { setTemplates([]); return; }
    let ignore = false;
    setLoading(true);
    supabase
      .from('teacher_schedule_templates')
      .select('*')
      .eq('teacher_id', teacherId)
      .eq('is_active', true)
      .order('day_of_week')
      .order('start_time')
      .then(({ data, error }) => {
        if (ignore) return;
        if (error) {
          setFetchError(error.message);
          setTemplates([]);
        } else {
          setFetchError(null);
          setTemplates((data as TeacherScheduleTemplate[]) ?? []);
        }
        setLoading(false);
      });
    return () => { ignore = true; };
  }, [teacherId]);

  // Fix 3 — Reset newSlot to defaults when value becomes null externally
  useEffect(() => {
    if (!value) {
      setNewSlot({ dayOfWeek: 1, startTime: '09:00', endTime: '10:00', instrumentId: '', title: '' });
    }
  }, [value]);

  const isNewSelected = value?.mode === 'new';

  function selectExisting(tpl: TeacherScheduleTemplate) {
    onChange({
      mode: 'existing',
      templateId: tpl.id,
      dayOfWeek: tpl.day_of_week,
      startTime: tpl.start_time,
      endTime: tpl.end_time,
      instrumentId: tpl.instrument_id,
      title: tpl.title,
    });
  }

  function updateNewSlot(patch: Partial<typeof newSlot>) {
    const updated = { ...newSlot, ...patch };
    setNewSlot(updated);
    onChange({
      mode: 'new',
      dayOfWeek: updated.dayOfWeek,
      startTime: updated.startTime,
      endTime: updated.endTime,
      instrumentId: updated.instrumentId || null,
      title: updated.title,
    });
  }

  if (loading) return <p className="text-sm text-gray-400">Loading slots...</p>;
  if (fetchError) return <p className="text-xs text-red-500">Failed to load slots: {fetchError}</p>;

  const byDay: Record<number, TeacherScheduleTemplate[]> = {};
  for (const t of templates) {
    if (!byDay[t.day_of_week]) byDay[t.day_of_week] = [];
    byDay[t.day_of_week].push(t);
  }

  return (
    <div className="space-y-2">
      {templates.length === 0 && (
        <p className="text-xs text-gray-400 mb-2">No existing slots for this teacher — create one below.</p>
      )}

      {[1, 2, 3, 4, 5, 6, 0].map((day) => {
        const slots = byDay[day];
        if (!slots) return null;
        return (
          <div key={day}>
            <p className="text-xs font-semibold text-gray-500 mb-1">{DAY_NAMES[day]}</p>
            {slots.map((tpl) => {
              const inst = instruments.find(i => i.id === tpl.instrument_id);
              const isSelected = value?.mode === 'existing' && value.templateId === tpl.id;
              return (
                <label
                  key={tpl.id}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer mb-1 transition-colors ${
                    isSelected ? 'border-teal bg-teal/5' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {/* Fix 5 — Scope radio name to instance */}
                  <input
                    type="radio"
                    name={`slot-${teacherId}`}
                    checked={isSelected}
                    onChange={() => selectExisting(tpl)}
                    className="text-teal"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-navy">
                      {tpl.start_time.slice(0, 5)}
                      {tpl.end_time ? ` – ${tpl.end_time.slice(0, 5)}` : ''}
                    </span>
                    <span className="text-sm text-gray-500 ml-2">{tpl.title || 'Lesson'}</span>
                    {inst && <span className="text-sm ml-1">{inst.icon}</span>}
                  </div>
                </label>
              );
            })}
          </div>
        );
      })}

      {/* Fix 4 — Replace outer <label> with <div> to avoid nested <label> elements */}
      <div
        className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
          isNewSelected ? 'border-coral bg-coral/5' : 'border-gray-200 hover:border-gray-300'
        }`}
      >
        {/* Fix 5 — Scope radio name to instance */}
        <input
          type="radio"
          name={`slot-${teacherId}`}
          checked={isNewSelected}
          onChange={() => updateNewSlot({})}
          className="mt-0.5 text-coral cursor-pointer"
        />
        <div className="flex-1">
          <p
            className="text-sm font-medium text-navy mb-2 cursor-pointer"
            onClick={() => !isNewSelected && updateNewSlot({})}
          >+ Create new slot</p>
          {isNewSelected && (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Day</label>
                  <select
                    value={newSlot.dayOfWeek}
                    onChange={(e) => updateNewSlot({ dayOfWeek: Number(e.target.value) })}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  >
                    {[1, 2, 3, 4, 5, 6, 0].map(d => (
                      <option key={d} value={d}>{DAY_NAMES[d]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Start</label>
                  <input
                    type="time"
                    value={newSlot.startTime}
                    onChange={(e) => updateNewSlot({ startTime: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">End</label>
                  <input
                    type="time"
                    value={newSlot.endTime}
                    onChange={(e) => updateNewSlot({ endTime: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Instrument</label>
                  <select
                    value={newSlot.instrumentId}
                    onChange={(e) => updateNewSlot({ instrumentId: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  >
                    <option value="">None</option>
                    {instruments.map(i => (
                      <option key={i.id} value={i.id}>{i.icon} {i.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Title</label>
                  <input
                    value={newSlot.title}
                    onChange={(e) => updateNewSlot({ title: e.target.value })}
                    placeholder="e.g. Piano Lesson"
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
