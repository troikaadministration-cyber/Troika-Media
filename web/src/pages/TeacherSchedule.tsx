import { toDateStr, parseDateStr } from '../lib/dates';
import { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useTeacherLessons } from '../hooks/useTeacherLessons';
import { useStudentPieces } from '../hooks/useStudentPieces';
import { supabase } from '../lib/supabase';
import { setQueryData, errorMessage } from '../lib/queryCache';
import { useToast } from '../contexts/ToastContext';
import { ErrorBanner } from '../components/ErrorBanner';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useFocusTrap } from '../hooks/useFocusTrap';
import {
  ChevronLeft, ChevronRight, CheckCircle, MapPin, Music2, X,
  Upload, FileText, CloudUpload, Trash2, RefreshCw, UserCheck, UserX,
} from 'lucide-react';
import { SkeletonList } from '../components/Skeleton';
import type { LessonWithDetails, PieceStatus } from '../types';

const pieceStatusClass = (status: PieceStatus) =>
  status === 'completed' ? 'bg-teal text-white' : 'bg-coral text-white';

const pieceStatusLabel = (status: PieceStatus) =>
  status === 'completed' ? 'Completed' : status === 'in_progress' ? 'In Progress' : 'Not Started';

/** Inline "Current Pieces" list for one student (cached per student). */
function LessonPieces({ studentId, teacherId }: { studentId: string; teacherId?: string }) {
  const { pieces, loading, error } = useStudentPieces(studentId, teacherId);
  if (loading) return <div className="mt-2 bg-cream/30 rounded-lg p-3 text-xs text-gray-400">Loading pieces…</div>;
  if (error) return <div className="mt-2 bg-coral/10 rounded-lg p-3 text-xs text-coral">{error}</div>;
  if (pieces.length === 0) return <div className="mt-2 bg-cream/30 rounded-lg p-3 text-xs text-gray-400">No pieces yet</div>;
  return (
    <div className="mt-2 bg-cream/30 rounded-lg p-3 space-y-1.5">
      {pieces.map((p) => (
        <div key={p.id} className="flex items-center justify-between gap-2">
          <span className="text-sm text-navy min-w-0 break-words">{p.title}</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${pieceStatusClass(p.status)}`}>
            {pieceStatusLabel(p.status)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function TeacherSchedulePage() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  // `?date=YYYY-MM-DD` comes from the calendar's "Open full day view"; with no
  // (or an invalid) date we show today. Follows the URL, so the sidebar's
  // Schedule link returns to today.
  const urlDate = (() => {
    const d = searchParams.get('date');
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) && toDateStr(parseDateStr(d)) === d ? d : toDateStr(new Date());
  })();
  const [selectedDate, setSelectedDate] = useState(urlDate);
  useEffect(() => { setSelectedDate(urlDate); }, [urlDate]);
  const { lessons, loading, error, refresh, markComplete, markPending, updateNotes, markAttendance } = useTeacherLessons(profile?.id, selectedDate);
  const [confirmDeletePiece, setConfirmDeletePiece] = useState<string | null>(null);

  // Writes in flight, by action id — their buttons are disabled meanwhile.
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const busyRef = useRef(new Set<string>());
  async function run(id: string, fn: () => Promise<unknown>, failMsg: string): Promise<boolean> {
    if (busyRef.current.has(id)) return false;
    busyRef.current.add(id);
    setBusy(new Set(busyRef.current));
    try {
      await fn();
      return true;
    } catch (err) {
      showToast('error', `${failMsg}: ${errorMessage(err)}`);
      return false;
    } finally {
      busyRef.current.delete(id);
      setBusy(new Set(busyRef.current));
    }
  }

  // Optimistic edits to the cached day list (same key as useTeacherLessons).
  // On failure the hook's refresh restores the server state.
  const dayKey = profile ? `teacher-lessons:day:${profile.id}:${selectedDate}` : null;
  function patchLesson(lessonId: string, fn: (l: LessonWithDetails) => LessonWithDetails) {
    if (dayKey) setQueryData<LessonWithDetails[]>(dayKey, (prev = []) => prev.map((l) => (l.id === lessonId ? fn(l) : l)));
  }

  function toggleComplete(lesson: LessonWithDetails) {
    if (busyRef.current.has(`status:${lesson.id}`)) return;
    const done = lesson.status === 'completed';
    patchLesson(lesson.id, (l) => ({ ...l, status: done ? 'scheduled' : 'completed' }));
    void run(`status:${lesson.id}`, async () => {
      try { await (done ? markPending(lesson.id) : markComplete(lesson.id)); }
      catch (err) { void refresh(); throw err; }
    }, 'Could not update lesson');
  }

  function setAttendance(lessonId: string, lessonStudentId: string, attended: boolean | null) {
    if (busyRef.current.has(`att:${lessonStudentId}`)) return;
    patchLesson(lessonId, (l) => ({
      ...l,
      students: l.students?.map((ls) => (ls.id === lessonStudentId ? { ...ls, attended } : ls)),
    }));
    void run(`att:${lessonStudentId}`, async () => {
      try { await markAttendance(lessonStudentId, lessonId, attended); }
      catch (err) { void refresh(); throw err; }
    }, 'Could not save attendance');
  }

  // Modal state
  const [repertoireModal, setRepertoireModal] = useState<{ studentId: string; studentName: string } | null>(null);
  const [notesModal, setNotesModal] = useState<{ lessonId: string; currentNotes: string } | null>(null);
  const [mediaModal, setMediaModal] = useState<{ lessonId: string } | null>(null);
  const repertoireTrapRef = useFocusTrap(!!repertoireModal);
  const notesTrapRef = useFocusTrap(!!notesModal);
  const mediaTrapRef = useFocusTrap(!!mediaModal);
  const [expandedPieces, setExpandedPieces] = useState<Set<string>>(new Set());

  const { pieces, loading: piecesLoading, addPiece, updateStatus, deletePiece } = useStudentPieces(
    repertoireModal?.studentId, profile?.id
  );

  const [newPiece, setNewPiece] = useState('');
  const [noteText, setNoteText] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function shiftDate(days: number) {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() + days);
    setSelectedDate(toDateStr(d));
  }

  const todayStr = toDateStr(new Date());
  const isToday = selectedDate === todayStr;
  const dateLabel = new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const completedCount = lessons.filter((l) => l.status === 'completed').length;
  const remainingCount = lessons.length - completedCount;
  const progress = lessons.length > 0 ? Math.round((completedCount / lessons.length) * 100) : 0;

  const togglePieces = (lessonId: string) => {
    setExpandedPieces((prev) => {
      const next = new Set(prev);
      next.has(lessonId) ? next.delete(lessonId) : next.add(lessonId);
      return next;
    });
  };

  const handleAddPiece = async () => {
    const title = newPiece.trim();
    if (!title) return;
    if (await run('piece:add', () => addPiece(title), 'Could not add piece')) setNewPiece('');
  };

  const cyclePieceStatus = (pieceId: string, current: PieceStatus) => {
    const next: PieceStatus = current === 'not_started' ? 'in_progress' : current === 'in_progress' ? 'completed' : 'not_started';
    void run(`piece:${pieceId}`, () => updateStatus(pieceId, next), 'Could not update piece');
  };

  const handleSaveNotes = async () => {
    if (!notesModal) return;
    const { lessonId } = notesModal;
    if (await run(`notes:${lessonId}`, () => updateNotes(lessonId, noteText), 'Could not save notes')) setNotesModal(null);
  };

  const ALLOWED_MEDIA_TYPES = [
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/webm',
  ];
  const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

  const handleUploadMedia = async (file: File) => {
    if (!mediaModal || !profile) return;
    if (uploading) return;
    if (!ALLOWED_MEDIA_TYPES.includes(file.type)) {
      showToast('error', 'Only JPEG, PNG, WebP images and MP4, MOV, WebM videos are allowed.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      showToast('error', 'File size must be under 100 MB.');
      return;
    }
    setUploading(true);
    try {
      const path = `${profile.id}/${mediaModal.lessonId}/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from('lesson-media').upload(path, file);
      if (upErr) throw upErr;
      const { data: media, error: insErr } = await supabase.from('media_uploads').insert({
        lesson_id: mediaModal.lessonId, teacher_id: profile.id,
        file_name: file.name, file_type: file.type, file_size: file.size, supabase_path: path,
      }).select('id').single();
      if (insErr) throw insErr;
      // Fire-and-forget Drive sync; no-op if Drive isn't configured (row stays unsynced for retry).
      supabase.functions.invoke('sync-to-drive', { body: { media_id: media.id } }).catch(() => {});
      showToast('success', `Uploaded ${file.name}`);
    } catch (err) {
      showToast('error', `Upload failed: ${errorMessage(err)}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Today's Overview */}
      <div className="bg-white rounded-xl border-l-4 border-coral p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-navy text-lg">{isToday ? "Today's Overview" : 'Day Overview'}</h2>
          <span className="text-sm text-gray-500">{dateLabel}</span>
        </div>
        <div className="flex gap-3 mb-3">
          <div className="flex-1 bg-teal-light rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-teal">{completedCount}</p>
            <p className="text-xs text-teal">Completed</p>
          </div>
          <div className="flex-1 bg-coral-light rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-coral">{remainingCount}</p>
            <p className="text-xs text-coral">Remaining</p>
          </div>
        </div>
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-navy font-medium">Progress</span>
          <span className="text-gray-500">{progress}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div className="bg-teal h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Date picker */}
      <div className="bg-white rounded-xl border-l-4 border-yellow p-4 flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-bold text-navy text-sm">Select Date</h3>
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => shiftDate(-1)} className="p-1 rounded hover:bg-gray-100" aria-label="Previous day"><ChevronLeft size={18} /></button>
          <input type="date" value={selectedDate} onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
            className="px-2 sm:px-3 py-1.5 rounded-lg border border-gray-200 text-sm min-w-0" />
          <button onClick={() => shiftDate(1)} className="p-1 rounded hover:bg-gray-100" aria-label="Next day"><ChevronRight size={18} /></button>
          <button
            onClick={() => { void refresh(); }}
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-navy"
            aria-label="Refresh lessons"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => { void refresh(); }} />}

      {/* Lessons */}
      <h2 className="font-bold text-navy text-lg">{isToday ? "Today's Classes" : 'Classes'}</h2>

      {loading ? (
        <SkeletonList rows={4} />
      ) : lessons.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">No classes on this day</div>
      ) : (
        <div className="space-y-4">
          {lessons.map((lesson) => {
            const lessonStudents = lesson.students || [];
            const firstStudentId = lessonStudents[0]?.student_id || '';
            const firstStudentName = lessonStudents[0]?.student?.full_name || 'Unknown';
            const lessonPieces = expandedPieces.has(lesson.id);
            const isCompleted = lesson.status === 'completed';

            return (
              <div key={lesson.id} className={`bg-white rounded-xl border-l-4 p-4 sm:p-5 ${isCompleted ? 'border-teal' : 'border-coral'}`}>
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-lg font-bold text-navy">{lesson.start_time?.slice(0, 5)}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${isCompleted ? 'bg-teal text-white' : 'bg-coral text-white'}`}>
                        {isCompleted ? 'Completed' : 'Pending'}
                      </span>
                      {lessonStudents.length > 0 && (
                        <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                          {lessonStudents.length} student{lessonStudents.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <h3 className="font-bold text-navy mt-1">{lesson.title}</h3>
                  </div>
                  <button onClick={() => toggleComplete(lesson)}
                    disabled={busy.has(`status:${lesson.id}`)}
                    aria-label={isCompleted ? 'Mark pending' : 'Mark complete'}
                    className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-60 ${
                      isCompleted ? 'bg-teal text-white' : 'bg-gray-100 text-gray-400 hover:bg-teal/20 hover:text-teal'
                    }`}>
                    <CheckCircle size={22} />
                  </button>
                </div>

                {/* Location */}
                {lesson.location && (
                  <div className="flex items-center gap-1.5 mt-2 text-sm text-gray-500">
                    <MapPin size={14} className="text-coral" />
                    {(lesson.location as any).name}{(lesson.location as any).address ? `, ${(lesson.location as any).address}` : ''}
                  </div>
                )}

                {/* Per-student attendance */}
                {lessonStudents.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {lessonStudents.map((ls) => {
                      const name = ls.student?.full_name || 'Unknown';
                      const attended = ls.attended;
                      const saving = busy.has(`att:${ls.id}`);
                      return (
                        <div key={ls.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                          <span className="text-sm font-medium text-navy truncate">{name}</span>
                          <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                            <button
                              onClick={() => setAttendance(lesson.id, ls.id, attended === true ? null : true)}
                              disabled={saving}
                              title="Present"
                              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors disabled:opacity-60 ${
                                attended === true
                                  ? 'bg-teal text-white'
                                  : 'bg-gray-100 text-gray-400 hover:bg-teal/20 hover:text-teal'
                              }`}
                            >
                              <UserCheck size={13} /> Present
                            </button>
                            <button
                              onClick={() => setAttendance(lesson.id, ls.id, attended === false ? null : false)}
                              disabled={saving}
                              title="Absent"
                              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors disabled:opacity-60 ${
                                attended === false
                                  ? 'bg-coral text-white'
                                  : 'bg-gray-100 text-gray-400 hover:bg-coral/20 hover:text-coral'
                              }`}
                            >
                              <UserX size={13} /> Absent
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Pieces section */}
                {firstStudentId && (
                  <button onClick={() => togglePieces(lesson.id)}
                    className="mt-3 flex items-center gap-2 text-sm font-medium text-navy bg-cream/50 rounded-lg px-3 py-2 w-full text-left hover:bg-cream">
                    <Music2 size={14} className="text-yellow-600" />
                    Current Pieces
                  </button>
                )}

                {lessonPieces && firstStudentId && (
                  <LessonPieces studentId={firstStudentId} teacherId={profile?.id} />
                )}

                {/* Notes */}
                {lesson.notes && (
                  <div className="mt-3 bg-yellow-light rounded-lg p-3 text-sm text-gray-700 italic">
                    {lesson.notes}
                  </div>
                )}

                {/* Action buttons */}
                <div className="grid grid-cols-4 gap-2 mt-4">
                  <button onClick={() => { setRepertoireModal({ studentId: firstStudentId, studentName: firstStudentName }); }}
                    disabled={!firstStudentId}
                    className="flex flex-col items-center gap-1 py-2.5 rounded-lg bg-gray-50 hover:bg-gray-100 text-xs text-yellow-700 font-medium transition-colors disabled:opacity-40">
                    <Music2 size={16} /> Pieces
                  </button>
                  <button onClick={() => { setNotesModal({ lessonId: lesson.id, currentNotes: lesson.notes || '' }); setNoteText(lesson.notes || ''); }}
                    className="flex flex-col items-center gap-1 py-2.5 rounded-lg bg-gray-50 hover:bg-gray-100 text-xs text-teal font-medium transition-colors">
                    <FileText size={16} /> Notes
                  </button>
                  <button onClick={() => setMediaModal({ lessonId: lesson.id })}
                    className="flex flex-col items-center gap-1 py-2.5 rounded-lg bg-gray-50 hover:bg-gray-100 text-xs text-coral font-medium transition-colors">
                    <Upload size={16} /> Media
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDeletePiece}
        title="Delete Piece"
        message="Are you sure you want to remove this piece from the student's repertoire?"
        onConfirm={() => {
          const id = confirmDeletePiece;
          setConfirmDeletePiece(null);
          if (id) void run(`piece:${id}`, () => deletePiece(id), 'Could not delete piece');
        }}
        onCancel={() => setConfirmDeletePiece(null)}
      />

      {/* Repertoire Modal */}
      {repertoireModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div ref={repertoireTrapRef} className="bg-white rounded-2xl border border-black/5 shadow-lg w-full max-w-md max-h-[85vh] overflow-y-auto border-t-4 border-yellow">
            <div className="px-5 py-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-navy text-lg">Repertoire</h3>
                <p className="text-sm text-teal">{repertoireModal.studentName}</p>
              </div>
              <button onClick={() => setRepertoireModal(null)} className="text-gray-400 hover:text-navy"><X size={20} /></button>
            </div>
            <div className="px-5 pb-5 space-y-3">
              <div className="flex gap-2">
                <input value={newPiece} onChange={(e) => setNewPiece(e.target.value)} placeholder="Enter piece name..."
                  className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm" onKeyDown={(e) => e.key === 'Enter' && handleAddPiece()} />
                <button onClick={handleAddPiece} disabled={busy.has('piece:add') || !newPiece.trim()} aria-label="Add piece"
                  className="px-3 py-2 bg-yellow text-white rounded-lg hover:bg-yellow/90 text-sm font-bold disabled:opacity-50">+</button>
              </div>
              {piecesLoading && <p className="text-xs text-gray-400">Loading pieces…</p>}
              {pieces.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-navy break-words">{p.title}</p>
                    <p className="text-xs text-teal">Added {p.added_date}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => setConfirmDeletePiece(p.id)} disabled={busy.has(`piece:${p.id}`)} className="text-coral/50 hover:text-coral disabled:opacity-50" aria-label="Delete piece"><Trash2 size={14} /></button>
                    <button onClick={() => cyclePieceStatus(p.id, p.status)} disabled={busy.has(`piece:${p.id}`)}
                      className={`text-[10px] px-2.5 py-1 rounded-full font-medium disabled:opacity-60 ${pieceStatusClass(p.status)}`}>
                      {pieceStatusLabel(p.status)}
                    </button>
                  </div>
                </div>
              ))}
              <div className="flex gap-3 pt-2">
                <button onClick={() => setRepertoireModal(null)} className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600">Cancel</button>
                <button onClick={() => setRepertoireModal(null)} className="flex-1 py-2.5 rounded-lg bg-yellow text-white text-sm font-medium hover:bg-yellow/90">Save Changes</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notes Modal */}
      {notesModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div ref={notesTrapRef} className="bg-white rounded-2xl border border-black/5 shadow-lg w-full max-w-md border-t-4 border-teal">
            <div className="px-5 py-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-navy text-lg">Class Notes</h3>
                <p className="text-sm text-gray-500">Add your notes for this class</p>
              </div>
              <button onClick={() => setNotesModal(null)} className="text-gray-400 hover:text-navy"><X size={20} /></button>
            </div>
            <div className="px-5 pb-5 space-y-3">
              <textarea value={noteText} onChange={(e) => setNoteText(e.target.value.slice(0, 500))} rows={6}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm resize-none focus:ring-2 focus:ring-teal/30 focus:border-teal outline-none"
                placeholder="Enter class notes, student progress, homework assignments, or any observations..." />
              <div className="flex items-center justify-between text-xs">
                <span className="text-teal">Max 500 characters</span>
                <span className="text-gray-400">{noteText.length}/500</span>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setNotesModal(null)} className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600">Cancel</button>
                <button onClick={handleSaveNotes} disabled={busy.has(`notes:${notesModal.lessonId}`)}
                  className="flex-1 py-2.5 rounded-lg bg-coral text-white text-sm font-medium hover:bg-coral/90 disabled:opacity-60">
                  {busy.has(`notes:${notesModal.lessonId}`) ? 'Saving…' : 'Save Note'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Media Modal */}
      {mediaModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div ref={mediaTrapRef} className="bg-white rounded-2xl border border-black/5 shadow-lg w-full max-w-md border-t-4 border-coral">
            <div className="px-5 py-4 flex items-center justify-between">
              <h3 className="font-bold text-navy text-lg">Upload Media</h3>
              <button onClick={() => setMediaModal(null)} className="text-gray-400 hover:text-navy"><X size={20} /></button>
            </div>
            <div className="px-5 pb-5 space-y-4">
              <div
                className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-coral/50 transition-colors"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleUploadMedia(f); }}
              >
                <div className="w-14 h-14 bg-coral/10 rounded-full flex items-center justify-center mx-auto mb-3">
                  <CloudUpload size={24} className="text-coral" />
                </div>
                <p className="font-medium text-navy">Upload Photos or Videos</p>
                <p className="text-sm text-teal mt-1">Drag and drop files here, or click to browse</p>
                {uploading && <p className="text-sm text-coral mt-2 animate-pulse">Uploading...</p>}
              </div>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadMedia(f); }} />
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                className="w-full py-2.5 rounded-lg bg-coral text-white text-sm font-medium hover:bg-coral/90 disabled:opacity-60">
                {uploading ? 'Uploading…' : 'Choose Files'}
              </button>
              <button onClick={() => setMediaModal(null)}
                className="w-full py-2.5 rounded-lg bg-gray-100 text-navy text-sm font-medium hover:bg-gray-200">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
