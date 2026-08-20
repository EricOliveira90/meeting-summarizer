import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

interface PackageLock {
  packages: Record<string, PackageManifest>;
}

const workspacePaths = [
  '',
  'packages/client',
  'packages/server',
  'packages/shared',
] as const;

function readJson<T>(relativePath: string): T {
  return JSON.parse(
    fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8'),
  ) as T;
}

describe('release baseline', () => {
  it('keeps workspace manifests and lockfile snapshots in sync', () => {
    const lockfile = readJson<PackageLock>('package-lock.json');

    for (const workspacePath of workspacePaths) {
      const manifestPath = workspacePath
        ? path.join(workspacePath, 'package.json')
        : 'package.json';
      const manifest = readJson<PackageManifest>(manifestPath);
      const snapshot = lockfile.packages[workspacePath];

      expect(snapshot?.dependencies ?? {}).toEqual(manifest.dependencies ?? {});
      expect(snapshot?.devDependencies ?? {}).toEqual(
        manifest.devDependencies ?? {},
      );
    }
  });

  it('builds shared before both runtime workspaces', () => {
    const manifest = readJson<PackageManifest>('package.json');

    expect(manifest.scripts?.build).toBe(
      'npm run build --workspace=packages/shared && ' +
        'npm run build --workspace=packages/client && ' +
        'npm run build --workspace=packages/server',
    );
  });

  it('uses the direct production audit as the sole security verdict', () => {
    const manifest = readJson<PackageManifest>('package.json');

    expect(manifest.scripts?.['audit:production']).toBe(
      'npm audit --omit=dev --audit-level=high',
    );
  });

  it('exposes the built-runtime smoke command', () => {
    const manifest = readJson<PackageManifest>('package.json');

    expect(manifest.scripts?.['smoke:built']).toBe(
      'node scripts/smoke-built-runtime.mjs',
    );
  });
});
