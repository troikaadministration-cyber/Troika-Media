import { supabase } from '../lib/supabase';
import { useQuery, unwrap, setQueryData } from '../lib/queryCache';
import type { StudentPiece, PieceStatus } from '../types';

const PIECE_COLUMNS = 'id, student_id, teacher_id, title, status, added_date, updated_at';

/**
 * A student's repertoire (as visible to the signed-in teacher via RLS).
 * Mutations update the cache directly and throw on failure so callers can
 * surface the error; failed optimistic changes are rolled back.
 */
export function useStudentPieces(studentId: string | undefined, teacherId: string | undefined) {
  const key = studentId ? `student-pieces:${studentId}` : null;

  const { data, loading, error, refresh } = useQuery<StudentPiece[]>(key, async () =>
    unwrap(await supabase
      .from('student_pieces')
      .select(PIECE_COLUMNS)
      .eq('student_id', studentId!)
      .order('added_date', { ascending: false })
      .limit(200), []) as StudentPiece[]);

  async function addPiece(title: string) {
    if (!key || !studentId || !teacherId) return;
    const { data: row, error: err } = await supabase
      .from('student_pieces')
      .insert({ student_id: studentId, teacher_id: teacherId, title, status: 'not_started' as PieceStatus })
      .select(PIECE_COLUMNS)
      .single();
    if (err) throw new Error(err.message);
    setQueryData<StudentPiece[]>(key, (prev = []) => [row as StudentPiece, ...prev]);
  }

  /** Apply `change` locally, run `write`, restore the previous list on error. */
  async function optimistic(change: (prev: StudentPiece[]) => StudentPiece[], write: () => PromiseLike<{ error: { message: string } | null }>) {
    if (!key) return;
    let before: StudentPiece[] | undefined;
    setQueryData<StudentPiece[]>(key, (prev = []) => { before = prev; return change(prev); });
    const { error: err } = await write();
    if (err) {
      setQueryData<StudentPiece[]>(key, () => before ?? []);
      throw new Error(err.message);
    }
  }

  const updateStatus = (pieceId: string, status: PieceStatus) =>
    optimistic(
      (prev) => prev.map((p) => (p.id === pieceId ? { ...p, status } : p)),
      () => supabase.from('student_pieces').update({ status }).eq('id', pieceId),
    );

  const deletePiece = (pieceId: string) =>
    optimistic(
      (prev) => prev.filter((p) => p.id !== pieceId),
      () => supabase.from('student_pieces').delete().eq('id', pieceId),
    );

  return { pieces: data ?? [], loading, error, addPiece, updateStatus, deletePiece, refresh };
}
