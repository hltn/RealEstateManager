import { MongoServerError, ObjectId } from 'mongodb';
import type { Db, MongoClient } from 'mongodb';

/**
 * Mongo GIẢ TRONG BỘ NHỚ cho unit test của runner/script migration (không cần mongod). KHÔNG phải mock "ghi lại lời
 * gọi": nó thật sự lưu và lọc tài liệu, nên test kiểm GIÁ TRỊ cuối cùng trong "DB" (mã khách, sổ migration, counter).
 *
 * Chỉ hỗ trợ đúng tập thao tác/toán tử mà runner và script bù mã dùng; gặp toán tử lạ, khóa có dấu chấm (đường dẫn
 * lồng nhau, ở cả filter lẫn update), `$inc`/`$max` trên giá trị không phải số thì NÉM LỖI (không im lặng trả kết quả
 * sai, tránh test xanh giả). `findOneAndUpdate` hỗ trợ cả `returnDocument: 'before'` (mặc định như driver) lẫn `'after'`.
 * Transaction giả lập rollback bằng ảnh chụp trước callback. Spec tự kiểm: `fake-mongo.fixture.spec.ts`.
 * Hành vi trên Mongo thật (replica set, unique index) vẫn do các file `*.integration.spec.ts` kiểm.
 */

export type FakeDoc = Record<string, unknown>;
type Filter = Record<string, unknown>;
type Update = Record<string, Record<string, unknown>>;

const DUPLICATE_KEY_ERROR_CODE = 11000;

const isOperatorObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !(value instanceof ObjectId) &&
  !(value instanceof Date) &&
  !Array.isArray(value) &&
  Object.keys(value).some((key) => key.startsWith('$'));

const valueEquals = (a: unknown, b: unknown): boolean => {
  if (a instanceof ObjectId && b instanceof ObjectId) return a.equals(b);
  if (a instanceof Date && b instanceof Date)
    return a.getTime() === b.getTime();
  return a === b;
};

/** Đánh giá một đối tượng toán tử (`{ $type, $not, $exists, ... }`) với giá trị của trường (`undefined` = thiếu trường). */
const matchOperators = (
  value: unknown,
  operators: Record<string, unknown>,
): boolean =>
  Object.entries(operators).every(([operator, operand]) => {
    switch (operator) {
      case '$type':
        if (operand !== 'string')
          throw new Error(`$type chưa hỗ trợ: ${String(operand)}`);
        return typeof value === 'string';
      case '$not':
        return !matchOperators(value, operand as Record<string, unknown>);
      case '$exists':
        return (value !== undefined) === operand;
      case '$ne':
        // Mongo: `$ne: null` loại cả trường null lẫn trường thiếu.
        return operand === null ? value != null : !valueEquals(value, operand);
      case '$in':
        return (operand as unknown[]).some((item) => valueEquals(value, item));
      case '$gt':
        return typeof value === 'number' && value > (operand as number);
      case '$regex':
        return (
          typeof value === 'string' && new RegExp(operand as string).test(value)
        );
      default:
        throw new Error(`Toán tử chưa hỗ trợ trong FakeMongo: ${operator}`);
    }
  });

const matches = (doc: FakeDoc, filter: Filter): boolean =>
  Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') {
      return (condition as Filter[]).some((branch) => matches(doc, branch));
    }
    if (key.startsWith('$'))
      throw new Error(`Toán tử cấp cao chưa hỗ trợ: ${key}`);
    if (key.includes('.'))
      throw new Error(
        `Khóa filter có dấu chấm chưa hỗ trợ trong FakeMongo: ${key}`,
      );
    const value = doc[key];
    return isOperatorObject(condition)
      ? matchOperators(value, condition)
      : valueEquals(value, condition);
  });

/** So sánh khi sort: thiếu trường xếp trước (như Mongo), ObjectId so theo hex. */
const compareValues = (a: unknown, b: unknown): number => {
  if (a === undefined || a === null)
    return b === undefined || b === null ? 0 : -1;
  if (b === undefined || b === null) return 1;
  const left =
    a instanceof ObjectId
      ? a.toHexString()
      : a instanceof Date
        ? a.getTime()
        : a;
  const right =
    b instanceof ObjectId
      ? b.toHexString()
      : b instanceof Date
        ? b.getTime()
        : b;
  if (left === right) return 0;
  return (left as number | string) < (right as number | string) ? -1 : 1;
};

