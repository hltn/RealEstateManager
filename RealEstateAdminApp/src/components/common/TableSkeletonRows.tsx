export interface TableSkeletonRowsProps {
  columnCount: number;
  rowCount?: number;
}

/** Skeleton loading cho bảng danh sách, giữ nguyên layout khi đang fetch dữ liệu. */
export const TableSkeletonRows = ({ columnCount, rowCount = 5 }: TableSkeletonRowsProps) => (
  <>
    {Array.from({ length: rowCount }).map((_, rowIndex) => (
      <tr key={`skeleton-row-${rowIndex}`} aria-hidden="true">
        {Array.from({ length: columnCount }).map((__, colIndex) => (
          <td key={`skeleton-cell-${rowIndex}-${colIndex}`} className="px-5 py-4">
            <div className="h-4 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
          </td>
        ))}
      </tr>
    ))}
  </>
);

export default TableSkeletonRows;
