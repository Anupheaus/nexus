import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * React versions nexus's client code supports. It only uses long-standing hooks and context, so it runs on
 * whatever React 18 or 19 the consumer has installed.
 */
const SUPPORTED_REACT_RANGE = '^18.2.0 || ^19.0.0';

/** Packages that must be a single shared copy in the consumer's tree, never one private to nexus. */
const SHARED_REACT_PACKAGES = ['react', 'react-dom'];

const MANIFEST_PATH = path.resolve(__dirname, '../../package.json');

function readManifest(): PackageManifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as PackageManifest;
}

// A second React installed for nexus makes pnpm resolve @anupheaus/react-ui (and emotion / mui) twice, so a
// consumer's providers and nexus's hooks see different contexts (Vision sc-497 / sc-498).
describe('package manifest', () => {
  it.each(SHARED_REACT_PACKAGES)('does not install its own copy of %s', packageName => {
    const { dependencies = {} } = readManifest();

    expect(dependencies).not.toHaveProperty(packageName);
  });

  it.each(SHARED_REACT_PACKAGES)('requires the consumer to provide %s 18.2+ or 19', packageName => {
    const { peerDependencies = {} } = readManifest();

    expect(peerDependencies[packageName]).toBe(SUPPORTED_REACT_RANGE);
  });

  it.each(SHARED_REACT_PACKAGES)('keeps %s available for its own build and tests', packageName => {
    const { devDependencies = {} } = readManifest();

    expect(devDependencies).toHaveProperty(packageName);
  });
});
