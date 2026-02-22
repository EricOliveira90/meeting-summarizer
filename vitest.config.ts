import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // 1. Force Vitest to ignore build artifacts
    exclude: [
      '**/node_modules/**', 
      '**/dist/**', 
      '**/cypress/**', 
      '**/.{idea,git,cache,output,temp}/**'
    ],
    // 2. Ensure it only looks for source files
    include: ['packages/**/*.{test,spec}.{ts,tsx}'],
  },
  // 3. Teach Vitest how to resolve your local monorepo packages
  resolve: {
    alias: {
      '@meeting-summarizer/shared': path.resolve(__dirname, './packages/shared/src/index.ts')
    }
  }
});