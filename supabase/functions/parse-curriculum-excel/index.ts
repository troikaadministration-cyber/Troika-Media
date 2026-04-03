// Supabase Edge Function: Parse curriculum Excel file and import to database

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';
import * as XLSX from 'https://esm.sh/xlsx@0.18.5';

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

    // Role check: only coordinators and teachers can upload curriculum
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    if (!profile || (profile.role !== 'coordinator' && profile.role !== 'teacher')) {
      throw new Error('Unauthorized');
    }

    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) throw new Error('No file provided');
    if (file.size > 10 * 1024 * 1024) throw new Error('File too large (max 10MB)');

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet);

    const resources = [];
    const tagSet = new Set<string>();

    for (const row of rows) {
      const title = row['Title'] || row['title'];
      if (!title) continue;

      const type = (row['Type'] || row['type'] || 'piece').toLowerCase();
      const level = (row['Level'] || row['level'] || 'beginner').toLowerCase();
      const tags = (row['Tags'] || row['tags'] || '')
        .split(',')
        .map((t: string) => t.trim().toLowerCase())
        .filter(Boolean);

      tags.forEach((t: string) => tagSet.add(t));

      resources.push({
        title,
        description: row['Description'] || row['description'] || null,
        type: ['piece', 'exercise', 'activity'].includes(type) ? type : 'piece',
        level: ['beginner', 'intermediate', 'advanced'].includes(level) ? level : 'beginner',
        teaching_tip: row['Teaching Tip'] || row['teaching_tip'] || null,
        source_file: file.name,
        _tags: tags,
      });
    }

    const tagMap = new Map<string, string>();
    for (const tagName of tagSet) {
      const { data: existing } = await supabase
        .from('curriculum_tags')
        .select('id')
        .eq('name', tagName)
        .single();

      if (existing) {
        tagMap.set(tagName, existing.id);
      } else {
        const { data: newTag } = await supabase
          .from('curriculum_tags')
          .insert({ name: tagName })
          .select('id')
          .single();
        if (newTag) tagMap.set(tagName, newTag.id);
      }
    }

    let inserted = 0;
    for (const resource of resources) {
      const { _tags, ...resourceData } = resource;

      const { data: newResource, error } = await supabase
        .from('curriculum_resources')
        .insert(resourceData)
        .select('id')
        .single();

      if (error || !newResource) continue;

      const tagLinks = _tags
        .filter((t: string) => tagMap.has(t))
        .map((t: string) => ({ resource_id: newResource.id, tag_id: tagMap.get(t)! }));

      if (tagLinks.length > 0) {
        await supabase.from('curriculum_resource_tags').insert(tagLinks);
      }

      inserted++;
    }

    return new Response(
      JSON.stringify({ success: true, total_rows: rows.length, inserted, tags_created: tagSet.size }),
      { headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: error.message === 'Unauthorized' ? 401 : 500,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    });
  }
});
