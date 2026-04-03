import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { StudentPiece, PieceStatus } from '../types';

export function useStudentPieces(studentId: string | undefined, teacherId: string | undefined) {
  const [pieces, setPieces] = useState<StudentPiece[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPieces = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('student_pieces')
        .select('*')
        .eq('student_id', studentId)
        .order('added_date', { ascending: false });
      if (err) throw err;
      if (data) setPieces(data as StudentPiece[]);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch pieces');
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => { fetchPieces(); }, [fetchPieces]);

  async function addPiece(title: string) {
    if (!studentId || !teacherId) return;
    const { error } = await supabase.from('student_pieces').insert({
      student_id: studentId,
      teacher_id: teacherId,
      title,
      status: 'not_started' as PieceStatus,
    });
    if (error) throw error;
    await fetchPieces();
  }

  async function updateStatus(pieceId: string, status: PieceStatus) {
    await supabase.from('student_pieces').update({ status }).eq('id', pieceId);
    await fetchPieces();
  }

  async function deletePiece(pieceId: string) {
    await supabase.from('student_pieces').delete().eq('id', pieceId);
    await fetchPieces();
  }

  return { pieces, loading, error, addPiece, updateStatus, deletePiece, refresh: fetchPieces };
}
