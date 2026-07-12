import { describe, expect, it, vi } from 'vitest';
import { VoiceCloningService } from './voice-cloning.service';

describe('VoiceCloningService', () => {
  it('sends cancellation requests with authentication headers', () => {
    const post = vi.fn();
    const headers = { Authorization: 'Bearer test-token' };
    const service = new VoiceCloningService(
      { post } as never,
      { authHeaders: () => headers } as never,
    );

    service.cancelGeneration('job-123');

    expect(post).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith(
      '/api/generate/job-123/cancel',
      {},
      { headers },
    );
  });
});
