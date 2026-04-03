import { useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';

export function useMediaUpload(lessonId: string, teacherId: string) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickAndUpload() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Permission to access media library is required');
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.8,
      allowsMultipleSelection: false,
    });

    if (result.canceled || !result.assets?.[0]) return null;

    const asset = result.assets[0];
    setUploading(true);
    setError(null);

    try {
      const ext = asset.uri.split('.').pop() || 'jpg';
      const fileName = `${Date.now()}.${ext}`;
      const filePath = `${teacherId}/${lessonId}/${fileName}`;

      const response = await fetch(asset.uri);
      const blob = await response.blob();

      const { error: uploadError } = await supabase.storage
        .from('lesson-media')
        .upload(filePath, blob, {
          contentType: asset.mimeType || 'image/jpeg',
        });

      if (uploadError) throw uploadError;

      const { error: dbError } = await supabase.from('media_uploads').insert({
        lesson_id: lessonId,
        teacher_id: teacherId,
        file_name: fileName,
        file_type: asset.mimeType || 'image/jpeg',
        file_size: asset.fileSize || 0,
        supabase_path: filePath,
      });

      if (dbError) throw dbError;

      return filePath;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setUploading(false);
    }
  }

  return { pickAndUpload, uploading, error };
}
