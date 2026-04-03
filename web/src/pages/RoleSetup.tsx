import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { BookOpen, GraduationCap, Music } from 'lucide-react';

type SetupRole = 'teacher' | 'student';

const roles: { value: SetupRole; label: string; description: string; icon: typeof BookOpen; color: string; bg: string; border: string }[] = [
  {
    value: 'teacher',
    label: 'Teacher',
    description: 'View your schedule, manage lessons, and track student progress',
    icon: GraduationCap,
    color: 'text-teal',
    bg: 'bg-teal/5',
    border: 'border-teal',
  },
  {
    value: 'student',
    label: 'Student',
    description: 'View your upcoming lessons and attendance history',
    icon: Music,
    color: 'text-yellow-600',
    bg: 'bg-yellow/5',
    border: 'border-yellow',
  },
];

export function RoleSetupPage() {
  const { session, createProfile, signOut } = useAuth();
  const [selectedRole, setSelectedRole] = useState<SetupRole | null>(null);
  const [fullName, setFullName] = useState(session?.user?.user_metadata?.full_name || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!selectedRole || !fullName.trim()) return;
    setLoading(true);
    setError('');
    try {
      await createProfile(selectedRole, fullName.trim());

      // If student role, use server-side function to link or create student record
      // This bypasses RLS so it can find coordinator-created records (user_id IS NULL)
      if (selectedRole === 'student' && session?.user) {
        const { error: linkErr } = await supabase.rpc('link_or_create_student', {
          p_user_id: session.user.id,
          p_email: session.user.email || '',
          p_full_name: fullName.trim(),
        });
        if (linkErr) console.error('Student link error:', linkErr);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="font-logo text-5xl text-navy">troika</h1>
          <p className="text-teal text-lg mt-1">music lessons</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
          <h2 className="text-xl font-bold text-navy mb-1">Set Up Your Account</h2>
          <p className="text-gray-500 text-sm mb-6">
            Welcome{session?.user?.email ? `, ${session.user.email}` : ''}! Choose your role to get started.
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral text-sm"
              placeholder="Your full name"
            />
          </div>

          <div className="mt-5 space-y-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">I am a...</label>
            {roles.map((role) => (
              <button
                key={role.value}
                onClick={() => setSelectedRole(role.value)}
                className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all ${
                  selectedRole === role.value
                    ? `${role.border} ${role.bg}`
                    : 'border-gray-100 hover:border-gray-200'
                }`}
              >
                <div className={`w-10 h-10 rounded-lg ${selectedRole === role.value ? `${role.bg}` : 'bg-gray-50'} flex items-center justify-center flex-shrink-0`}>
                  <role.icon size={20} className={selectedRole === role.value ? role.color : 'text-gray-400'} />
                </div>
                <div className="min-w-0">
                  <p className={`font-medium text-sm ${selectedRole === role.value ? 'text-navy' : 'text-gray-700'}`}>{role.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{role.description}</p>
                </div>
              </button>
            ))}
          </div>

          <button
            onClick={handleSubmit}
            disabled={!selectedRole || !fullName.trim() || loading}
            className="w-full mt-6 bg-coral text-white py-3 rounded-xl font-semibold hover:bg-coral/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Setting up...' : 'Continue'}
          </button>

          <button
            onClick={signOut}
            className="w-full mt-3 text-sm text-gray-400 hover:text-gray-600 py-2"
          >
            Sign out and use a different account
          </button>
        </div>
      </div>
    </div>
  );
}
