import {
  CatalogCodeOrphansError,
  migrateCatalogCodes,
} from '../modules/crm/catalogs/migrations/migrate-catalog-codes';
import type { MigrateCatalogCodesResult } from '../modules/crm/catalogs/migrations/migrate-catalog-codes';
import {
  migrateProjectPropertyTypeCodes,
  PropertyTypeFieldMissingError,
} from '../modules/crm/catalogs/migrations/migrate-project-property-type-codes';
import {
  CATALOG_CODES_USAGE,
  runCatalogCodesCli,
} from './crm-catalog-codes-app';
import { EXIT_CODE } from './migration-runner';

// Chỉ giả lập kết nối Mongo và hai bước migration để kiểm điều phối (thứ tự, gom lỗi, mã thoát).
// Hành vi ghi dữ liệu thật được kiểm ở file integration.
jest.mock('mongodb', () => {
  const actual = jest.requireActual<typeof import('mongodb')>('mongodb');
  return {
    ...actual,
    MongoClient: jest.fn(() => ({
      connect: jest.fn().mockResolvedValue(undefined),
      db: jest.fn().mockReturnValue({}),
      close: jest.fn().mockResolvedValue(undefined),
    })),
  };
});
jest.mock('../modules/crm/catalogs/migrations/migrate-catalog-codes', () => ({
  ...jest.requireActual<object>(
    '../modules/crm/catalogs/migrations/migrate-catalog-codes',
  ),
  migrateCatalogCodes: jest.fn(),
}));
jest.mock(
  '../modules/crm/catalogs/migrations/migrate-project-property-type-codes',
  () => ({
    ...jest.requireActual<object>(
      '../modules/crm/catalogs/migrations/migrate-project-property-type-codes',
    ),
    migrateProjectPropertyTypeCodes: jest.fn(),
  }),
);

const mock007 = migrateCatalogCodes as jest.MockedFunction<
  typeof migrateCatalogCodes
>;
const mock008 = migrateProjectPropertyTypeCodes as jest.MockedFunction<
  typeof migrateProjectPropertyTypeCodes
>;

const run = async (argv: string[], mongoUri: string | undefined) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCatalogCodesCli(argv, {
    mongoUri,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { code, out, err };
};

describe('runCatalogCodesCli', () => {
  beforeEach(() => {
    mock007.mockReset().mockResolvedValue({} as MigrateCatalogCodesResult);
    mock008.mockReset().mockResolvedValue({
      projectsCoded: 0,
      projectsWithUnmapped: 0,
      unmappedTexts: [],
    });
  });

  it('tham số lạ -> mã USAGE kèm hướng dẫn, không kết nối Mongo, không chạy bước nào', async () => {
    const { code, err, out } = await run(['--force'], 'mongodb://h/db');

    expect(code).toBe(EXIT_CODE.USAGE);
    expect(err.join('\n')).toContain('--force');
    expect(err.join('\n')).toContain(CATALOG_CODES_USAGE);
    expect(out).toEqual([]);
    expect(mock007).not.toHaveBeenCalled();
    expect(mock008).not.toHaveBeenCalled();
  });

  it('thiếu MONGODB_URI -> mã FAILURE', async () => {
    const { code, err } = await run([], undefined);

    expect(code).toBe(EXIT_CODE.FAILURE);
    expect(err).toEqual(['Thiếu biến môi trường MONGODB_URI.']);
  });

  it('không kết nối được Mongo -> mã FAILURE, in gợi ý kết nối, không lộ URI, không chạy bước nào', async () => {
    const { MongoClient } = jest.requireMock<{ MongoClient: jest.Mock }>(
      'mongodb',
    );
    MongoClient.mockImplementationOnce(() => ({
      connect: jest
        .fn()
        .mockRejectedValue(
          new Error('connect ECONNREFUSED mongodb://user:secret-pass@h/db'),
        ),
      db: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    }));

    const { code, err } = await run([], 'mongodb://user:secret-pass@h/db');

    expect(code).toBe(EXIT_CODE.FAILURE);
    const text = err.join('\n');
    expect(text).toContain('LỖI:');
    expect(text).toContain('Gợi ý');
    expect(text).not.toContain('secret-pass');
    expect(mock007).not.toHaveBeenCalled();
    expect(mock008).not.toHaveBeenCalled();
  });

  it('cả hai bước ok: chạy 007 rồi 008 với cùng cờ apply, mã thoát OK', async () => {
    const order: string[] = [];
    mock007.mockImplementation(() => {
      order.push('007');
      return Promise.resolve({} as MigrateCatalogCodesResult);
    });
    mock008.mockImplementation(() => {
      order.push('008');
      return Promise.resolve({
        projectsCoded: 0,
        projectsWithUnmapped: 0,
        unmappedTexts: [],
      });
    });

    const { code, out } = await run(['--apply'], 'mongodb://h/db');

    expect(code).toBe(EXIT_CODE.OK);
    expect(order).toEqual(['007', '008']);
    expect(mock007.mock.calls[0][1]).toBe(true);
    expect(mock008.mock.calls[0][1]).toBe(true);
    expect(out.join('\n')).toContain('[1/2] mã danh mục (007): OK');
    expect(out.join('\n')).toContain('[2/2] mã loại hình dự án (008): OK');
  });

  it('dry-run (mặc định): truyền apply=false cho cả hai bước', async () => {
    const { code } = await run([], 'mongodb://h/db');

    expect(code).toBe(EXIT_CODE.OK);
    expect(mock007.mock.calls[0][1]).toBe(false);
    expect(mock008.mock.calls[0][1]).toBe(false);
  });

  it('007 ném mồ côi: 008 vẫn chạy, mã thoát FAILURE, in id mồ côi', async () => {
    mock007.mockRejectedValue(
      new CatalogCodeOrphansError(
        ['customers:abc'],
        {} as MigrateCatalogCodesResult,
      ),
    );

    const { code, err, out } = await run(['--apply'], 'mongodb://h/db');

    expect(code).toBe(EXIT_CODE.FAILURE);
    expect(mock008).toHaveBeenCalledTimes(1);
    expect(err.join('\n')).toContain('LỖI [1/2]');
    expect(err.join('\n')).toContain('mồ côi customers:abc');
    expect(out.join('\n')).toContain('[1/2] mã danh mục (007): LỖI');
    expect(out.join('\n')).toContain('[2/2] mã loại hình dự án (008): OK');
  });

  it('008 ném thiếu trường property_type: mã thoát FAILURE, 007 đã chạy và báo OK', async () => {
    mock008.mockRejectedValue(
      new PropertyTypeFieldMissingError('không có trường'),
    );

    const { code, err, out } = await run(['--apply'], 'mongodb://h/db');

    expect(code).toBe(EXIT_CODE.FAILURE);
    expect(mock007).toHaveBeenCalledTimes(1);
    expect(err.join('\n')).toContain('LỖI [2/2]');
    expect(err.join('\n')).toContain('property_type');
    expect(out.join('\n')).toContain('[1/2] mã danh mục (007): OK');
    expect(out.join('\n')).toContain('[2/2] mã loại hình dự án (008): LỖI');
  });

  it('cả hai bước lỗi: mã thoát FAILURE, cả hai lỗi đều được in (không nuốt lỗi)', async () => {
    mock007.mockRejectedValue(new Error('boom-007'));
    mock008.mockRejectedValue(new Error('boom-008'));

    const { code, err } = await run(['--apply'], 'mongodb://h/db');

    expect(code).toBe(EXIT_CODE.FAILURE);
    const text = err.join('\n');
    expect(text).toContain('boom-007');
    expect(text).toContain('boom-008');
  });
});
