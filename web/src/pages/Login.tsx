import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { isConfigured, supabase } from '../lib/supabase';
import { GraduationCap, Music } from 'lucide-react';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const { signIn, signUp, signInWithGoogle } = useAuth();

  if (!isConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-md text-center">
          <h1 className="font-logo text-5xl text-navy mb-2">troika</h1>
          <p className="text-teal text-lg">music lessons</p>
          <div className="mt-8 bg-yellow-light border border-yellow/30 rounded-xl p-6 text-left">
            <p className="font-semibold text-navy text-sm mb-2">Setup Required</p>
            <p className="text-sm text-gray-600">
              Add your Supabase credentials to get started:
            </p>
            <div className="mt-3 bg-white rounded-lg p-3 text-xs font-mono text-gray-700 space-y-1">
              <p>VITE_SUPABASE_URL=your-url</p>
              <p>VITE_SUPABASE_ANON_KEY=your-key</p>
            </div>
            <p className="text-xs text-gray-500 mt-3">
              Create a <code className="bg-gray-100 px-1 rounded">.env</code> file in the <code className="bg-gray-100 px-1 rounded">web/</code> directory.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      if (isSignUp) {
        await signUp(email, password, fullName);
        setSuccess('Account created! Check your email to confirm, then sign in.');
        setIsSignUp(false);
        setFullName('');
        setPassword('');
      } else {
        await signIn(email, password);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    try {
      await signInWithGoogle();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md">
        {/* Branding */}
        <div className="text-center mb-8">
          <h1 className="font-logo text-5xl text-navy">troika</h1>
          <p className="text-teal text-lg mt-1">music lessons</p>
          <p className="text-coral text-sm mt-1">every note counts</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
          <h2 className="text-xl font-bold text-navy mb-1">{isSignUp ? 'Create Account' : 'Welcome'}</h2>
          <p className="text-gray-500 text-sm mb-6">{isSignUp ? 'Sign up to get started' : 'Sign in to access your portal'}</p>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-teal/10 border border-teal/20 text-teal text-sm rounded-lg p-3 mb-4">
              {success}
            </div>
          )}

          {/* Role cards - informational */}
          <div className="grid grid-cols-2 gap-2 mb-6">
            {[
              { icon: GraduationCap, label: 'Teacher', color: 'text-teal', bg: 'bg-teal/10' },
              { icon: Music, label: 'Student', color: 'text-yellow-600', bg: 'bg-yellow/10' },
            ].map(({ icon: Icon, label, color, bg }) => (
              <div key={label} className={`${bg} rounded-xl p-3 text-center`}>
                <Icon size={20} className={`${color} mx-auto mb-1`} />
                <p className={`text-xs font-medium ${color}`}>{label}</p>
              </div>
            ))}
          </div>

          {/* Google Sign In */}
          <button
            onClick={handleGoogleSignIn}
            className="w-full flex items-center justify-center gap-3 bg-white border border-gray-200 text-navy py-3 rounded-xl font-medium hover:bg-gray-50 transition-colors text-sm"
          >
            <svg width="18" height="18" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Continue with Google
          </button>

          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400">or</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          {/* Email/Password */}
          {!showEmailForm ? (
            <button
              onClick={() => setShowEmailForm(true)}
              className="w-full text-sm text-gray-500 hover:text-navy py-2 transition-colors"
            >
              {isSignUp ? 'Sign up with email and password' : 'Sign in with email and password'}
            </button>
          ) : (
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              {isSignUp && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral text-sm"
                    placeholder="Your full name"
                    required
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral text-sm"
                  placeholder="you@troika.com"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral text-sm"
                  placeholder={isSignUp ? 'Create a password' : 'Enter your password'}
                  required
                  minLength={isSignUp ? 6 : undefined}
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-coral text-white py-3 rounded-xl font-semibold hover:bg-coral/90 disabled:opacity-50 transition-colors"
              >
                {loading ? (isSignUp ? 'Creating account...' : 'Signing in...') : (isSignUp ? 'Create Account' : 'Sign In')}
              </button>
              {!isSignUp && (
                <button
                  type="button"
                  onClick={async () => {
                    if (!email) { setError('Enter your email first'); return; }
                    setError(''); setLoading(true);
                    try {
                      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, {
                        redirectTo: window.location.origin,
                      });
                      if (resetErr) throw resetErr;
                      setSuccess('Password reset link sent! Check your email.');
                    } catch (err: any) { setError(err.message); }
                    finally { setLoading(false); }
                  }}
                  className="w-full text-xs text-coral hover:underline"
                >
                  Forgot password?
                </button>
              )}
              <button type="button" onClick={() => { setShowEmailForm(false); setError(''); }}
                className="w-full text-xs text-gray-400 hover:text-gray-600">
                Back
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-sm mt-6">
          {isSignUp ? (
            <span className="text-gray-400">
              Already have an account?{' '}
              <button onClick={() => { setIsSignUp(false); setError(''); setSuccess(''); }} className="text-coral hover:underline font-medium">Sign in</button>
            </span>
          ) : (
            <span className="text-gray-400">
              Don't have an account?{' '}
              <button onClick={() => { setIsSignUp(true); setError(''); setSuccess(''); setShowEmailForm(true); }} className="text-coral hover:underline font-medium">Sign up</button>
            </span>
          )}
        </p>
        <p className="text-center text-xs text-gray-400 mt-2">
          Your account role is assigned by your coordinator
        </p>
      </div>
    </div>
  );
}
