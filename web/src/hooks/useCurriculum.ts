import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { sanitizeForPostgrest } from '../lib/sanitize';
import type { CurriculumResourceWithTags, ResourceType, CurriculumTag } from '../types';

export function useCurriculum() {
  const [resources, setResources] = useState<CurriculumResourceWithTags[]>([]);
  const [tags, setTags] = useState<CurriculumTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<ResourceType | 'all'>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const fetchResources = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('curriculum_resources')
        .select(`*, tags:curriculum_resource_tags(tag:curriculum_tags(*))`)
        .order('created_at', { ascending: false })
        .limit(50);

      if (typeFilter !== 'all') query = query.eq('type', typeFilter);
      if (searchQuery) {
        const q = sanitizeForPostgrest(searchQuery);
        query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);
      }

      const { data, error: err } = await query;
      if (err) throw err;
      if (data) {
        let mapped = data.map((r: any) => ({
          ...r,
          tags: r.tags?.map((t: any) => t.tag).filter(Boolean) || [],
        }));
        if (selectedTags.length > 0) {
          mapped = mapped.filter((r: any) =>
            selectedTags.every((tagName) => r.tags?.some((t: any) => t.name === tagName))
          );
        }
        setResources(mapped);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch resources');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, typeFilter, selectedTags]);

  const fetchTags = useCallback(async () => {
    const { data } = await supabase.from('curriculum_tags').select('*').order('name');
    if (data) setTags(data as CurriculumTag[]);
  }, []);

  useEffect(() => { fetchResources(); }, [fetchResources]);
  useEffect(() => { fetchTags(); }, [fetchTags]);

  async function deleteResource(resourceId: string) {
    await supabase.from('curriculum_resources').delete().eq('id', resourceId);
    await fetchResources();
  }

  function toggleTag(tagName: string) {
    setSelectedTags((prev) =>
      prev.includes(tagName) ? prev.filter((t) => t !== tagName) : [...prev, tagName]
    );
  }

  return {
    resources, tags, loading, error, searchQuery, setSearchQuery,
    typeFilter, setTypeFilter, selectedTags, toggleTag, deleteResource, refresh: fetchResources,
  };
}
