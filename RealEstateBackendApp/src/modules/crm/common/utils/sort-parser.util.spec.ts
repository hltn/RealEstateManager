import { BusinessException } from '../../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../../common/exceptions/error-codes';
import { parseSort, ParsedSort } from './sort-parser.util';

const DEFAULT: ParsedSort = { field: 'name', direction: 1 };
const ALLOWED = ['name', 'createdAt'];

describe('parseSort', () => {
  it('không truyền sort thì dùng mặc định', () => {
    expect(parseSort(undefined, ALLOWED, DEFAULT)).toEqual(DEFAULT);
  });

  it('tiền tố "-" là giảm dần, không tiền tố là tăng dần', () => {
    expect(parseSort('-createdAt', ALLOWED, DEFAULT)).toEqual({
      field: 'createdAt',
      direction: -1,
    });
    expect(parseSort('createdAt', ALLOWED, DEFAULT)).toEqual({
      field: 'createdAt',
      direction: 1,
    });
  });

  it('field ngoài whitelist => 400 INVALID_SORT_FIELD kèm danh sách cho phép', () => {
    let thrown: unknown;
    try {
      parseSort('-password', ALLOWED, DEFAULT);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BusinessException);
    const exception = thrown as BusinessException;
    expect(exception.errorCode).toBe(ErrorCode.INVALID_SORT_FIELD);
    expect(exception.getStatus()).toBe(400);
    expect(exception.details).toEqual({ allowed: ALLOWED });
  });
});
