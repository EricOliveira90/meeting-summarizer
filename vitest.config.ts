import { defineConfig } from 'vitest/config';

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
});