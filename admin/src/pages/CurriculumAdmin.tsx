import React, { useState, useCallback } from 'react';
import { Upload, FileSpreadsheet, Trash2, BookOpen, CheckCircle, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { CurriculumResourceWithTags } from '@troika/shared';

export function CurriculumAdminPage() {
  const [resources, setResources] = useState<CurriculumResourceWithTags[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ success: boolean; message: string } | null>(null);
  const [filterType, setFilterType] = useState('');
  const [search, setSearch] = useState('');

  React.useEffect(() => {
    fetchResources();
  }, []);

  async function fetchResources() {
    setLoading(true);
    const { data } = await supabase
      .from('curriculum_resources')
      .select('*, tags:curriculum_resource_tags(tag:curriculum_tags(*))')
      .order('created_at', { ascending: false });

    const mapped = (data || []).map((r: any) => ({
      ...r,
      tags: r.tags?.map((t: any) => t.tag).filter(Boolean) || [],
    }));
    setResources(mapped);
    setLoading(false);
  }

  async function deleteResource(id: string) {
    if (!confirm('Delete this resource?')) return;
    await supabase.from('curriculum_resources').delete().eq('id', id);
    await fetchResources();
  }

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    handleFileUpload(file);
  }, []);

  const handleFileUpload = async (file: File) => {
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls') && !file.name.endsWith('.csv')) {
      setUploadResult({ success: false, message: 'Please upload an Excel (.xlsx/.xls) or CSV file' });
      return;
    }

    setUploading(true);
    setUploadResult(null);

    try {
      // Read file as base64
      const buffer = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );

      // Call the parse-curriculum-excel edge function
      const { data, error } = await supabase.functions.invoke('parse-curriculum-excel', {
        body: {
          file_data: base64,
          file_name: file.name,
        },
      });

      if (error) throw error;

      const count = data?.resources_created || 0;
      setUploadResult({
        success: true,
        message: `Successfully imported ${count} resource${count !== 1 ? 's' : ''} from ${file.name}`,
      });

      // Refresh the resource list
      await fetchResources();
    } catch (err: any) {
      setUploadResult({
        success: false,
        message: `Upload failed: ${err.message || 'Unknown error'}`,
      });
    }

    setUploading(false);
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'piece': return 'bg-navy text-white';
      case 'exercise': return 'bg-coral text-white';
      case 'activity': return 'bg-amber-500 text-white';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'beginner': return 'bg-teal text-white';
      case 'intermediate': return 'bg-teal text-white';
      case 'advanced': return 'bg-navy text-white';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  const filteredResources = resources.filter((r: any) => {
    if (filterType && r.type !== filterType) return false;
    if (search && !r.title.toLowerCase().includes(search.toLowerCase()) &&
        !r.description?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy">Curriculum Management</h1>
          <p className="text-gray-500 text-sm mt-1">Upload and manage teaching resources</p>
        </div>
      </div>

      {/* Upload zone */}
      <div
        className={`bg-white rounded-xl shadow-sm border-2 border-dashed ${dragOver ? 'border-coral bg-coral-light' : 'border-gray-200'} p-8 mb-6 text-center transition-colors`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <div className="w-16 h-16 bg-coral-light rounded-2xl flex items-center justify-center mx-auto mb-4">
          <FileSpreadsheet size={28} className="text-coral" />
        </div>
        <h3 className="text-lg font-semibold text-navy mb-1">Upload Curriculum Excel</h3>
        <p className="text-sm text-gray-400 mb-4">Drag and drop an Excel file here, or click to browse</p>
        <label className="inline-flex items-center gap-2 bg-coral text-white px-5 py-2.5 rounded-xl text-sm font-semibold cursor-pointer hover:bg-coral/90">
          <Upload size={16} />
          Choose File
          <input type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])} />
        </label>
        {uploading && <p className="text-sm text-teal mt-3 animate-pulse">Processing file...</p>}
        {uploadResult && (
          <div className={`mt-3 flex items-center justify-center gap-2 text-sm ${uploadResult.success ? 'text-teal' : 'text-coral'}`}>
            {uploadResult.success ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            {uploadResult.message}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="text"
            placeholder="Search resources..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
          <div className="flex gap-1.5">
            {['', 'piece', 'exercise', 'activity'].map((type) => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  filterType === type ? 'bg-coral text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {type || 'All'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Resources list */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-navy flex items-center gap-2">
            <BookOpen size={18} />
            Resources ({filteredResources.length})
          </h2>
        </div>
        {loading ? (
          <p className="text-center text-gray-400 py-12">Loading...</p>
        ) : filteredResources.length === 0 ? (
          <p className="text-center text-gray-400 py-12">
            {resources.length === 0 ? 'No resources yet. Upload an Excel file to get started.' : 'No resources match your filters.'}
          </p>
        ) : (
          <div className="divide-y divide-gray-50">
            {filteredResources.map((resource: any) => (
              <div key={resource.id} className="p-4 flex items-start gap-4 hover:bg-gray-50">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${getTypeColor(resource.type)}`}>
                      {resource.type}
                    </span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${getLevelColor(resource.level)}`}>
                      {resource.level}
                    </span>
                  </div>
                  <p className="font-medium text-navy">{resource.title}</p>
                  {resource.description && (
                    <p className="text-sm text-gray-500 mt-0.5">{resource.description}</p>
                  )}
                  {resource.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {resource.tags.map((tag: any) => (
                        <span key={tag.id} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{tag.name}</span>
                      ))}
                    </div>
                  )}
                  {resource.teaching_tip && (
                    <div className="mt-2 bg-cream rounded-lg p-2.5 text-xs text-navy/80">
                      {resource.teaching_tip}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => deleteResource(resource.id)}
                  className="text-gray-300 hover:text-coral transition-colors p-1"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
