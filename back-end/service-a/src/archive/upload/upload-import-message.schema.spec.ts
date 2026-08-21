import { uploadImportMessageSchema } from './upload-import-message.schema.js';

describe('uploadImportMessageSchema', () => {
  const validMessage = {
    importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    filePath: '/data/archives/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.json.gz',
  };

  it('should accept a valid message, when importId is a UUID and filePath is non-empty', () => {
    expect(uploadImportMessageSchema.parse(validMessage)).toEqual(validMessage);
  });

  it('should throw, when importId is not a UUID', () => {
    expect(() =>
      uploadImportMessageSchema.parse({ ...validMessage, importId: 'not-a-uuid' }),
    ).toThrow();
  });

  it('should throw, when filePath is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { filePath, ...withoutFilePath } = validMessage;

    expect(() => uploadImportMessageSchema.parse(withoutFilePath)).toThrow();
  });

  it('should throw, when filePath is an empty string', () => {
    expect(() => uploadImportMessageSchema.parse({ ...validMessage, filePath: '' })).toThrow();
  });
});
