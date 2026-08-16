import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Search, CornerDownLeft, User, ArrowRight } from 'lucide-react';

export interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  to: string;
  kind: 'page' | 'student';
}

/**
 * ⌘K command palette — jump to any page or student.
 * `pages` are the current role's nav destinations; students are searched live
 * (coordinators/teachers only, gated by RLS on the students table).
 */
export function CommandPalette({
  open,
  onClose,
  pages,
  canSearchStudents,
}: {
  open: boolean;
  onClose: () => void;
  pages: { label: string; to: string }[];
  canSearchStudents: boolean;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [students, setStudents] = useState<CommandItem[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setStudents([]);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  // Live student search
  useEffect(() => {
    if (!open || !canSearchStudents || query.trim().length < 2) {
      setStudents([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('students')
        .select('id, full_name, instrument:instruments(name)')
        .ilike('full_name', `%${query.trim()}%`)
        .order('full_name')
        .limit(6);
      if (cancelled) return;
      setStudents(
        (data || []).map((s: any) => ({
          id: `student-${s.id}`,
          label: s.full_name,
          hint: s.instrument?.name || 'Student',
          to: `/students/${s.id}`,
          kind: 'student' as const,
        }))
      );
    }, 140);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, open, canSearchStudents]);

  const q = query.trim().toLowerCase();
  const pageItems: CommandItem[] = pages
    .filter((p) => !q || p.label.toLowerCase().includes(q))
    .map((p) => ({ id: `page-${p.to}`, label: p.label, to: p.to, kind: 'page' as const, hint: 'Go to page' }));

  const items = [...pageItems, ...students];

  const run = useCallback((item?: CommandItem) => {
    const target = item || items[active];
    if (!target) return;
    navigate(target.to);
    onClose();
  }, [items, active, navigate, onClose]);

  // Keyboard nav
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); run(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, items.length, run, onClose]);

  useEffect(() => { if (active >= items.length) setActive(Math.max(0, items.length - 1)); }, [items.length, active]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center pt-[12vh] px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
      <div
        className="relative w-full max-w-lg bg-white/90 backdrop-blur-2xl border border-black/10 rounded-2xl shadow-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-black/5">
          <Search size={18} className="text-gray-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            placeholder={canSearchStudents ? 'Search pages and students…' : 'Search pages…'}
            className="flex-1 bg-transparent text-[15px] text-navy placeholder-gray-400 focus:outline-none"
          />
          <span className="text-[11px] font-semibold text-gray-400 bg-gray-100 border border-black/5 rounded px-1.5 py-0.5">ESC</span>
        </div>

        <div className="max-h-[52vh] overflow-y-auto py-2">
          {items.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">No matches</p>
          ) : (
            items.map((item, i) => (
              <button
                key={item.id}
                onMouseEnter={() => setActive(i)}
                onClick={() => run(item)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left ${
                  i === active ? 'bg-teal/10' : ''
                }`}
              >
                <span className={`w-7 h-7 rounded-lg grid place-items-center flex-shrink-0 ${
                  item.kind === 'student' ? 'bg-gray-100 text-gray-500' : 'bg-teal/10 text-teal'
                }`}>
                  {item.kind === 'student' ? <User size={14} /> : <ArrowRight size={14} />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[14px] font-medium text-navy truncate">{item.label}</span>
                  {item.hint && <span className="block text-[12px] text-gray-400 truncate">{item.hint}</span>}
                </span>
                {i === active && <CornerDownLeft size={14} className="text-gray-300 flex-shrink-0" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
