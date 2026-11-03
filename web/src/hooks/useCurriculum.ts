import { useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { sanitizeForPostgrest } from '../lib/sanitize';
import { useQuery, unwrap, invalidateQueries, fetchQuery } from '../lib/queryCache';
import type { CurriculumResourceWithTags, ResourceType, CurriculumTag } from '../types';

const RESOURCE_COLS = 'id, title, description, type, level, teaching_tip, created_at';
const PAGE_SIZE = 50;

export function useCurriculum() {
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<ResourceType | 'all'>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const key = `curriculum:${typeFilter}:${searchQuery}:${selectedTags.join('|')}`;
  const fetchResources = async (): Promise<CurriculumResourceWithTags[]> => {
    // One inner-joined alias per selected tag, so the database returns only
    // resources having ALL selected tags (filtering after .limit() missed older items).
    const tagJoins = selectedTags.map((_, i) => `,t${i}:curriculum_resource_tags!inner(tag:curriculum_tags!inner(name))`).join('');
    let query = supabase
      .from('curriculum_resources')
      .select(`${RESOURCE_COLS}, tags:curriculum_resource_tags(tag:curriculum_tags(id, name))${tagJoins}`)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);

    selectedTags.forEach((name, i) => { query = query.eq(`t${i}.tag.name`, name); });
    if (typeFilter !== 'all') query = query.eq('type', typeFilter);
    if (searchQuery) {
      const s = sanitizeForPostgrest(searchQuery);
      query = query.or(`title.ilike.%${s}%,description.ilike.%${s}%`);
    }

    const rows = unwrap(await query, []) as any[];
    return rows.map(({ tags, ...r }) => {
      for (let i = 0; i < selectedTags.length; i++) delete r[`t${i}`];
      return { ...r, tags: (tags ?? []).map((t: any) => t.tag).filter(Boolean) };
    }) as CurriculumResourceWithTags[];
  };
  const q = useQuery(key, fetchResources);

  // Keep showing the previous results while a new search/filter loads (no skeleton flash per keystroke).
  const lastRef = useRef<CurriculumResourceWithTags[]>([]);
  if (q.data) lastRef.current = q.data;
  const resources = q.data ?? lastRef.current;

  const tagsQ = useQuery<CurriculumTag[]>('curriculum:tags', async () =>
    unwrap(await supabase.from('curriculum_tags').select('id, name, created_at').order('name'), []) as CurriculumTag[],
  { staleTime: 5 * 60 * 1000 });

  /** Refetch resources + tags (and mark other filter combinations stale). */
  async function refresh() {
    invalidateQueries('curriculum:'); // refetches the mounted queries
    await fetchQuery(key, fetchResources); // joins that in-flight request
  }

  /** Throws on failure so callers can show the error and keep their dialog open. */
  async function deleteResource(resourceId: string) {
    const { error } = await supabase.from('curriculum_resources').delete().eq('id', resourceId);
    if (error) throw new Error(error.message);
    await refresh();
  }

  function toggleTag(tagName: string) {
    setSelectedTags((prev) =>
      prev.includes(tagName) ? prev.filter((t) => t !== tagName) : [...prev, tagName]
    );
  }

  return {
    resources,
    tags: tagsQ.data ?? [],
    loading: q.loading && lastRef.current.length === 0,
    error: q.error,
    searchQuery, setSearchQuery,
    typeFilter, setTypeFilter, selectedTags, toggleTag, deleteResource, refresh,
  };
}
