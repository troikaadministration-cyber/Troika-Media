import { useRef, useState } from 'react';
import { useCurriculum } from '../hooks/useCurriculum';
import { supabase } from '../lib/supabase';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Search, Upload, Trash2, Lightbulb, Calendar, BookOpen, RefreshCw } from 'lucide-react';
import type { ResourceType } from '../types';

export function CurriculumAdminPage() {
  const {
    resources, tags, loading, error, searchQuery, setSearchQuery,
    typeFilter, setTypeFilter, selectedTags, toggleTag, deleteResource, refresh,
  } = useCurriculum();

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const typeButtons: { label: string; value: ResourceType | 'all' }[] = [
    { label: 'All', value: 'all' },
    { label: 'Pieces', value: 'piece' },
    { label: 'Exercises', value: 'exercise' },
    { label: 'Activities', value: 'activity' },
  ];

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await supabase.functions.invoke('parse-curriculum-excel', { body: formData });
      await refresh();
    } catch (err) {
      console.error('Upload error:', err);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const typeIcon = (type: string) => {
    if (type === 'piece') return <span className="text-base">🎵</span>;
    if (type === 'exercise') return <span className="text-base">✏️</span>;
    return <span className="text-base">🎯</span>;
  };

  const typeBadgeClass = (type: string) => {
    if (type === 'piece') return 'bg-navy text-white';
    if (type === 'exercise') return 'bg-coral text-white';
    return 'bg-coral text-white';
  };

  const levelBadgeClass = (level: string) => {
    if (level === 'beginner') return 'bg-teal text-white';
    if (level === 'intermediate') return 'bg-teal text-white';
    return 'bg-navy text-white';
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy">Curriculum</h1>
          <p className="text-gray-500 text-sm">Manage teaching resources</p>
        </div>
        <div>
          <input type="file" ref={fileRef} accept=".xlsx,.xls,.csv" onChange={handleUpload} className="hidden" />
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="flex items-center gap-2 bg-coral text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-coral/90 disabled:opacity-50">
            <Upload size={16} /> {uploading ? 'Uploading...' : 'Upload Excel'}
          </button>
        </div>
      </div>

      {/* Search + filters */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 sm:p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search resources or tags..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-sm focus:ring-2 focus:ring-coral/30 focus:border-coral outline-none" />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {typeButtons.map((btn) => (
            <button key={btn.value} onClick={() => setTypeFilter(btn.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                typeFilter === btn.value ? 'bg-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {btn.label}
            </button>
          ))}
        </div>

        {tags.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-2">Filter by concepts:</p>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <button key={tag.id} onClick={() => toggleTag(tag.name)}
                  className={`px-2.5 py-1 rounded-full text-[11px] transition-colors ${
                    selectedTags.includes(tag.name)
                      ? 'bg-teal text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}>
                  {tag.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-coral/10 border border-coral/20 rounded-xl p-4 flex items-center justify-between">
          <p className="text-coral text-sm">{error}</p>
          <button onClick={refresh} className="flex items-center gap-1 text-coral text-sm font-medium hover:underline"><RefreshCw size={14} />Retry</button>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Resource"
        message="Are you sure you want to delete this curriculum resource?"
        onConfirm={async () => { if (confirmDelete) { await deleteResource(confirmDelete); setConfirmDelete(null); } }}
        onCancel={() => setConfirmDelete(null)}
      />

      <p className="text-sm text-navy font-medium">{resources.length} resources found</p>

      {/* Resources list */}
      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading...</div>
      ) : (
        <div className="space-y-3">
          {resources.map((r) => (
            <div key={r.id} className="bg-white rounded-xl border border-gray-100 p-4 sm:p-5 border-l-4"
              style={{ borderLeftColor: r.type === 'piece' ? '#2A9D8F' : r.type === 'exercise' ? '#E8604C' : '#F0C93B' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  {typeIcon(r.type)}
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${typeBadgeClass(r.type)}`}>
                    {r.type.charAt(0).toUpperCase() + r.type.slice(1)}
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${levelBadgeClass(r.level)}`}>
                    {r.level.charAt(0).toUpperCase() + r.level.slice(1)}
                  </span>
                </div>
                <button onClick={() => setConfirmDelete(r.id)} className="text-gray-300 hover:text-red-500 flex-shrink-0" aria-label="Delete resource">
                  <Trash2 size={16} />
                </button>
              </div>

              <h3 className="font-semibold text-navy text-lg mt-2">{r.title}</h3>
              {r.description && <p className="text-sm text-gray-500 mt-1">{r.description}</p>}

              {r.tags && r.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {r.tags.map((tag) => (
                    <span key={tag.id} className="text-[10px] bg-cream text-navy px-2 py-0.5 rounded-full border border-yellow/30">
                      {tag.name}
                    </span>
                  ))}
                </div>
              )}

              {r.teaching_tip && (
                <div className="mt-3 bg-yellow-light rounded-lg p-3 flex gap-2">
                  <Lightbulb size={14} className="text-yellow-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-gray-700">{r.teaching_tip}</p>
                </div>
              )}

              <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
                <span className="flex items-center gap-1"><Calendar size={11} />Added {new Date(r.created_at).toLocaleDateString('en-GB')}</span>
                <span className="flex items-center gap-1"><BookOpen size={11} />Teaching Resource</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
