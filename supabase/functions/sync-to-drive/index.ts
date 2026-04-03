// Supabase Edge Function: Sync media uploads to Google Drive

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';

const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN') || '';

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allowed = allowedOrigin && origin === allowedOrigin ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) throw new Error('Unauthorized');

    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) throw new Error('Unauthorized');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { media_id } = await req.json();
    if (!media_id) throw new Error('media_id is required');

    const { data: media, error: mediaError } = await supabase
      .from('media_uploads')
      .select('*, lesson:lessons(date, teacher:profiles!lessons_teacher_id_fkey(full_name), students:lesson_students(student:students(full_name)))')
      .eq('id', media_id)
      .single();

    if (mediaError || !media) throw new Error(`Media not found: ${mediaError?.message}`);

    const { data: fileData, error: downloadError } = await supabase.storage
      .from('lesson-media')
      .download(media.supabase_path);

    if (downloadError || !fileData) throw new Error(`Download failed: ${downloadError?.message}`);

    const teacherName = media.lesson?.teacher?.full_name || 'Unknown Teacher';
    const lessonDate = media.lesson?.date || 'Unknown Date';
    const studentName = media.lesson?.students?.[0]?.student?.full_name || 'Unknown Student';
    const folderName = `${lessonDate}-${studentName}`;

    const serviceAccountJson = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || '{}');
    const folderId = Deno.env.get('GOOGLE_DRIVE_FOLDER_ID');

    if (!serviceAccountJson.client_email || !folderId) {
      await supabase
        .from('media_uploads')
        .update({ synced_to_drive: true, google_drive_url: 'drive-not-configured' })
        .eq('id', media_id);

      return new Response(JSON.stringify({ success: true, message: 'Drive not configured, skipped' }), {
        headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
      });
    }

    const jwt = await createGoogleJWT(serviceAccountJson);
    const accessToken = await getGoogleAccessToken(jwt);
    const teacherFolderId = await findOrCreateFolder(accessToken, teacherName, folderId);
    const lessonFolderId = await findOrCreateFolder(accessToken, folderName, teacherFolderId);

    const metadata = { name: media.file_name, parents: [lessonFolderId] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', fileData);

    const uploadRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
      { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form }
    );
    const driveFile = await uploadRes.json();

    await supabase
      .from('media_uploads')
      .update({
        synced_to_drive: true,
        google_drive_url: driveFile.webViewLink || `https://drive.google.com/file/d/${driveFile.id}`,
      })
      .eq('id', media_id);

    return new Response(JSON.stringify({ success: true, driveUrl: driveFile.webViewLink }), {
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: error.message === 'Unauthorized' ? 401 : 500,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    });
  }
});

async function createGoogleJWT(serviceAccount: any): Promise<string> {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = btoa(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now,
  }));

  const signInput = `${header}.${payload}`;
  const pemKey = serviceAccount.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\n/g, '');

  const keyData = Uint8Array.from(atob(pemKey), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8', keyData, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signInput)
  );

  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  return `${header}.${payload}.${sig}`;
}

async function getGoogleAccessToken(jwt: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  return data.access_token;
}

async function findOrCreateFolder(accessToken: string, name: string, parentId: string): Promise<string> {
  // Escape single quotes in name to prevent query injection
  const safeName = name.replace(/'/g, "\\'");
  const query = `name='${safeName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const searchData = await searchRes.json();
  if (searchData.files?.length > 0) return searchData.files[0].id;

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  const folder = await createRes.json();
  return folder.id;
}
