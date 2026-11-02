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
    allowNavigation: [
      '*.netlify.app',
      '*.googleapis.com',
      '*.google.com',
      'wa.me',
      'api.whatsapp.com',
    ],
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    backgroundColor: '#F8FAFC',
  },
};

export default config;
