/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'express-middleware',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url?.startsWith('/api')) {
            const { app } = await server.ssrLoadModule('./server/index.ts');
            app(req, res, next);
          } else {
            next();
          }
        });
      },
    }
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './tests/setup.ts',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      include: ['src/**/*.{ts,tsx}', 'server/**/*.{ts,tsx}'],
      exclude: ['server/scripts/**'],
    }
  },
})
