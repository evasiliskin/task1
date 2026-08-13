import { buildReportFilename } from './report-path.util.js';

describe('buildReportFilename', () => {
  it('should return "<importId>.pdf", when importId is given', () => {
    const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

    expect(buildReportFilename(importId)).toBe(`${importId}.pdf`);
  });

  it('should return a filename ending in .pdf, when importId is omitted', () => {
    expect(buildReportFilename()).toMatch(/\.pdf$/);
  });

  it('should return a different filename on each call, when importId is omitted', () => {
    expect(buildReportFilename()).not.toBe(buildReportFilename());
  });
});