const cloneDoc = (doc: FakeDoc): FakeDoc => ({ ...doc });

const SUPPORTED_UPDATE_OPERATORS = ['$set', '$inc', '$max'];

interface UpdateOutcome {
  modifiedCount: number;
  /** Tài liệu trước khi đổi (`null` khi không khớp hoặc upsert vừa tạo mới). */
  before: FakeDoc | null;
  /** Tài liệu sau khi đổi (`null` khi không khớp và không upsert). */
  after: FakeDoc | null;
}

/**
 * Từ chối update mà fixture không mô phỏng ĐÚNG, thay vì ghi sai im lặng: toán tử lạ, và khóa có dấu chấm (Mongo thật
 * hiểu là đường dẫn lồng nhau; fixture chỉ biết khóa phẳng).
 */
const assertSupportedUpdate = (update: Update): void => {
  for (const [operator, fields] of Object.entries(update)) {
    if (!SUPPORTED_UPDATE_OPERATORS.includes(operator)) {
      throw new Error(`Toán tử update chưa hỗ trợ: ${operator}`);
    }
    for (const field of Object.keys(fields)) {
      if (field.includes('.')) {
        throw new Error(
          `Khóa có dấu chấm chưa hỗ trợ trong FakeMongo (${operator} ${field}): Mongo thật ghi theo đường dẫn lồng nhau`,
        );
      }
    }
  }
};

/** `$inc`/`$max` chỉ mô phỏng trên số (Mongo thật: `$inc` lên giá trị không phải số là lỗi; `$max` so theo thứ tự BSON). */
const assertNumeric = (
  operator: '$inc' | '$max',
  field: string,
  current: unknown,
  operand: unknown,
): void => {
  if (
    typeof operand !== 'number' ||
    (current !== undefined && typeof current !== 'number')
  ) {
    throw new Error(
      `${operator} chỉ hỗ trợ số trong FakeMongo (trường "${field}": hiện có ${typeof current}, toán hạng ${typeof operand})`,
    );
  }
};

class FakeCursor {
  private sortSpec: Record<string, 1 | -1> = {};
  private maxItems = Infinity;

  constructor(private readonly docs: FakeDoc[]) {}

  sort(spec: Record<string, 1 | -1>): this {
    this.sortSpec = spec;
    return this;
  }

  limit(count: number): this {
    this.maxItems = count;
    return this;
  }

  toArray(): Promise<FakeDoc[]> {
    const sorted = [...this.docs].sort((a, b) => {
      for (const [field, direction] of Object.entries(this.sortSpec)) {
        const order = compareValues(a[field], b[field]);
        if (order !== 0) return order * direction;
      }
      return 0;
    });
    return Promise.resolve(sorted.slice(0, this.maxItems).map(cloneDoc));
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<FakeDoc> {
    for (const doc of await this.toArray()) yield doc;
  }
}

/** Điểm chen để test mô phỏng sự cố (ví dụ tiến trình khác cấp mã giữa lúc đọc lô và lúc ghi lô). */
export interface FakeMongoHooks {
  /**
   * Gọi khi mở mỗi transaction, TRƯỚC khi chụp ảnh rollback (số lần gọi tăng dần từ 1): thay đổi ở đây coi như đã
   * commit bởi tiến trình khác nên không bị rollback theo transaction của ta.
   */
  beforeTransaction?: (info: { call: number }) => void;
}

export class FakeMongo {
  private readonly store = new Map<string, FakeDoc[]>();
  private readonly collections = new Map<string, FakeCollection>();
  /** Số lần ghi (insert/update/delete/replace/bulkWrite/findOneAndUpdate) đã gọi: test "không ghi gì" kiểm số này. */
  writeCalls = 0;
  hooks: FakeMongoHooks = {};
  private transactionCalls = 0;

  constructor(private readonly replicaSetName: string | null = 'rs0') {}

  /** Nạp tài liệu (không tính vào `writeCalls`). */
  seed(collection: string, docs: FakeDoc[]): this {
    this.docsOf(collection).push(...docs.map(cloneDoc));
    return this;
  }

  /** Toàn bộ tài liệu hiện có của một collection (bản sao, theo thứ tự chèn). */
  all(collection: string): FakeDoc[] {
    return this.docsOf(collection).map(cloneDoc);
  }

