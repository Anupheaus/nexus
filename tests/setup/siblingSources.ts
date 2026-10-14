import fs from 'fs';
import path from 'path';

/**
 * `resolve.alias` entries that point an `@anupheaus` package at a sibling checkout beside this repo when one is
 * present, exactly as tsconfig.json's `paths` do, so the tests run against the live sibling without waiting for it
 * to be built into a `dist`. In CI only this repo is checked out, so no alias is produced and the published
 * packages in node_modules are used unchanged.
 */
export function siblingAlias(repoDir: string): Record<string, string> {
  const alias: Record<string, string> = {};
  for (const packageName of ['common', 'react-ui']) {
    const source = path.resolve(repoDir, `../${packageName}/src`);
    if (fs.existsSync(source)) alias[`@anupheaus/${packageName}`] = source;
  }

  return alias;
}
