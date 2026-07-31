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
    fileParallelism: false,
    env: {
      CONFIG_DIR: path.resolve(__dirname, 'tests/tmp'),
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'server/**/*.{ts,tsx}'],
      // Type-only modules and the DOM bootstrap entry (no unit-test surface)
      exclude: [
        'server/scripts/**',
        // Process bootstrap (listen/exit/seed-at-import); pure helpers tested via unit tests
        'server/index.ts',
        'src/types.ts',
        'src/vite-env.d.ts',
        'src/main.tsx',
      ],
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      clean: true,
      // Full bar: keep raising as remaining edge paths are closed
      thresholds: {
        statements: 97,
        branches: 86,
        functions: 96,
        lines: 98,
      },
    }
  },
})
