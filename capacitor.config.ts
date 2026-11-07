export interface CapacitorConfig {
  appId: string;
  appName: string;
  webDir: string;
  bundledWebRuntime?: boolean;
  server?: {
    androidScheme?: 'http' | 'https';
    cleartext?: boolean;
    allowNavigation?: string[];
    url?: string;
  };
  plugins?: {
    CapacitorHttp?: {
      enabled?: boolean;
    };
  };
  android?: {
    allowMixedContent?: boolean;
    captureInput?: boolean;
    webContentsDebuggingEnabled?: boolean;
    backgroundColor?: string;
  };
}

const config: CapacitorConfig = {
  appId: 'com.annapurna.billing',
  appName: 'Annapurna Billing',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https',
    cleartext: false,
    // IMPORTANT: Do NOT add *.netlify.app or API domains to allowNavigation!
    // In Capacitor Android, hosts in allowNavigation are registered in WebViewLocalServer.authorityMatcher,
    // which intercepts fetch()/POST requests in shouldInterceptRequest() and causes "TypeError: Failed to fetch".
    allowNavigation: [],
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    backgroundColor: '#F8FAFC',
  },
};

export default config;
