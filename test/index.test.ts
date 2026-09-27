/**
 * Unit/integration tests for the project entry. No live third-party services.
 */
import { describe, it } from 'node:test';
import { expect } from 'chai';
import { readFile } from 'node:fs/promises';

describe('a unit or integration test', () => {

  it('happy path 1', () => {
    // TODO: implement
  });

  it('happy path 2', () => {
    // TODO: implement
  });

  it('failure path 1', () => {
    // TODO: implement
  });
});

describe('a package hygiene check', () => {
  it('keeps the root package private with test scripts', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.private).to.equal(true);
    expect(pkg.scripts).to.include.keys('test', 'test:e2e');
  });
});