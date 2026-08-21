import { downloadImportMessageSchema } from './download-import-message.schema.js';

describe('downloadImportMessageSchema', () => {
  const validMessage = {
    importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    dateHour: '2026-08-11-0',
  };

  it('should accept a valid message, when importId is a UUID and dateHour is non-empty', () => {
    expect(downloadImportMessageSchema.parse(validMessage)).toEqual(validMessage);
  });

  it('should throw, when importId is not a UUID', () => {
    expect(() =>
      downloadImportMessageSchema.parse({ ...validMessage, importId: 'not-a-uuid' }),
    ).toThrow();
  });

  it('should throw, when dateHour is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { dateHour, ...withoutDateHour } = validMessage;

    expect(() => downloadImportMessageSchema.parse(withoutDateHour)).toThrow();
  });

  it('should throw, when dateHour is an empty string', () => {
    expect(() => downloadImportMessageSchema.parse({ ...validMessage, dateHour: '' })).toThrow();
  });
});
