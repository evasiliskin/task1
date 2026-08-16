import { ImportCounters } from './import-counters.js';

const emptyBatch = { insertedCount: 0, duplicateCount: 0, errorCount: 0, errorSample: [] };

describe('ImportCounters', () => {
  it('should report zeroes before anything is recorded', () => {
    expect(new ImportCounters().toResult()).toEqual({
      eventsProcessed: 0,
      validEvents: 0,
      invalidEvents: 0,
      duplicateEvents: 0,
      errorCount: 0,
    });
  });

  it('should tally invalid lines', () => {
    const counters = new ImportCounters();

    counters.recordInvalidLine();
    counters.recordInvalidLine();

    expect(counters.toResult()).toMatchObject({ invalidEvents: 2, eventsProcessed: 2 });
  });

  it('should tally a batch outcome', () => {
    const counters = new ImportCounters();

    counters.recordBatch({ ...emptyBatch, insertedCount: 10, duplicateCount: 3, errorCount: 1 });

    expect(counters.toResult()).toEqual({
      eventsProcessed: 14,
      validEvents: 10,
      invalidEvents: 0,
      duplicateEvents: 3,
      errorCount: 1,
    });
  });

  it('should sum eventsProcessed across every category', () => {
    const counters = new ImportCounters();

    counters.recordInvalidLine();
    counters.recordBatch({ ...emptyBatch, insertedCount: 2, duplicateCount: 1, errorCount: 1 });
    counters.recordBatch({ ...emptyBatch, insertedCount: 5 });

    expect(counters.toResult()).toEqual({
      eventsProcessed: 10,
      validEvents: 7,
      invalidEvents: 1,
      duplicateEvents: 1,
      errorCount: 1,
    });
  });

  it('should be order-independent', () => {
    const forwards = new ImportCounters();

    forwards.recordInvalidLine();
    forwards.recordBatch({ ...emptyBatch, insertedCount: 4 });

    const backwards = new ImportCounters();

    backwards.recordBatch({ ...emptyBatch, insertedCount: 4 });
    backwards.recordInvalidLine();

    expect(forwards.toResult()).toEqual(backwards.toResult());
  });
});
