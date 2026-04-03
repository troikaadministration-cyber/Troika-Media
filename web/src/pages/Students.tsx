import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStudents } from '../hooks/useStudents';
import { supabase } from '../lib/supabase';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { Search, Plus, X, ChevronRight, RefreshCw, Link2, UserCheck, UserX, ChevronDown, ChevronUp } from 'lucide-react';
import type { Instrument, Location } from '../types';

interface PendingAccount {
  id: string;
  full_name: string;
  email: string;
  role: string;
  created_at: string;
}

export function StudentsPage() {
  const [search, setSearch] = useState('');
  const [instrumentFilter, setInstrumentFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<boolean | undefined>(undefined);
  const [showCreate, setShowCreate] = useState(false);

  // Pending accounts
  const [pendingAccounts, setPendingAccounts] = useState<PendingAccount[]>([]);
  const [pendingExpanded, setPendingExpanded] = useState(true);
  const [pendingLoading, setPendingLoading] = useState(false);

  const modalRef = useFocusTrap(showCreate);
  const { students, loading, error, createStudent } = useStudents({
    instrumentId: instrumentFilter || undefined,
    locationId: locationFilter || undefined,
    isActive: activeFilter,
  });

  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const navigate = useNavigate();

  const fetchPendingAccounts = useCallback(async () => {
    setPendingLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, created_at')
      .is('approved', null)
      .neq('full_name', '')
      .neq('role', 'coordinator')
      .order('created_at', { ascending: false });
    setPendingAccounts((data as PendingAccount[]) || []);
    setPendingLoading(false);
  }, []);

  useEffect(() => {
    Promise.all([
      supabase.from('instruments').select('*').order('name'),
      supabase.from('locations').select('*').order('name'),
    ]).then(([i, l]) => {
      setInstruments((i.data as Instrument[]) || []);
      setLocations((l.data as Location[]) || []);
    });
    fetchPendingAccounts();
  }, [fetchPendingAccounts]);

  const handleApprove = async (id: string) => {
    await supabase.from('profiles').update({ approved: true }).eq('id', id);
    setPendingAccounts(prev => prev.filter(a => a.id !== id));
  };

  const handleDeny = async (id: string) => {
    await supabase.from('profiles').update({ approved: false }).eq('id', id);
    setPendingAccounts(prev => prev.filter(a => a.id !== id));
  };

  const filtered = students.filter((s: any) =>
    s.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    s.email?.toLowerCase().includes(search.toLowerCase()) ||
    s.parent_name?.toLowerCase().includes(search.toLowerCase())
  );

  // Create form
  const [form, setForm] = useState({
    full_name: '', email: '', phone: '', parent_name: '', parent_phone: '', parent_email: '',
    instrument_id: '', location_id: '', payment_plan: 'trial' as string, notes: '',
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await createStudent({
      ...form,
      instrument_id: form.instrument_id || null,
      location_id: form.location_id || null,
      is_active: true,
    } as any);
    setShowCreate(false);
    setForm({ full_name: '', email: '', phone: '', parent_name: '', parent_phone: '', parent_email: '', instrument_id: '', location_id: '', payment_plan: 'trial', notes: '' });
  };

  return (
    <div className="space-y-4">
      {/* Pending Accounts Banner */}
      {pendingAccounts.length > 0 && (
        <div className="bg-yellow/10 border border-yellow/30 rounded-xl overflow-hidden">
          <button
            onClick={() => setPendingExpanded(!pendingExpanded)}
            className="w-full px-5 py-3 flex items-center justify-between hover:bg-yellow/5 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-yellow/20 rounded-lg flex items-center justify-center">
                <UserCheck size={16} className="text-yellow-700" />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-yellow-800">
                  {pendingAccounts.length} account{pendingAccounts.length !== 1 ? 's' : ''} pending approval
                </p>
                <p className="text-xs text-yellow-600">Review and approve new sign-ups</p>
              </div>
            </div>
            {pendingExpanded ? <ChevronUp size={18} className="text-yellow-600" /> : <ChevronDown size={18} className="text-yellow-600" />}
          </button>

          {pendingExpanded && (
            <div className="border-t border-yellow/20 divide-y divide-yellow/10">
              {pendingAccounts.map((account) => (
                <div key={account.id} className="px-5 py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-navy">{account.full_name}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
                      <span>{account.email}</span>
                      <span className="bg-gray-100 px-1.5 py-0.5 rounded-full capitalize">{account.role}</span>
                      <span>{new Date(account.created_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleApprove(account.id)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-teal text-white text-xs font-medium rounded-lg hover:bg-teal/90 transition-colors"
                    >
                      <UserCheck size={14} />
                      Approve
                    </button>
                    <button
                      onClick={() => handleDeny(account.id)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-coral/10 text-coral text-xs font-medium rounded-lg hover:bg-coral/20 transition-colors"
                    >
                      <UserX size={14} />
                      Deny
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy">Students</h1>
          <p className="text-gray-500 text-sm">{filtered.length} students</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-coral text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-coral/90">
          <Plus size={16} /> Add Student
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search students..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-sm focus:ring-2 focus:ring-coral/30 focus:border-coral outline-none" />
        </div>
        <select value={instrumentFilter} onChange={(e) => setInstrumentFilter(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-2">
          <option value="">All Instruments</option>
          {instruments.map((i) => <option key={i.id} value={i.id}>{i.icon} {i.name}</option>)}
        </select>
        <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-2">
          <option value="">All Locations</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select value={activeFilter === undefined ? '' : activeFilter ? 'active' : 'inactive'}
          onChange={(e) => setActiveFilter(e.target.value === '' ? undefined : e.target.value === 'active')}
          className="text-xs border border-gray-200 rounded-lg px-2 py-2">
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {error && (
        <div className="bg-coral/10 border border-coral/20 rounded-xl p-4 flex items-center justify-between">
          <p className="text-coral text-sm">{error}</p>
          <button onClick={() => window.location.reload()} className="flex items-center gap-1 text-coral text-sm font-medium hover:underline"><RefreshCw size={14} />Retry</button>
        </div>
      )}

      {/* Table / Cards */}
      {loading ? (
        <div className="text-center text-gray-400 py-12 text-sm">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-gray-400 py-12 text-sm">No students found</div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50/80 text-left text-xs text-gray-500 uppercase">
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Instrument</th>
                  <th className="px-5 py-3 font-medium">Plan</th>
                  <th className="px-5 py-3 font-medium">Parent</th>
                  <th className="px-5 py-3 font-medium">Account</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((s: any) => (
                  <tr key={s.id} onClick={() => navigate(`/students/${s.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/students/${s.id}`)} tabIndex={0} className="hover:bg-gray-50/50 cursor-pointer focus:bg-gray-50">
                    <td className="px-5 py-3">
                      <p className="font-medium text-navy text-sm">{s.full_name}</p>
                      {s.email && <p className="text-xs text-gray-400">{s.email}</p>}
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-600">
                      {s.instrument ? <span>{s.instrument.icon} {s.instrument.name}</span> : '-'}
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{s.payment_plan}</span>
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-500">{s.parent_name || '-'}</td>
                    <td className="px-5 py-3">
                      {s.user_id ? (
                        <span className="flex items-center gap-1 text-xs text-teal font-medium" title="Student has logged in and linked their account">
                          <Link2 size={12} />Linked
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400" title="Student hasn't signed up yet">Not linked</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.is_active ? 'bg-teal/10 text-teal' : 'bg-gray-100 text-gray-500'}`}>
                        {s.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-5 py-3"><ChevronRight size={16} className="text-gray-300" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {filtered.map((s: any) => (
              <div key={s.id} onClick={() => navigate(`/students/${s.id}`)}
                className="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between cursor-pointer hover:shadow-sm active:bg-gray-50">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-navy text-sm truncate">{s.full_name}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${s.is_active ? 'bg-teal/10 text-teal' : 'bg-gray-100 text-gray-500'}`}>
                      {s.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                    {s.instrument && <span>{s.instrument.icon} {s.instrument.name}</span>}
                    <span className="bg-gray-100 px-1.5 py-0.5 rounded-full">{s.payment_plan}</span>
                    {s.user_id ? (
                      <span className="flex items-center gap-0.5 text-teal"><Link2 size={10} />Linked</span>
                    ) : (
                      <span className="text-gray-400">Not linked</span>
                    )}
                  </div>
                </div>
                <ChevronRight size={18} className="text-gray-300 flex-shrink-0" />
              </div>
            ))}
          </div>
        </>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div ref={modalRef} className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-navy">Add Student</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-navy"><X size={20} /></button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Full Name</label>
                <input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" placeholder="Student name" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                  <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Instrument</label>
                  <select value={form.instrument_id} onChange={(e) => setForm({ ...form, instrument_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                    <option value="">None</option>
                    {instruments.map((i) => <option key={i.id} value={i.id}>{i.icon} {i.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Location</label>
                  <select value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                    <option value="">None</option>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Payment Plan</label>
                <select value={form.payment_plan} onChange={(e) => setForm({ ...form, payment_plan: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                  <option value="trial">Trial</option>
                  <option value="1_instalment">1 Instalment</option>
                  <option value="3_instalments">3 Instalments</option>
                  <option value="10_instalments">10 Instalments</option>
                </select>
              </div>
              <div className="border-t pt-3">
                <p className="text-xs font-medium text-gray-500 mb-2">Parent / Guardian</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <input value={form.parent_name} onChange={(e) => setForm({ ...form, parent_name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" placeholder="Parent name" />
                  <input value={form.parent_phone} onChange={(e) => setForm({ ...form, parent_phone: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" placeholder="Phone" />
                  <input type="email" value={form.parent_email} onChange={(e) => setForm({ ...form, parent_email: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" placeholder="Email" />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
                <button type="submit" className="flex-1 px-4 py-2.5 rounded-lg bg-coral text-white text-sm font-medium hover:bg-coral/90">Add Student</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
