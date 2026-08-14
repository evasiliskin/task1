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
    const createIndex = vi.fn().mockResolvedValue('eventType_1_createdAt_-1');
    const collection = { createIndex } as unknown as Collection<IGithubEventDocument>;

    await ensureEventIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith({ eventType: 1, createdAt: -1 });
  });

  it('should create the repo.name filter index, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('repo.name_1_createdAt_-1');
    const collection = { createIndex } as unknown as Collection<IGithubEventDocument>;

    await ensureEventIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith({ 'repo.name': 1, createdAt: -1 });
  });

  it('should create the actor.login filter index, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('actor.login_1_createdAt_-1');
    const collection = { createIndex } as unknown as Collection<IGithubEventDocument>;

    await ensureEventIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith({ 'actor.login': 1, createdAt: -1 });
  });

  it('should create exactly five indexes, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('index');
    const collection = { createIndex } as unknown as Collection<IGithubEventDocument>;

    await ensureEventIndexes(collection);

    expect(createIndex).toHaveBeenCalledTimes(5);
  });
});