  /** Ảnh chụp toàn bộ DB để so "trước/sau" (dry-run không được đổi gì). */
  snapshot(): Record<string, FakeDoc[]> {
    // Bỏ collection rỗng: đọc một collection chưa có (docsOf) chỉ tạo mảng rỗng, không phải thay đổi dữ liệu.
    return Object.fromEntries(
      [...this.store.entries()]
        .filter(([, docs]) => docs.length > 0)
        .map(([name, docs]) => [name, docs.map(cloneDoc)]),
    );
  }

  restore(snapshot: Record<string, FakeDoc[]>): void {
    this.store.clear();
    for (const [name, docs] of Object.entries(snapshot)) {
      this.store.set(name, docs.map(cloneDoc));
    }
  }

  docsOf(name: string): FakeDoc[] {
    let docs = this.store.get(name);
    if (!docs) {
      docs = [];
      this.store.set(name, docs);
    }
    return docs;
  }

  collection(name: string): FakeCollection {
    let collection = this.collections.get(name);
    if (!collection) {
      collection = new FakeCollection(this, name);
      this.collections.set(name, collection);
    }
    return collection;
  }

  /** `Db` giả: đủ cho runner (`collection`, `admin().command({ hello: 1 })`). */
  get db(): Db {
    return {
      collection: (name: string) => this.collection(name),
      admin: () => ({
        command: () =>
          Promise.resolve(
            this.replicaSetName === null
              ? {}
              : { setName: this.replicaSetName },
          ),
      }),
    } as unknown as Db;
  }

  /** `MongoClient` giả: `db()` và `startSession().withTransaction` (rollback nếu callback ném lỗi). */
  get client(): MongoClient {
    return {
      db: () => this.db,
      startSession: () => ({
        withTransaction: async <T>(work: () => Promise<T>): Promise<T> => {
          this.transactionCalls += 1;
          this.hooks.beforeTransaction?.({ call: this.transactionCalls });
          const before = this.snapshot();
          try {
            return await work();
          } catch (error) {
            this.restore(before);
            throw error;
          }
        },
        endSession: () => Promise.resolve(),
      }),
    } as unknown as MongoClient;
  }
}

class FakeCollection {
  constructor(
    private readonly owner: FakeMongo,
    private readonly name: string,
  ) {}

  private get docs(): FakeDoc[] {
    return this.owner.docsOf(this.name);
  }

  find(filter: Filter = {}): FakeCursor {
    return new FakeCursor(this.docs.filter((doc) => matches(doc, filter)));
  }

  findOne(filter: Filter = {}): Promise<FakeDoc | null> {
    const found = this.docs.find((doc) => matches(doc, filter));
    return Promise.resolve(found ? cloneDoc(found) : null);
  }

  countDocuments(filter: Filter = {}): Promise<number> {
    return Promise.resolve(
      this.docs.filter((doc) => matches(doc, filter)).length,
    );
  }

  insertOne(doc: FakeDoc): Promise<{ insertedId: unknown }> {
    this.owner.writeCalls += 1;
    if (this.docs.some((existing) => valueEquals(existing._id, doc._id))) {
      return Promise.reject(
        new MongoServerError({
          message: `E11000 duplicate key error: _id ${String(doc._id)}`,
          code: DUPLICATE_KEY_ERROR_CODE,
        }),
      );
    }
    this.docs.push(cloneDoc(doc));
    return Promise.resolve({ insertedId: doc._id });
  }

  deleteOne(filter: Filter): Promise<{ deletedCount: number }> {
    this.owner.writeCalls += 1;
    const index = this.docs.findIndex((doc) => matches(doc, filter));
    if (index === -1) return Promise.resolve({ deletedCount: 0 });
    this.docs.splice(index, 1);
    return Promise.resolve({ deletedCount: 1 });
  }

  replaceOne(
    filter: Filter,
    replacement: FakeDoc,
    options: { upsert?: boolean } = {},
  ): Promise<{ modifiedCount: number }> {
    this.owner.writeCalls += 1;
    const index = this.docs.findIndex((doc) => matches(doc, filter));
    if (index === -1) {
      if (options.upsert) this.docs.push(cloneDoc(replacement));
      return Promise.resolve({ modifiedCount: 0 });
    }
    this.docs[index] = cloneDoc(replacement);
    return Promise.resolve({ modifiedCount: 1 });
  }

  updateOne(
    filter: Filter,
    update: Update,
    options: { upsert?: boolean } = {},
  ): Promise<{ modifiedCount: number }> {
    this.owner.writeCalls += 1;
    return Promise.resolve({
      modifiedCount: this.applyUpdate(filter, update, options.upsert === true)
        .modifiedCount,
    });
  }

