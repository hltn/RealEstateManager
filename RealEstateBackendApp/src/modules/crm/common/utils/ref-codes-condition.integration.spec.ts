/**
 * INTEGRATION: điều kiện `refInCondition`/`refArrayInCondition` (FR-40, Architecture 5.1.8a) chạy trên MongoDB thật
 * (mongodb-memory-server): khách đã backfill chỉ khớp một nhánh, khách chỉ có id / chỉ có code đều được lọc ra.
 */
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Collection, MongoClient, ObjectId } from 'mongodb';
import { createMemoryReplSet } from '../../../../shared/database/memory-replset.util';
import {
  refArrayInCondition,
  refInCondition,
} from './ref-codes-condition.util';

jest.setTimeout(300_000);

describe('ref-codes-condition (Mongo thật)', () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let customers: Collection;
  const src = new ObjectId();
  const otherSrc = new ObjectId();
  const prj = new ObjectId();
  const otherPrj = new ObjectId();

  beforeAll(async () => {
    replSet = await createMemoryReplSet();
    client = await MongoClient.connect(replSet.getUri());
    customers = client.db('t').collection('customers');
    await customers.insertMany([
      {
        n: 'both',
        sourceCode: 'S1',
        sourceId: src,
        interestedProjectCodes: ['P1'],
        interestedProjectIds: [prj],
      },
      { n: 'idOnly', sourceId: src, interestedProjectIds: [prj] },
      {
        n: 'idOnlyNull',
        sourceCode: null,
        sourceId: src,
        interestedProjectCodes: [],
        interestedProjectIds: [prj],
      },
      { n: 'codeOnly', sourceCode: 'S1', interestedProjectCodes: ['P1'] },
      {
        n: 'other',
        sourceCode: 'S2',
        sourceId: otherSrc,
        interestedProjectCodes: ['P2'],
        interestedProjectIds: [otherPrj],
      },
      // Dự án quan tâm: mã của P2 nhưng id cũ của P1 (dữ liệu lệch): đã backfill nên theo mã, không khớp P1.
      {
        n: 'projectCodeWins',
        sourceCode: 'S2',
        sourceId: otherSrc,
        interestedProjectCodes: ['P2'],
        interestedProjectIds: [prj],
      },
    ]);
  });

  afterAll(async () => {
    await client?.close();
    await replSet?.stop();
  });

  const names = async (filter: Record<string, unknown>): Promise<string[]> =>
    (await customers.find(filter).toArray()).map((c) => String(c.n)).sort();

  it('nguồn: khách đã backfill một lần, khách chỉ có id và chỉ có code đều được lọc ra', async () => {
    const result = await customers
      .find(
        refInCondition(
          { codeField: 'sourceCode', idField: 'sourceId' },
          { codes: ['S1'], ids: [src] },
        ),
      )
      .toArray();
    expect(result.map((c) => c.n).sort()).toEqual([
      'both',
      'codeOnly',
      'idOnly',
      'idOnlyNull',
    ]);
    expect(new Set(result.map((c) => String(c._id))).size).toBe(result.length);
  });

  it('nguồn: mã không tồn tại (ids rỗng) không khớp ai, kể cả khách có sourceId', async () => {
    expect(
      await names(
        refInCondition(
          { codeField: 'sourceCode', idField: 'sourceId' },
          { codes: ['KHONG_CO'], ids: [] },
        ),
      ),
    ).toEqual([]);
  });

  it('dự án: khách chưa có mã (vắng/rỗng) khớp theo id, khách đã có mã chỉ theo mã', async () => {
    expect(
      await names(
        refArrayInCondition(
          {
            codeField: 'interestedProjectCodes',
            idField: 'interestedProjectIds',
          },
          { codes: ['P1'], ids: [prj] },
        ),
      ),
    ).toEqual(['both', 'codeOnly', 'idOnly', 'idOnlyNull']);
  });

  it('dự án: khách đã backfill sang mã khác không bị nhánh id kéo vào (không đếm lặp)', async () => {
    const found = await names(
      refArrayInCondition(
        {
          codeField: 'interestedProjectCodes',
          idField: 'interestedProjectIds',
        },
        { codes: ['P1'], ids: [prj] },
      ),
    );
    expect(found).not.toContain('projectCodeWins');
  });

  it('dự án: mã không tồn tại không khớp ai', async () => {
    expect(
      await names(
        refArrayInCondition(
          {
            codeField: 'interestedProjectCodes',
            idField: 'interestedProjectIds',
          },
          { codes: ['KHONG_CO'], ids: [] },
        ),
      ),
    ).toEqual([]);
  });
});
