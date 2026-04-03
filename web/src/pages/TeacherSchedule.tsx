import { useState, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useTeacherLessons } from '../hooks/useTeacherLessons';
import { useStudentPieces } from '../hooks/useStudentPieces';
import { supabase } from '../lib/supabase';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useFocusTrap } from '../hooks/useFocusTrap';
import {
  ChevronLeft, ChevronRight, CheckCircle, MapPin, Music2, X,
  Upload, FileText, CloudUpload, Trash2, RefreshCw, Ban
} from 'lucide-react';
import type { PieceStatus } from '../types';

export function TeacherSchedulePage() {
  const { profile } = useAuth();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const { lessons, loading, error, markComplete, markPending, updateNotes, cancelLesson } = useTeacherLessons(profile?.id, selectedDate);
  const [cancelModal, setCancelModal] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [confirmDeletePiece, setConfirmDeletePiece] = useState<string | null>(null);

  // Modal state
  const [repertoireModal, setRepertoireModal] = useState<{ studentId: string; studentName: string } | null>(null);
  const [notesModal, setNotesModal] = useState<{ lessonId: string; currentNotes: string } | null>(null);
  const [mediaModal, setMediaModal] = useState<{ lessonId: string } | null>(null);
  const repertoireTrapRef = useFocusTrap(!!repertoireModal);
  const notesTrapRef = useFocusTrap(!!notesModal);
  const mediaTrapRef = useFocusTrap(!!mediaModal);
  const [expandedPieces, setExpandedPieces] = useState<Set<string>>(new Set());

  const { pieces, addPiece, updateStatus, deletePiece } = useStudentPieces(
    repertoireModal?.studentId, profile?.id
  );

  const [newPiece, setNewPiece] = useState('');
  const [noteText, setNoteText] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function shiftDate(days: number) {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toISOString().split('T')[0]);
  }

  const todayStr = new Date().toISOString().split('T')[0];
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
    if (!newPiece.trim()) return;
    await addPiece(newPiece.trim());
    setNewPiece('');
  };

  const cyclePieceStatus = async (pieceId: string, current: PieceStatus) => {
    const next: PieceStatus = current === 'not_started' ? 'in_progress' : current === 'in_progress' ? 'completed' : 'not_started';
    await updateStatus(pieceId, next);
  };

  const handleSaveNotes = async () => {
    if (!notesModal) return;
    await updateNotes(notesModal.lessonId, noteText);
    setNotesModal(null);
  };

  const ALLOWED_MEDIA_TYPES = [
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/webm',
  ];
  const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

  const handleUploadMedia = async (file: File) => {
    if (!mediaModal || !profile) return;
    if (!ALLOWED_MEDIA_TYPES.includes(file.type)) {
      alert('Only JPEG, PNG, WebP images and MP4, MOV, WebM videos are allowed.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      alert('File size must be under 100 MB.');
      return;
    }
    setUploading(true);
    const path = `${profile.id}/${mediaModal.lessonId}/${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from('lesson-media').upload(path, file);
    if (!error) {
      await supabase.from('media_uploads').insert({
        lesson_id: mediaModal.lessonId, teacher_id: profile.id,
        file_name: file.name, file_type: file.type, file_size: file.size, supabase_path: path,
      });
    }
    setUploading(false);
  };

  const pieceStatusClass = (status: PieceStatus) => {
    if (status === 'completed') return 'bg-teal text-white';
    if (status === 'in_progress') return 'bg-coral text-white';
    return 'bg-coral text-white';
  };

  const pieceStatusLabel = (status: PieceStatus) => {
    if (status === 'completed') return 'Completed';
    if (status === 'in_progress') return 'In Progress';
    return 'Not Started';
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Today's Overview */}
      <div className="bg-white rounded-xl border-l-4 border-coral p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-navy text-lg">Today's Overview</h2>
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
      <div className="bg-white rounded-xl border-l-4 border-yellow p-4 flex items-center justify-between">
        <h3 className="font-bold text-navy text-sm">Select Date</h3>
        <div className="flex items-center gap-2">
          <button onClick={() => shiftDate(-1)} className="p-1 rounded hover:bg-gray-100" aria-label="Previous day"><ChevronLeft size={18} /></button>
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm" />
          <button onClick={() => shiftDate(1)} className="p-1 rounded hover:bg-gray-100" aria-label="Next day"><ChevronRight size={18} /></button>
        </div>
      </div>

      {error && (
        <div className="bg-coral/10 border border-coral/20 rounded-xl p-4 flex items-center justify-between">
          <p className="text-coral text-sm">{error}</p>
          <button onClick={() => window.location.reload()} className="flex items-center gap-1 text-coral text-sm font-medium hover:underline"><RefreshCw size={14} />Retry</button>
        </div>
      )}

      {/* Lessons */}
      <h2 className="font-bold text-navy text-lg">Today's Classes</h2>

      {loading ? (
        <div className="text-center py-8 text-gray-400 text-sm">Loading...</div>
      ) : lessons.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">No classes on this day</div>
      ) : (
        <div className="space-y-4">
          {lessons.map((lesson) => {
            const student = lesson.students?.[0]?.student;
            const studentName = student?.full_name || 'Unknown';
            const studentId = lesson.students?.[0]?.student_id || '';
            const lessonPieces = expandedPieces.has(lesson.id);
            const isCompleted = lesson.status === 'completed';

            // Count completed lessons for this student (from lesson_students data)
            const completedBadge = lesson.students?.[0] ? `${lesson.students.length} student${lesson.students.length > 1 ? 's' : ''}` : '';

            return (
              <div key={lesson.id} className={`bg-white rounded-xl border-l-4 p-4 sm:p-5 ${isCompleted ? 'border-teal' : 'border-coral'}`}>
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-lg font-bold text-navy">{lesson.start_time?.slice(0, 5)}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${isCompleted ? 'bg-teal text-white' : 'bg-coral text-white'}`}>
                        {isCompleted ? 'Completed' : 'Pending'}
                      </span>
                    </div>
                    <h3 className="font-bold text-navy mt-1">{lesson.title}</h3>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-sm text-teal">{studentName}</span>
                      {completedBadge && (
                        <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{completedBadge}</span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => isCompleted ? markPending(lesson.id) : markComplete(lesson.id)}
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
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

                {/* Pieces section */}
                {studentId && (
                  <button onClick={() => togglePieces(lesson.id)}
                    className="mt-3 flex items-center gap-2 text-sm font-medium text-navy bg-cream/50 rounded-lg px-3 py-2 w-full text-left hover:bg-cream">
                    <Music2 size={14} className="text-yellow-600" />
                    Current Pieces
                  </button>
                )}

                {lessonPieces && pieces.length > 0 && (
                  <div className="mt-2 bg-cream/30 rounded-lg p-3 space-y-1.5">
                    {pieces.map((p) => (
                      <div key={p.id} className="flex items-center justify-between">
                        <span className="text-sm text-navy">{p.title}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${pieceStatusClass(p.status)}`}>
                          {pieceStatusLabel(p.status)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Notes */}
                {lesson.notes && (
                  <div className="mt-3 bg-yellow-light rounded-lg p-3 text-sm text-gray-700 italic">
                    {lesson.notes}
                  </div>
                )}

                {/* Action buttons */}
                <div className="grid grid-cols-4 gap-2 mt-4">
                  <button onClick={() => { setRepertoireModal({ studentId, studentName }); }}
                    className="flex flex-col items-center gap-1 py-2.5 rounded-lg bg-gray-50 hover:bg-gray-100 text-xs text-yellow-700 font-medium transition-colors">
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
                  {!isCompleted && (
                    <button onClick={() => setCancelModal(lesson.id)}
                      className="flex flex-col items-center gap-1 py-2.5 rounded-lg bg-gray-50 hover:bg-red-50 text-xs text-gray-400 hover:text-red-500 font-medium transition-colors">
                      <Ban size={16} /> Cancel
                    </button>
                  )}
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
        onConfirm={async () => { if (confirmDeletePiece) { await deletePiece(confirmDeletePiece); setConfirmDeletePiece(null); } }}
        onCancel={() => setConfirmDeletePiece(null)}
      />

      {/* Repertoire Modal */}
      {repertoireModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div ref={repertoireTrapRef} className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto border-t-4 border-yellow">
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
                <button onClick={handleAddPiece} className="px-3 py-2 bg-yellow text-white rounded-lg hover:bg-yellow/90 text-sm font-bold">+</button>
              </div>
              {pieces.map((p) => (
                <div key={p.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-navy">{p.title}</p>
                    <p className="text-xs text-teal">Added {p.added_date}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setConfirmDeletePiece(p.id)} className="text-coral/50 hover:text-coral" aria-label="Delete piece"><Trash2 size={14} /></button>
                    <button onClick={() => cyclePieceStatus(p.id, p.status)}
                      className={`text-[10px] px-2.5 py-1 rounded-full font-medium ${pieceStatusClass(p.status)}`}>
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
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div ref={notesTrapRef} className="bg-white rounded-2xl shadow-xl w-full max-w-md border-t-4 border-teal">
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
                <button onClick={handleSaveNotes} className="flex-1 py-2.5 rounded-lg bg-coral text-white text-sm font-medium hover:bg-coral/90">Save Note</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Lesson Modal */}
      {cancelModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-navy text-lg">Cancel Lesson</h3>
              <button onClick={() => { setCancelModal(null); setCancelReason(''); }} className="text-gray-400 hover:text-navy"><X size={20} /></button>
            </div>
            <p className="text-sm text-gray-500 mb-4">Are you sure you want to cancel this lesson?</p>
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-500 mb-1">Reason (optional)</label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm resize-none"
                rows={3}
                placeholder="Why are you cancelling?"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={async () => {
                  if (cancelModal && profile?.id) {
                    await cancelLesson(cancelModal, profile.id, cancelReason || undefined);
                  }
                  setCancelModal(null);
                  setCancelReason('');
                }}
                className="flex-1 bg-coral text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-coral/90"
              >
                Cancel Lesson
              </button>
              <button
                onClick={() => { setCancelModal(null); setCancelReason(''); }}
                className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200"
              >
                Keep Lesson
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Media Modal */}
      {mediaModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div ref={mediaTrapRef} className="bg-white rounded-2xl shadow-xl w-full max-w-md border-t-4 border-coral">
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
              <button onClick={() => fileRef.current?.click()}
                className="w-full py-2.5 rounded-lg bg-coral text-white text-sm font-medium hover:bg-coral/90">Choose Files</button>
              <button onClick={() => setMediaModal(null)}
                className="w-full py-2.5 rounded-lg bg-gray-100 text-navy text-sm font-medium hover:bg-gray-200">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
