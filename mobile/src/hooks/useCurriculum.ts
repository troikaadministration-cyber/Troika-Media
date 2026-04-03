import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { CurriculumResourceWithTags, ResourceType, CurriculumTag } from '@troika/shared';

export function useCurriculum() {
  const [resources, setResources] = useState<CurriculumResourceWithTags[]>([]);
  const [tags, setTags] = useState<CurriculumTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<ResourceType | 'all'>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const fetchResources = useCallback(async () => {
    setLoading(true);

    let query = supabase
      .from('curriculum_resources')
      .select(`
        *,
        tags:curriculum_resource_tags(
          tag:curriculum_tags(*)
        )
      `)
      .order('created_at', { ascending: false });

    if (typeFilter !== 'all') {
      query = query.eq('type', typeFilter);
    }

    if (searchQuery) {
      query = query.or(`title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%`);
    }

    const { data, error } = await query;

    if (!error && data) {
      let mapped = data.map((r: any) => ({
        ...r,
        tags: r.tags?.map((t: any) => t.tag).filter(Boolean) || [],
      }));

      // Filter by selected tags client-side
      if (selectedTags.length > 0) {
        mapped = mapped.filter((r: any) =>
          selectedTags.every((tagName) =>
            r.tags?.some((t: any) => t.name === tagName)
          )
        );
      }

      setResources(mapped);
    }
    setLoading(false);
  }, [searchQuery, typeFilter, selectedTags]);

  const fetchTags = useCallback(async () => {
    const { data } = await supabase
      .from('curriculum_tags')
      .select('*')
      .order('name');
    if (data) setTags(data as CurriculumTag[]);
  }, []);

  useEffect(() => {
    fetchResources();
  }, [fetchResources]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  async function addResource(resource: {
    title: string;
    description?: string;
    type: ResourceType;
    level: string;
    teaching_tip?: string;
    tagNames?: string[];
  }) {
    const { data, error } = await supabase
      .from('curriculum_resources')
      .insert({
        title: resource.title,
        description: resource.description,
        type: resource.type,
        level: resource.level as any,
        teaching_tip: resource.teaching_tip,
      })
      .select()
      .single();

    if (error) throw error;

    // Handle tags
    if (resource.tagNames?.length && data) {
      for (const tagName of resource.tagNames) {
        let tagId: string;
        const { data: existing } = await supabase
          .from('curriculum_tags')
          .select('id')
          .eq('name', tagName)
          .single();

        if (existing) {
          tagId = existing.id;
        } else {
          const { data: newTag } = await supabase
            .from('curriculum_tags')
            .insert({ name: tagName })
            .select()
            .single();
          tagId = newTag!.id;
        }

        await supabase.from('curriculum_resource_tags').insert({
          resource_id: data.id,
          tag_id: tagId,
        });
      }
    }

    await fetchResources();
  }

  async function deleteResource(resourceId: string) {
    const { error } = await supabase
      .from('curriculum_resources')
      .delete()
      .eq('id', resourceId);
    if (error) throw error;
    await fetchResources();
  }

  function toggleTag(tagName: string) {
    setSelectedTags((prev) =>
      prev.includes(tagName)
        ? prev.filter((t) => t !== tagName)
        : [...prev, tagName]
    );
  }

  return {
    resources,
    tags,
    loading,
    searchQuery,
    setSearchQuery,
    typeFilter,
    setTypeFilter,
    selectedTags,
    toggleTag,
    addResource,
    deleteResource,
    refresh: fetchResources,
  };
}
