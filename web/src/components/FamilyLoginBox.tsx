import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, Link2, Search, Unlink, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useQuery, unwrap, invalidateQueries, errorMessage } from '../lib/queryCache';
import { useToast } from '../contexts/ToastContext';
import { ConfirmDialog } from './ConfirmDialog';

interface LoginProfile {
  id: string;
  full_name: string;
  email: string;
  approved: boolean | null;
}

interface LinkedState {
  login: LoginProfile | null;
  children: { id: string; full_name: string; is_active: boolean }[];
}

interface LoginOption {
  id: string;
  full_name: string;
  email: string;
  children: string[];
}

type Pending = { kind: 'link'; option: LoginOption } | { kind: 'unlink' } | null;

/**
 * Coordinator: which login (app account) can see this student, and which other
 * children share that login (a family account). Link / unlink goes through the
 * set_student_login RPC (approved student/parent logins only).
 */
export function FamilyLoginBox({ studentId, studentName }: { studentId: string; studentName: string }) {
  const { showToast } = useToast();
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [saving, setSaving] = useState(false);

  const linked = useQuery<LinkedState>(`student-detail:${studentId}:login`, async () => {
    const row = unwrap(await supabase.from('students').select('user_id').eq('id', studentId).maybeSingle()) as
      { user_id: string | null } | null;
    if (!row?.user_id) return { login: null, children: [] };
    const [prof, kids] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, approved').eq('id', row.user_id).maybeSingle(),
      supabase.from('students').select('id, full_name, is_active').eq('user_id', row.user_id).order('full_name'),
    ]);
    return {
      login: unwrap(prof) as LoginProfile | null,
      children: unwrap(kids, []) as LinkedState['children'],
    };
  });

  // Approved student / parent logins, each with the children already on it.
  const options = useQuery<LoginOption[]>(picking ? 'family-login-options' : null, async () => {
    const [profs, kids] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email')
        .eq('role', 'student').eq('approved', true).order('full_name').limit(2000),
      supabase.from('students').select('full_name, user_id').not('user_id', 'is', null).limit(5000),
    ]);
    const byUser = new Map<string, string[]>();
    for (const k of unwrap(kids, []) as { full_name: string; user_id: string }[]) {
      byUser.set(k.user_id, [...(byUser.get(k.user_id) ?? []), k.full_name]);
    }
    return (unwrap(profs, []) as Omit<LoginOption, 'children'>[]).map((p) => ({
      ...p, children: (byUser.get(p.id) ?? []).sort(),
    }));
  });

  const current = linked.data?.login ?? null;
  const others = (linked.data?.children ?? []).filter((c) => c.id !== studentId);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (options.data ?? []).filter((o) => o.id !== current?.id);
    if (!q) return list.slice(0, 8);
    return list.filter((o) =>
      o.full_name.toLowerCase().includes(q) || o.email.toLowerCase().includes(q)
      || o.children.some((c) => c.toLowerCase().includes(q))).slice(0, 8);
  }, [options.data, search, current?.id]);

  async function apply() {
    if (!pending) return;
    const userId = pending.kind === 'link' ? pending.option.id : null;
    setPending(null);
    setSaving(true);
    try {
      const { error } = await supabase.rpc('set_student_login', { p_student_id: studentId, p_user_id: userId });
      if (error) throw new Error(error.message);
      showToast('success', userId ? 'Linked — they can now see this student in the app.' : 'Unlinked from the login.');
      setPicking(false);
      setSearch('');
      invalidateQueries('students:');
      invalidateQueries('ref:students');
      invalidateQueries('family-login-options');
      await linked.refresh();
    } catch (err) {
      showToast('error', errorMessage(err, "Couldn't change the login"));
    } finally {
      setSaving(false);
    }
  }

  const confirmTitle = pending?.kind === 'link' ? 'Link to this login?' : 'Unlink from this login?';
  const confirmMessage = pending?.kind === 'link'
    ? `${pending.option.full_name} (${pending.option.email}) will see ${studentName}'s lessons and payments`
      + (pending.option.children.length ? `, alongside ${pending.option.children.join(', ')}.` : '.')
      + (current ? ` ${current.full_name} will no longer see ${studentName}.` : '')
    : `${current?.full_name ?? 'This login'} will no longer see ${studentName}'s lessons and payments. Nothing else changes.`;

  return (
    <div className="bg-white rounded-xl border border-black/5 p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest">Family login</p>
        {current && !picking && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPicking(true)} disabled={saving}
              className="text-xs font-medium text-gray-500 hover:text-navy px-2 py-1 rounded-lg border border-gray-200 disabled:opacity-50">
              Change
            </button>
            <button type="button" onClick={() => setPending({ kind: 'unlink' })} disabled={saving}
              className="flex items-center gap-1 text-xs font-medium text-coral px-2 py-1 rounded-lg border border-coral/30 hover:bg-coral/5 disabled:opacity-50">
              <Unlink size={12} /> Unlink
            </button>
          </div>
        )}
      </div>

      {linked.loading ? (
        <div className="h-10 rounded-lg bg-gray-50 animate-pulse" />
      ) : linked.error && !linked.data ? (
        <p className="text-sm text-coral">{linked.error}</p>
      ) : current ? (
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-teal/10 flex items-center justify-center flex-shrink-0">
              <KeyRound size={16} className="text-teal" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-navy">
                {current.full_name || 'Unnamed login'}
                {current.approved !== true && (
                  <span className="ml-2 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-yellow/10 text-yellow-700">Not approved</span>
                )}
              </p>
              <p className="text-xs text-gray-500 break-all">{current.email}</p>
            </div>
          </div>
          {others.length > 0 ? (
            <div>
              <p className="text-xs text-gray-400 mb-1.5">Also on this login</p>
              <div className="flex flex-wrap gap-2">
                {others.map((c) => (
                  <Link key={c.id} to={`/students/${c.id}`}
                    className="text-xs font-medium px-2.5 py-1 rounded-full bg-navy/5 text-navy hover:bg-navy/10">
                    {c.full_name}{!c.is_active && ' (inactive)'}
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400">Only {studentName} is on this login.</p>
          )}
        </div>
      ) : !picking ? (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-gray-500">No app login yet — {studentName} can't see their lessons in the app.</p>
          <button type="button" onClick={() => setPicking(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-teal/30 text-teal text-sm font-medium hover:bg-teal/5">
            <Link2 size={14} /> Link to a family login
          </button>
        </div>
      ) : null}

      {picking && (
        <div className="mt-4 pt-4 border-t border-gray-50 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Choose the parent's (or student's) app login. Only approved logins are listed.
            </p>
            <button type="button" aria-label="Close" onClick={() => { setPicking(false); setSearch(''); }}
              className="p-1 rounded text-gray-400 hover:text-navy"><X size={16} /></button>
          </div>
          <label className="relative block">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email"
              className="w-full pl-8 pr-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral" />
          </label>
          {options.loading ? (
            <div className="h-24 rounded-lg bg-gray-50 animate-pulse" />
          ) : options.error ? (
            <p className="text-sm text-coral">{options.error}</p>
          ) : matches.length === 0 ? (
            <p className="text-sm text-gray-400 py-2">No approved login matches “{search}”.</p>
          ) : (
            <ul className="divide-y divide-black/5 border border-black/5 rounded-lg max-h-72 overflow-y-auto">
              {matches.map((o) => (
                <li key={o.id}>
                  <button type="button" disabled={saving} onClick={() => setPending({ kind: 'link', option: o })}
                    className="w-full text-left px-3 py-2.5 hover:bg-gray-50 disabled:opacity-50">
                    <p className="text-sm font-medium text-navy">{o.full_name || 'Unnamed login'}</p>
                    <p className="text-xs text-gray-500 break-all">{o.email}</p>
                    {o.children.length > 0 && (
                      <p className="text-[11px] text-gray-400 mt-0.5">Sees: {o.children.join(', ')}</p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel={pending?.kind === 'link' ? 'Link' : 'Unlink'}
        onConfirm={() => { void apply(); }}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
