import { retryWithBackoff } from './retry.util.js';

describe('retryWithBackoff', () => {
  it('returns the result of the first attempt without retrying when it succeeds', async () => {
    const op = vi.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(op, { attempts: 3, baseDelayMs: 1 });

    expect(result).toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('a transient failure followed by a success results in exactly one successful outcome and exactly two attempts', async () => {
    const op = vi.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce('ok');
    const onRetry = vi.fn();

    const result = await retryWithBackoff(op, { attempts: 3, baseDelayMs: 1, onRetry });

    expect(result).toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
  });

  it('exhausts all attempts and throws the last error when every attempt fails', async () => {
    const err1 = new Error('fail-1');
    const err2 = new Error('fail-2');
    const op = vi.fn().mockRejectedValueOnce(err1).mockRejectedValueOnce(err2);

    await expect(retryWithBackoff(op, { attempts: 2, baseDelayMs: 1 })).rejects.toBe(err2);
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('never calls onRetry after the final attempt (no wasted backoff wait past the last try)', async () => {
    const op = vi.fn().mockRejectedValue(new Error('always fails'));
    const onRetry = vi.fn();

    await expect(retryWithBackoff(op, { attempts: 2, baseDelayMs: 1, onRetry })).rejects.toThrow();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
