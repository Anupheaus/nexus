import { vi } from 'vitest';

// @uiw/react-md-editor's ESM build imports ./index.css, which Node.js cannot
// handle in a test environment. Mock the module so the real ESM build is never
// loaded and the CSS import never executes.
vi.mock('@uiw/react-md-editor', () => ({ default: {}, commands: {}, MarkdownUtil: {} }));
