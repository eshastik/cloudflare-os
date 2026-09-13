import { afterEach, expect, it, vi } from 'vitest';
import { maintainAccessLease } from '../src/access-lease.js';

afterEach(() => { vi.useRealTimers(); });

it('renews successful checks and expires once on denial', async () => {
  vi.useFakeTimers();
  const check = vi.fn().mockResolvedValue(undefined), expire = vi.fn();
  const stop = maintainAccessLease(check, expire);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(check).toHaveBeenCalledOnce(); expect(expire).not.toHaveBeenCalled();
  check.mockRejectedValue(new Error('revoked'));
  await vi.advanceTimersByTimeAsync(15_000);
  expect(expire).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(check).toHaveBeenCalledTimes(2); expect(expire).toHaveBeenCalledOnce(); stop();
});

it('expires a hung check and never revives the session on a late success', async () => {
  vi.useFakeTimers();
  let resolve!: () => void;
  const check = vi.fn(() => new Promise<void>(r => { resolve = r; })), expire = vi.fn();
  maintainAccessLease(check, expire);
  await vi.advanceTimersByTimeAsync(29_999); expect(expire).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(expire).toHaveBeenCalledOnce();
  resolve(); await vi.advanceTimersByTimeAsync(60_000);
  expect(check).toHaveBeenCalledOnce(); expect(expire).toHaveBeenCalledOnce();
});

it('stops on session disposal even with a check in flight', async () => {
  vi.useFakeTimers();
  let reject!: (e: Error) => void;
  const check = vi.fn(() => new Promise<void>((_r, j) => { reject = j; })), expire = vi.fn();
  const stop = maintainAccessLease(check, expire);
  await vi.advanceTimersByTimeAsync(15_000); stop();
  reject(new Error('late denial'));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(check).toHaveBeenCalledOnce(); expect(expire).not.toHaveBeenCalled();
});
