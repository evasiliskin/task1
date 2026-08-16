import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection } from 'mongodb';

import { ensureEventIndexes } from './ensure-event-indexes.js';

describe('ensureEventIndexes', () => {
  it('should create the unique eventId index, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('eventId_1');
    const collection = { createIndex } as unknown as Collection<IGithubEventDocument>;

    await ensureEventIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith({ eventId: 1 }, { unique: true });
  });

  it('should create the default pagination index, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('createdAt_-1_eventId_-1');
    const collection = { createIndex } as unknown as Collection<IGithubEventDocument>;

    await ensureEventIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith({ createdAt: -1, eventId: -1 });
  });

  it('should create the eventType filter index, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('eventType_1_createdAt_-1_eventId_-1');
    const collection = { createIndex } as unknown as Collection<IGithubEventDocument>;

    await ensureEventIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith({ eventType: 1, createdAt: -1, eventId: -1 });
  });

  it('should create the repo.name filter index, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('repo.name_1_createdAt_-1_eventId_-1');
    const collection = { createIndex } as unknown as Collection<IGithubEventDocument>;

    await ensureEventIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith({ 'repo.name': 1, createdAt: -1, eventId: -1 });
  });

  it('should create the actor.login filter index, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('actor.login_1_createdAt_-1_eventId_-1');
    const collection = { createIndex } as unknown as Collection<IGithubEventDocument>;

    await ensureEventIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith({ 'actor.login': 1, createdAt: -1, eventId: -1 });
  });

  it('should include the eventId tiebreaker in every compound index, so the keyset sort is index-covered', async () => {
    const createIndex = vi.fn().mockResolvedValue('ok');

    await ensureEventIndexes({ createIndex } as unknown as Collection<IGithubEventDocument>);

    expect(createIndex).toHaveBeenCalledWith({ eventType: 1, createdAt: -1, eventId: -1 });
    expect(createIndex).toHaveBeenCalledWith({ 'repo.name': 1, createdAt: -1, eventId: -1 });
    expect(createIndex).toHaveBeenCalledWith({ 'actor.login': 1, createdAt: -1, eventId: -1 });
  });

  it('should create exactly five indexes, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('index');
    const collection = { createIndex } as unknown as Collection<IGithubEventDocument>;

    await ensureEventIndexes(collection);

    expect(createIndex).toHaveBeenCalledTimes(5);
  });

  it('should create every index without serialising the round trips', async () => {
    let inFlight = 0;
    let peak = 0;
    const createIndex = vi.fn().mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
    });

    await ensureEventIndexes({ createIndex } as never);

    expect(createIndex).toHaveBeenCalledTimes(5);
    expect(peak).toBeGreaterThan(1);
  });
});
