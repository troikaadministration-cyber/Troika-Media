import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { StudentPiece, PieceStatus } from '@troika/shared';

export function useStudentPieces(studentId: string | undefined, teacherId: string | undefined) {
  const [pieces, setPieces] = useState<StudentPiece[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPieces = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);

    const { data, error } = await supabase
      .from('student_pieces')
      .select('*')
      .eq('student_id', studentId)
      .order('added_date', { ascending: false });

    if (!error && data) setPieces(data as StudentPiece[]);
    setLoading(false);
  }, [studentId]);

  useEffect(() => {
    fetchPieces();
  }, [fetchPieces]);

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
    const { error } = await supabase
      .from('student_pieces')
      .update({ status })
      .eq('id', pieceId);
    if (error) throw error;
    await fetchPieces();
  }

  async function deletePiece(pieceId: string) {
    const { error } = await supabase
      .from('student_pieces')
      .delete()
      .eq('id', pieceId);
    if (error) throw error;
    await fetchPieces();
  }

  return { pieces, loading, addPiece, updateStatus, deletePiece, refresh: fetchPieces };
}
