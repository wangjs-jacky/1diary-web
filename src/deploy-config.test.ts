import { describe, expect, it } from 'vitest';
import config from '../.appmanager/config.yaml?raw';

describe('production deployment config', () => {
  it('rebuilds the Vite bundle after writing production environment variables', () => {
    const envIndex = config.indexOf('> .env.production');
    const buildIndex = config.indexOf('pnpm build');
    const distCheckIndex = config.indexOf('if [ ! -f dist/index.html ]');

    expect(envIndex).toBeGreaterThan(-1);
    expect(buildIndex).toBeGreaterThan(envIndex);
    expect(distCheckIndex).toBeGreaterThan(buildIndex);
  });
});
