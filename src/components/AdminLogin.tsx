import React, { useState } from 'react';
import { Lock, UtensilsCrossed, ArrowRight, ShieldCheck, AlertCircle } from 'lucide-react';

interface AdminLoginProps {
  onLoginSuccess: (token: string, username: string) => void;
}

export const AdminLogin: React.FC<AdminLoginProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const rawContentType = (response.headers.get('content-type') || '').toLowerCase();
      const text = await response.text();

      let data: any = null;
      if (rawContentType.includes('application/json')) {
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
      }

      if (!response.ok) {
        throw new Error(data?.error || `Authentication failed (HTTP ${response.status}). Please check credentials.`);
      }

      if (!data || !data.token) {
        throw new Error(`Invalid response received from server (HTTP ${response.status}).`);
      }

      onLoginSuccess(data.token, data.username);
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check backend credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FFFDF9] flex flex-col justify-center items-center px-4 py-8">
      {/* Decorative Warm Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-amber-100/60 blur-[100px] pointer-events-none rounded-full" />

      <div className="relative w-full max-w-md bg-white border border-amber-200/90 rounded-3xl shadow-xl shadow-amber-900/5 p-7 sm:p-9">
        {/* Restaurant Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500 text-white shadow-md shadow-amber-500/20 mb-3">
            <UtensilsCrossed className="w-8 h-8" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-amber-950 tracking-tight">
            Annpurna Chole Bhature
          </h1>
          <p className="text-sm font-medium text-amber-800/80 mt-1">
            Admin Billing System
          </p>
          <div className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 bg-amber-50 border border-amber-200/70 rounded-full text-xs font-semibold text-amber-900">
            <ShieldCheck className="w-3.5 h-3.5 text-amber-600" /> Authorized Admin Access Only
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-6 p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-red-700 text-sm">
            <AlertCircle className="w-5 h-5 shrink-0 text-red-500 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
              Admin Username
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. admin"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-slate-900 font-medium transition"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
              Admin Password
            </label>
            <div className="relative">
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter admin password"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-slate-900 font-medium transition"
              />
              <Lock className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Configured via backend environment variable <code className="text-amber-800 font-mono">ADMIN_PASSWORD</code> (default: <code className="text-amber-800 font-mono">annpurna123</code>).
            </p>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 py-3.5 px-5 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 text-white font-bold rounded-xl shadow-md shadow-amber-600/25 flex items-center justify-center gap-2 transition active:scale-[0.99] disabled:opacity-60 cursor-pointer"
          >
            {isLoading ? (
              <span>Verifying Admin Access...</span>
            ) : (
              <>
                <span>Enter Billing Counter</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Quick hint badge */}
        <div className="mt-7 pt-5 border-t border-slate-100 text-center">
          <p className="text-xs text-slate-500">
            For local evaluation, default credentials are <span className="font-semibold text-slate-700">admin</span> / <span className="font-semibold text-slate-700">annpurna123</span>
          </p>
        </div>
      </div>
    </div>
  );
};
