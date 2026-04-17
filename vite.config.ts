import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const appsScriptUrl = String(env.LEADS_APPS_SCRIPT_URL ?? '').trim();
    const leadsProxy =
      appsScriptUrl.length > 0
        ? {
            '/api/leads-proxy': {
              target: new URL(appsScriptUrl).origin,
              changeOrigin: true,
              secure: true,
              rewrite: () => {
                const u = new URL(appsScriptUrl);
                return `${u.pathname}${u.search}`;
              },
            },
          }
        : undefined;

    return {
      // Expose GEMINI_API_KEY like Google AI Studio / other Gemini demos; VITE_* still works.
      envPrefix: ['VITE_', 'GEMINI_'],
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: leadsProxy,
      },
      preview: {
        host: '0.0.0.0',
        allowedHosts: [
          'pleasant-contentment-production.up.railway.app',
          'pleasant-contentment-production.up.railway.app:443',
          'pleasant-contentment-production.up.railway.app:80'
        ],
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
