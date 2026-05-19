import { describe, it, expect, vi } from 'vitest';

const { mockCreateServerActionHandler } = vi.hoisted(() => ({
  mockCreateServerActionHandler: vi.fn(() => ({ registerSocket: vi.fn() })),
}));

vi.mock('./createServerActionHandler', () => ({
  createServerActionHandler: mockCreateServerActionHandler,
}));

import { googleOAuthConfigAction } from '../../common/internalActions';
import { createGoogleConfigAction } from './googleConfigAction';

describe('createGoogleConfigAction', () => {
  it('calls createServerActionHandler with the googleOAuthConfigAction contract', () => {
    createGoogleConfigAction('my-client-id');
    expect(mockCreateServerActionHandler).toHaveBeenCalledWith(
      googleOAuthConfigAction,
      expect.any(Function),
      { isPublic: true },
    );
  });

  it('handler returns the configured clientId', async () => {
    createGoogleConfigAction('test-id-123');
    const handler = mockCreateServerActionHandler.mock.calls.at(-1)![1] as () => Promise<{ clientId: string }>;
    const result = await handler();
    expect(result).toEqual({ clientId: 'test-id-123' });
  });

  it('returns the result of createServerActionHandler', () => {
    const fakeHandler = { registerSocket: vi.fn() };
    mockCreateServerActionHandler.mockReturnValueOnce(fakeHandler);
    const result = createGoogleConfigAction('x');
    expect(result).toBe(fakeHandler);
  });
});
