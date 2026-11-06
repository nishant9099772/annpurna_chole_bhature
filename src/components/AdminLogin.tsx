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
  Receipt,
  ChefHat,
} from 'lucide-react';
import { UserRole } from '../types/billing';
import {
  apiFetch,
  parseApiJsonResponse,
  getConfiguredApiBaseUrl,
  setConfiguredApiBaseUrl,
  verifyNetlifyBackendUrl,
  isCapacitorOrAndroidWebView,
} from '../utils/apiClient';

interface AdminLoginProps {
  onLoginSuccess: (
    token: string,
    username: string,
    role: UserRole,
    expiresAt?: number
  ) => void;
}

const PROFILE_OPTIONS: Array<{
  role: UserRole;
  label: string;
  userId: string;
  subtitle: string;
}> = [
  {
    role: 'admin',
    label: 'Annapurna Admin',
    userId: 'annapurna_admin',
    subtitle: 'Full Access • Sales • Sheets • Kitchen',
  },
  {
    role: 'billing',
    label: 'Annapurna Billing',
    userId: 'annapurna_billing',
    subtitle: 'New Bill • Bill History • Order Status',
  },
  {
    role: 'order',
    label: 'Annapurna Order',
    userId: 'annapurna_order',
    subtitle: 'Kitchen Queue • 3-Min Timer • Start/Done',
  },
];

export const AdminLogin: React.FC<AdminLoginProps> = ({ onLoginSuccess }) => {
  const [selectedProfile, setSelectedProfile] = useState<UserRole>('admin');
  const [username, setUsername] = useState('annapurna_admin');
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

  const handleSelectProfile = (option: (typeof PROFILE_OPTIONS)[number]) => {
    setSelectedProfile(option.role);
    setUsername(option.userId);
    setPassword('');
    setError(null);
  };

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
        role?: UserRole;
        expiresAt?: number;
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

      const resolvedRole: UserRole =
        data.role === 'billing' || data.role === 'order' ? data.role : 'admin';

      onLoginSuccess(
        data.token,
        data.username || trimmedUser,
        resolvedRole,
        data.expiresAt
      );
    } catch (err: any) {
      setError(err.message || 'Login failed. Please verify your User ID and Password.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-[#FFFDF9] flex flex-col justify-center items-center px-3.5 py-6 sm:px-4 sm:py-8 safe-top safe-bottom">
      <div className="relative w-full max-w-md bg-white border border-amber-200/90 rounded-xl shadow-lg shadow-amber-900/5 p-5 sm:p-7">
        {/* Restaurant Header */}
        <div className="text-center mb-5">
          <div className="inline-flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-lg bg-amber-500 text-white shadow-sm mb-2">
            <UtensilsCrossed className="w-6 h-6 sm:w-7 sm:h-7" />
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-amber-950 tracking-tight">
            Annapurna Chole Bhature
          </h1>
          <p className="text-xs sm:text-sm font-medium text-amber-800/80 mt-0.5">
            Restaurant Management &amp; POS System
          </p>
          <div className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 bg-amber-50 border border-amber-200/70 rounded-md text-[11px] font-semibold text-amber-900">
            <ShieldCheck className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span>Select Profile — Role-Based Access Control</span>
          </div>
        </div>

        {/* 3-Profile Selector Tabs */}
        <div className="mb-4">
          <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-600 mb-1.5">
            Choose Login Profile
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            {PROFILE_OPTIONS.map((opt) => {
              const isSelected = selectedProfile === opt.role;
              return (
                <button
                  key={opt.role}
                  type="button"
                  onClick={() => handleSelectProfile(opt)}
                  className={`p-2.5 rounded-lg border text-left transition cursor-pointer flex flex-col justify-between ${
                    isSelected
                      ? 'bg-amber-50 border-amber-500 ring-2 ring-amber-500/20 text-amber-950'
                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    {opt.role === 'admin' && (
                      <ShieldCheck
                        className={`w-4 h-4 ${isSelected ? 'text-amber-600' : 'text-slate-400'}`}
                      />
                    )}
                    {opt.role === 'billing' && (
                      <Receipt
                        className={`w-4 h-4 ${isSelected ? 'text-blue-600' : 'text-slate-400'}`}
                      />
                    )}
                    {opt.role === 'order' && (
                      <ChefHat
                        className={`w-4 h-4 ${isSelected ? 'text-emerald-600' : 'text-slate-400'}`}
                      />
                    )}
                    {isSelected && (
                      <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                    )}
                  </div>
                  <div className="font-extrabold text-xs leading-tight">{opt.label}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5 leading-tight line-clamp-2">
                    {opt.subtitle}
                  </div>
                </button>
              );
            })}
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
                onChange={(e) => {
                  const val = e.target.value;
                  setUsername(val);
                  const lower = val.trim().toLowerCase();
                  if (lower.includes('billing')) setSelectedProfile('billing');
                  else if (lower.includes('order')) setSelectedProfile('order');
                  else if (lower.includes('admin')) setSelectedProfile('admin');
                }}
                placeholder="annapurna_admin / annapurna_billing / annapurna_order"
                className="w-full pl-9 pr-3.5 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-base sm:text-sm text-slate-900 font-mono font-semibold transition"
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
                placeholder={`Enter password for ${
                  selectedProfile === 'admin'
                    ? 'Annapurna Admin'
                    : selectedProfile === 'billing'
                    ? 'Annapurna Billing'
                    : 'Annapurna Order'
                }`}
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
                <span>
                  Sign In as{' '}
                  {selectedProfile === 'admin'
                    ? 'Annapurna Admin'
                    : selectedProfile === 'billing'
                    ? 'Annapurna Billing'
                    : 'Annapurna Order'}
                </span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Netlify Backend URL Configuration for Android APK */}
        <div className="mt-5 pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400">
              24h Auto-Logout Session • Scrypt Encrypted
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
