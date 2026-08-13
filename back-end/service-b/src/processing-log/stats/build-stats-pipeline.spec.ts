import { buildStatsPipeline } from './build-stats-pipeline.js';

describe('buildStatsPipeline', () => {
  const expectedGroupStage = {
    $group: {
      _id: '$status',
      count: { $sum: 1 },
      eventsProcessed: { $sum: '$metadata.eventsProcessed' },
      validEvents: { $sum: '$metadata.validEvents' },
      invalidEvents: { $sum: '$metadata.invalidEvents' },
      errorCount: { $sum: '$metadata.errorCount' },
    },
  };

  it('should match every document and group by status, when importId is omitted', () => {
    expect(buildStatsPipeline()).toEqual([{ $match: {} }, expectedGroupStage]);
  });

  it('should match only the given importId, when importId is provided', () => {
    const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

    expect(buildStatsPipeline(importId)).toEqual([{ $match: { importId } }, expectedGroupStage]);
  });
});
