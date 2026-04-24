/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// Helper to load port from config.json
function getPort() {
  try {
    const configPath = path.resolve(process.cwd(), 'server/config/config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.service && config.service.port) {
        return parseInt(config.service.port, 10);
      }
    }
  } catch (e) {
    // ignore
  }
  return 5173; // Vite default
}

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
  server: {
    port: getPort(),
  },
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
