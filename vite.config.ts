import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
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