  /**
   * Trả tài liệu SAU cập nhật khi `returnDocument: 'after'`, TRƯỚC cập nhật khi `'before'` hoặc không truyền (đúng mặc định
   * của driver). Upsert vừa tạo mới mà đòi `'before'` thì trả `null` (trước đó chưa có tài liệu).
   */
  findOneAndUpdate(
    filter: Filter,
    update: Update,
    options: { upsert?: boolean; returnDocument?: 'after' | 'before' } = {},
  ): Promise<FakeDoc | null> {
    this.owner.writeCalls += 1;
    const outcome = this.applyUpdate(filter, update, options.upsert === true);
    return Promise.resolve(
      options.returnDocument === 'after' ? outcome.after : outcome.before,
    );
  }

  bulkWrite(
    operations: Array<{ updateOne: { filter: Filter; update: Update } }>,
  ): Promise<{ modifiedCount: number }> {
    this.owner.writeCalls += 1;
    let modifiedCount = 0;
    for (const { updateOne } of operations) {
      modifiedCount += this.applyUpdate(
        updateOne.filter,
        updateOne.update,
        false,
      ).modifiedCount;
    }
    return Promise.resolve({ modifiedCount });
  }

  /** Chỉ hỗ trợ pipeline `$match`, `$group` (`$sum: 1`) và `$count` mà script bù mã dùng. */
  aggregate(pipeline: Array<Record<string, unknown>>): {
    toArray: () => Promise<FakeDoc[]>;
  } {
    let rows: FakeDoc[] = this.docs.map(cloneDoc);
    for (const stage of pipeline) {
      if ('$match' in stage) {
        rows = rows.filter((row) => matches(row, stage.$match as Filter));
      } else if ('$group' in stage) {
        const group = stage.$group as { _id: string; total: { $sum: number } };
        const field = group._id.replace(/^\$/, '');
        const totals = new Map<string, FakeDoc>();
        for (const row of rows) {
          const key = String(row[field]);
          const current = totals.get(key) ?? { _id: row[field], total: 0 };
          current.total = (current.total as number) + group.total.$sum;
          totals.set(key, current);
        }
        rows = [...totals.values()];
      } else if ('$count' in stage) {
        rows =
          rows.length > 0 ? [{ [stage.$count as string]: rows.length }] : [];
      } else {
        throw new Error(
          `Stage aggregate chưa hỗ trợ: ${Object.keys(stage).join()}`,
        );
      }
    }
    return { toArray: () => Promise.resolve(rows) };
  }

  /**
   * Áp `$set`/`$inc`/`$max` lên tài liệu khớp đầu tiên (hoặc tạo mới khi upsert). Kiểm cú pháp update TRƯỚC khi đụng
   * tài liệu (update lỗi không để lại tài liệu upsert dở dang). `modifiedCount` = 1 nếu có tài liệu bị đổi.
   */
  private applyUpdate(
    filter: Filter,
    update: Update,
    upsert: boolean,
  ): UpdateOutcome {
    assertSupportedUpdate(update);
    let target = this.docs.find((doc) => matches(doc, filter));
    let inserted = false;
    if (!target) {
      if (!upsert) return { modifiedCount: 0, before: null, after: null };
      // Upsert: tài liệu mới mang các điều kiện bằng-giá-trị của filter (ở đây luôn là `_id`).
      const base: FakeDoc = {};
      for (const [key, condition] of Object.entries(filter)) {
        if (!isOperatorObject(condition)) base[key] = condition;
      }
      target = base;
      this.docs.push(target);
      inserted = true;
    }
    const before = inserted ? null : cloneDoc(target);
    let changed = inserted;
    for (const [operator, fields] of Object.entries(update)) {
      for (const [field, operand] of Object.entries(fields)) {
        const previous = target[field];
        if (operator === '$set') target[field] = operand;
        else if (operator === '$inc') {
          assertNumeric('$inc', field, previous, operand);
          target[field] =
            ((previous as number | undefined) ?? 0) + (operand as number);
        } else {
          assertNumeric('$max', field, previous, operand);
          target[field] = Math.max(
            (previous as number | undefined) ?? -Infinity,
            operand as number,
          );
        }
        if (!valueEquals(previous, target[field])) changed = true;
      }
    }
    return {
      modifiedCount: changed ? 1 : 0,
      before,
      after: cloneDoc(target),
    };
  }
}
