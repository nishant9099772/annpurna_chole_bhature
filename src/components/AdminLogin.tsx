import React, { useState } from 'react';
import {
  Lock,
  User,
  UtensilsCrossed,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
  Eye,
  EyeOff,
  Server,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import {
  apiFetch,
  parseApiJsonResponse,
  getConfiguredApiBaseUrl,
  setConfiguredApiBaseUrl,
  verifyNetlifyBackendUrl,
  isCapacitorOrAndroidWebView,
} from '../utils/apiClient';

interface AdminLoginProps {
  onLoginSuccess: (token: string, username: string) => void;
}

export const AdminLogin: React.FC<AdminLoginProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Server URL Settings for Android APK -> Netlify Backend -> Google Sheets
  const isNativeApk = isCapacitorOrAndroidWebView();
  const [serverUrlInput, setServerUrlInput] = useState<string>(() => getConfiguredApiBaseUrl());
  const [showServerConfig, setShowServerConfig] = useState<boolean>(
    () => isNativeApk && !getConfiguredApiBaseUrl()
  );
  const [isTestingUrl, setIsTestingUrl] = useState(false);
  const [serverTestStatus, setServerTestStatus] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const handleSaveAndTestServerUrl = async () => {
    const trimmed = serverUrlInput.trim();
    if (!trimmed) {
      setConfiguredApiBaseUrl('');
      setServerUrlInput('');
      setServerTestStatus({
        ok: true,
        message: 'Cleared custom server URL (using default/local engine).',
      });
      return;
    }

    setIsTestingUrl(true);
    setServerTestStatus(null);
    try {
      const check = await verifyNetlifyBackendUrl(trimmed);
      if (check.reachable) {
        const saved = setConfiguredApiBaseUrl(check.normalizedUrl);
        setServerUrlInput(saved);
        setServerTestStatus({
          ok: true,
          message: `Connected to Netlify Backend (${saved}) in ${check.latencyMs}ms!`,
        });
      } else {
        // Still save if user entered a valid HTTPS URL, but warn if unreachable right now
        const saved = setConfiguredApiBaseUrl(trimmed);
        setServerUrlInput(saved);
        setServerTestStatus({
          ok: false,
          message: check.error || 'Saved URL, but server could not be verified.',
        });
      }
    } finally {
      setIsTestingUrl(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedUser = username.trim();
    if (!trimmedUser || !password) {
      setError('Please enter both your User ID and Password.');
      return;
    }

    if (serverUrlInput.trim() && serverUrlInput.trim() !== getConfiguredApiBaseUrl()) {
      setConfiguredApiBaseUrl(serverUrlInput.trim());
    }

    setIsLoading(true);

    try {
      const response = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ username: trimmedUser, password }),
      });

      const { ok, status, data } = await parseApiJsonResponse<{
        success?: boolean;
        token?: string;
        username?: string;
        error?: string;
      }>(response);

      if (!ok) {
        throw new Error(
          data?.error ||
            (status === 401
              ? 'Invalid User ID or Password. Access denied.'
              : `Authentication failed (HTTP ${status}). Please verify your User ID and Password.`)
        );
      }

      if (!data || !data.token) {
        throw new Error(
          data?.error || 'Authentication failed. Please verify your User ID and Password.'
        );
      }

      onLoginSuccess(data.token, data.username || trimmedUser);
    } catch (err: any) {
      setError(err.message || 'Login failed. Please verify your User ID and Password.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-[#FFFDF9] flex flex-col justify-center items-center px-3.5 py-6 sm:px-4 sm:py-8 safe-top safe-bottom">
      <div className="relative w-full max-w-md bg-white border border-amber-200/90 rounded-xl shadow-lg shadow-amber-900/5 p-5 sm:p-8">
        {/* Restaurant Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-lg bg-amber-500 text-white shadow-sm mb-2.5">
            <UtensilsCrossed className="w-6 h-6 sm:w-7 sm:h-7" />
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-amber-950 tracking-tight">
            Annpurna Chole Bhature
          </h1>
          <p className="text-xs sm:text-sm font-medium text-amber-800/80 mt-0.5">
            Billing &amp; Management Portal
          </p>
          <div className="inline-flex items-center gap-1.5 mt-2.5 px-2.5 py-1 bg-amber-50 border border-amber-200/70 rounded-md text-[11px] font-semibold text-amber-900">
            <ShieldCheck className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span>Protected Access — Sign In Required</span>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 text-red-700 text-xs sm:text-sm">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4" autoComplete="on">
          <div>
            <label
              htmlFor="login-userid"
              className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5"
            >
              User ID <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="login-userid"
                type="text"
                required
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your User ID"
                className="w-full pl-9 pr-3.5 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-base sm:text-sm text-slate-900 font-medium transition"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5"
            >
              Password <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full pl-9 pr-10 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-base sm:text-sm text-slate-900 font-medium transition"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1.5 cursor-pointer"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-1 py-3 px-4 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white font-bold rounded-lg shadow-sm flex items-center justify-center gap-2 transition disabled:opacity-60 cursor-pointer text-sm"
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Verifying Credentials...</span>
              </>
            ) : (
              <>
                <span>Sign In to Billing Counter</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Netlify Backend URL Configuration for Android APK */}
        <div className="mt-5 pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400">
              24h Session • Encrypted Auth
            </span>
            <button
              type="button"
              onClick={() => setShowServerConfig((prev) => !prev)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-amber-700 cursor-pointer"
            >
              <Server className="w-3 h-3" />
              <span>{showServerConfig ? 'Hide Server URL' : 'Server Settings'}</span>
            </button>
          </div>

          {showServerConfig && (
            <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2 text-left">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="netlify-server-url"
                  className="text-[11px] font-bold text-slate-700 uppercase tracking-wide"
                >
                  Netlify Backend URL (For Android Google Sheets)
                </label>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Enter your deployed Netlify site URL so the Android app syncs bills directly with Google Sheets via your Netlify backend.
              </p>
              <div className="flex gap-1.5">
                <input
                  id="netlify-server-url"
                  type="url"
                  value={serverUrlInput}
                  onChange={(e) => setServerUrlInput(e.target.value)}
                  placeholder="https://your-site.netlify.app"
                  className="flex-1 px-2.5 py-2 bg-white border border-slate-300 rounded-md text-xs font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
                <button
                  type="button"
                  onClick={handleSaveAndTestServerUrl}
                  disabled={isTestingUrl}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white font-semibold rounded-md text-xs shrink-0 disabled:opacity-50 cursor-pointer flex items-center gap-1"
                >
                  {isTestingUrl ? <RefreshCw className="w-3 h-3 animate-spin" /> : null}
                  <span>{isTestingUrl ? 'Testing...' : 'Save & Test'}</span>
                </button>
              </div>
              {serverTestStatus && (
                <div
                  className={`flex items-start gap-1.5 text-[11px] font-medium p-2 rounded-md ${
                    serverTestStatus.ok
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-amber-50 text-amber-800 border border-amber-200'
                  }`}
                >
                  {serverTestStatus.ok ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                  )}
                  <span>{serverTestStatus.message}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
