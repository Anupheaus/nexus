# Security advisories

`pnpm audit --audit-level=high` must stay clean for the Validate job in
`.github/workflows/publish.yml`. TK-8 fixed or overrode every high and critical
advisory, and removed the audit step's `continue-on-error`.

After those changes the audit still reports a small number of low and moderate
advisories. They are intentionally left unfixed for the reasons below; none of
them is in nexus's published runtime, and each is a build or test tool that
processes only the repository's own trusted files.

| Package | Severity | Advisory | Path | Reason left unfixed |
|---|---|---|---|---|
| `esbuild` | low | GHSA-g7r4-m6w7-qqqr | `@size-limit/preset-small-lib > @size-limit/esbuild > esbuild` and `tsup > esbuild` | Build tool only; the affected local dev server is never shipped or exposed to untrusted input. |
| `postcss-selector-parser` | low | GHSA-w9m9-85wc-3x92 | `css-loader > postcss-modules-local-by-default > postcss-selector-parser` | Build-time CSS processing of the repo's own styles; not part of the published runtime. |
| `postcss-selector-parser` | moderate | GHSA-rj75-hqrm-r3gf | `css-loader > postcss-modules-local-by-default > postcss-selector-parser` | Same build-time-only path; no untrusted selectors are parsed. |
| `vitest` | moderate | GHSA-82fw-gwwq-j7x9 | `vitest` | Test runner only; the redirect-mock vector requires a malicious test mock, not a consumer request. |
| `@vitest/mocker` | moderate | GHSA-82fw-gwwq-j7x9 | `vitest > @vitest/mocker` | Same test-runner-only path. |
| `fast-uri` | moderate | GHSA-hrr3-gc8f-f4qj | `copy-webpack-plugin > schema-utils > ajv > fast-uri` | Build tooling only; the URLs it parses are local webpack configuration, not untrusted input. |
| `fast-uri` | moderate | GHSA-jvvf-x445-j334 | `copy-webpack-plugin > schema-utils > ajv > fast-uri` | Same build-time-only path. |
