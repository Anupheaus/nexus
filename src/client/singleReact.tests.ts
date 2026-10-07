import { renderHook } from '@testing-library/react';
import { describe, it } from 'vitest';
import { useBound } from '@anupheaus/react-ui';

// A sibling react-ui checkout carries its own React 18 in its node_modules, while nexus renders with React 19. Two
// Reacts in one render break hooks with "Cannot read properties of null (reading 'useContext')", which says nothing
// about the cause (sc-2201). The client test project aliases react / react-dom to nexus's own copy so only one is
// loaded; this test fails with a message naming the cause if that ever stops being true.
describe('a single copy of React', () => {
  it('serves the hooks of @anupheaus/react-ui and nexus from the same React', () => {
    const renderReactUiHook = () => renderHook(() => useBound(() => undefined));

    try {
      renderReactUiHook();
    } catch (error) {
      throw new Error(
        'Two copies of React are loaded: @anupheaus/react-ui (probably a sibling checkout with its own node_modules) is using a ' +
        'different React from nexus. Alias react and react-dom to nexus\'s own copy in the client project of vitest.config.ts.',
        { cause: error },
      );
    }
  });
});
