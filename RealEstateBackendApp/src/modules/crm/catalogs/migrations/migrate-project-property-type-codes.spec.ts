import type { Db } from 'mongodb';
import {
  migrateProjectPropertyTypeCodes,
  PropertyTypeFieldMissingError,
} from './migrate-project-property-type-codes';

/** Db giả tối thiểu: `persona_fields.findOne` + `projects.findOne/find/bulkWrite`. */
const buildFakeDb = (opts: {
  field: Record<string, unknown> | null;
  needingCodes: boolean;
  projects?: { _id: number; propertyTypes: string[] }[];
}) => {
  const bulkWrite = jest.fn().mockResolvedValue({ modifiedCount: 1 });
  const projectsFindOne = jest
    .fn()
    .mockResolvedValue(opts.needingCodes ? { _id: 1 } : null);
  const pending = [...(opts.projects ?? [])];
  const find = jest.fn().mockImplementation(() => ({
    sort: () => ({
      limit: () => ({ toArray: () => Promise.resolve(pending.splice(0)) }),
    }),
  }));
  const collection = (name: string) =>
    name === 'persona_fields'
      ? { findOne: jest.fn().mockResolvedValue(opts.field) }
      : { findOne: projectsFindOne, find, bulkWrite };
  const db = { collection } as unknown as Db;
  return { db, bulkWrite, projectsFindOne, find };
};

const FIELD = {
  options: [{ value: 'VILLA', label: 'Biệt thự', isActive: true }],
};

describe('migrateProjectPropertyTypeCodes: thiếu trường property_type', () => {
  it.each([true, false])(
    'không có dự án cần mã (apply=%s): thoát OK kèm cảnh báo, không ghi, không ném lỗi',
    async (apply) => {
      const { db, bulkWrite, find } = buildFakeDb({
        field: null,
        needingCodes: false,
      });
      const log = jest.fn();

      const result = await migrateProjectPropertyTypeCodes(db, apply, log);

      expect(result).toEqual({
        projectsCoded: 0,
        projectsWithUnmapped: 0,
        unmappedTexts: [],
      });
      expect(log).toHaveBeenCalledWith(expect.stringContaining('CẢNH BÁO'));
      expect(bulkWrite).not.toHaveBeenCalled();
      expect(find).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    'có dự án cần mã (apply=%s): vẫn ném PropertyTypeFieldMissingError',
    async (apply) => {
      const { db, bulkWrite } = buildFakeDb({
        field: null,
        needingCodes: true,
      });

      await expect(migrateProjectPropertyTypeCodes(db, apply)).rejects.toThrow(
        PropertyTypeFieldMissingError,
      );
      expect(bulkWrite).not.toHaveBeenCalled();
    },
  );

  it('trường có nhưng rỗng lựa chọn + có dự án cần mã: ném; không có dự án cần mã: OK cảnh báo', async () => {
    const empty = { options: [] };
    await expect(
      migrateProjectPropertyTypeCodes(
        buildFakeDb({ field: empty, needingCodes: true }).db,
        true,
      ),
    ).rejects.toThrow(PropertyTypeFieldMissingError);

    const log = jest.fn();
    await expect(
      migrateProjectPropertyTypeCodes(
        buildFakeDb({ field: empty, needingCodes: false }).db,
        true,
        log,
      ),
    ).resolves.toMatchObject({ projectsCoded: 0 });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('CẢNH BÁO'));
  });
});

describe('migrateProjectPropertyTypeCodes: có trường property_type (hành vi cũ)', () => {
  it('không kiểm "dự án cần mã", ánh xạ và ghi như cũ', async () => {
    const { db, bulkWrite, projectsFindOne } = buildFakeDb({
      field: FIELD,
      needingCodes: false,
      projects: [{ _id: 1, propertyTypes: ['Biệt thự', 'Lạ'] }],
    });

    const result = await migrateProjectPropertyTypeCodes(db, true);

    expect(projectsFindOne).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      projectsCoded: 1,
      projectsWithUnmapped: 1,
      unmappedTexts: ['Lạ'],
    });
    expect(bulkWrite).toHaveBeenCalledTimes(1);
  });
});
