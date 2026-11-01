import type { CapacitorConfig } from '@capacitor/cli';

// The native shell bundles dist/. The Node API remains a separate service.
const config: CapacitorConfig = {
  appId: 'personal.hongguo.web',
  appName: '红果剧场',
  webDir: 'dist',
  backgroundColor: '#101014',
  ios: {
    contentInset: 'never',
    backgroundColor: '#101014',
  },
  android: {
    backgroundColor: '#101014',
  },
};

export default config;
