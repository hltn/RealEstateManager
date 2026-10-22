/**
 * Nhập khách từ CSV (X8, chỉ Quản trị): chọn mẫu cột -> chọn file -> map cột -> xem trước + lỗi từng dòng -> xác nhận nhập.
 * Mẫu DSKH / DSKH_DROP / DSKH_NET là cột theo mẫu tạm — cần đối chiếu file thật.
 * File .xlsx: prototype chưa đọc (không dùng gói `xlsx` vì lỗ hổng) — hướng dẫn lưu thành CSV UTF-8 trước khi nhập.
 */
import { useMemo, useState, type ChangeEvent } from 'react';
import { CircleAlert, FileUp, Upload } from 'lucide-react';
import { Modal } from '../../../../../components/ui/modal';
import { canImportCustomers, useCatalogs, useCrmActor, useCrmApi, usePhoneExists } from '@crm/api';
import { parseCsv } from '@crm/lib/csv';
import { autoMapColumns, checkImportLimits, IMPORT_PRESETS, IMPORT_TARGET_LABELS, IMPORT_TARGETS, validateImportRows, type ImportMapping, type ImportTarget } from '@crm/lib/importCustomers';
import { BUTTON_OUTLINE_CLASS, BUTTON_PRIMARY_CLASS, CHIP_SMALL_CLASS, CHIP_TONE_CLASS, FORM_LABEL_CLASS, SOLID_INPUT_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';

const PREVIEW_LIMIT = 50;

interface ParsedFile {
  fileName: string;
  headers: string[];
  rows: string[][];
}

const ImportCustomersModal = ({ onClose }: { onClose: () => void }) => {
  const api = useCrmApi();
  const { catalogs, users } = useCatalogs();
  const isPhoneTaken = usePhoneExists();
  const { showToast } = useCrmActions();
  const [presetCode, setPresetCode] = useState(IMPORT_PRESETS[0].code);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [skipped, setSkipped] = useState<{ row: number; message: string }[] | null>(null);
  const preset = IMPORT_PRESETS.find((item) => item.code === presetCode) ?? IMPORT_PRESETS[0];

  const results = useMemo(() => {
    if (!parsed || !mapping) return [];
    return validateImportRows(parsed.rows, mapping, { catalogs, users, isPhoneTaken, preset });
  }, [parsed, mapping, isPhoneTaken, catalogs, users, preset]);
  const validCount = results.filter((result) => result.data).length;

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      showToast({ type: 'warning', title: 'Chỉ nhận file CSV', message: 'Với file Excel (.xlsx): mở bằng Excel -> Lưu thành "CSV UTF-8" rồi nhập lại.' });
      return;
    }
    const text = await file.text();
    const [headers = [], ...rows] = parseCsv(text);
    const limitError = checkImportLimits(file.size, rows.length);
    if (limitError) {
      showToast({ type: 'error', title: 'Không nhập được file này', message: limitError });
      return;
    }
    setParsed({ fileName: file.name, headers, rows });
    setMapping(autoMapColumns(headers, preset));
  };

  const confirmImport = () => {
    const rows = results.flatMap((result) => (result.data ? [result.data] : []));
    const outcome = api.importCustomers(rows);
    if (!outcome.ok) {
      showToast({ type: 'error', title: outcome.error.message });
      return;
    }
    showToast({ title: `Đã nhập ${outcome.data.created} khách`, message: outcome.data.skipped.length > 0 ? `Bỏ qua ${outcome.data.skipped.length} dòng.` : undefined });
    if (outcome.data.skipped.length > 0) {
      // Giữ hộp thoại mở để người dùng xem chi tiết dòng bị bỏ qua.
      setSkipped(outcome.data.skipped);
      return;
    }
    onClose();
  };

  return (
    <Modal isOpen onClose={onClose} showCloseButton={false} className="mx-4 max-w-4xl overflow-hidden">
      <div role="dialog" aria-modal="true" aria-labelledby="crm-import-title" className="flex max-h-[90vh] flex-col">
        <header className="border-b border-gray-200 px-6 py-4 dark:border-gray-800">
          <h3 id="crm-import-title" className="text-lg font-semibold text-gray-800 dark:text-white/90">
            Nhập khách từ file CSV
          </h3>
          <p className="text-theme-xs text-gray-500 dark:text-gray-400">Kiểm tra từng dòng trước khi nhập. Dòng có lỗi sẽ không được nhập.</p>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="import-preset" className={FORM_LABEL_CLASS}>
                Mẫu cột
              </label>
              <select
                id="import-preset"
                value={presetCode}
                onChange={(event) => {
                  const nextPreset = IMPORT_PRESETS.find((item) => item.code === event.target.value) ?? IMPORT_PRESETS[0];
                  setPresetCode(nextPreset.code);
                  if (parsed) setMapping(autoMapColumns(parsed.headers, nextPreset));
                }}
                className={SOLID_INPUT_CLASS}
              >
                {IMPORT_PRESETS.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name}
                  </option>
                ))}
              </select>
              {preset.isAssumed && (
                <p className="mt-1.5 flex items-start gap-1 text-theme-xs text-warning-700 dark:text-warning-400">
                  <CircleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                  Cột theo mẫu tạm, cần đối chiếu file thật.
                </p>
              )}
            </div>
            <div>
              <span className={FORM_LABEL_CLASS}>File CSV (UTF-8)</span>
              <label className={`${BUTTON_OUTLINE_CLASS} w-full cursor-pointer`}>
                <FileUp size={18} aria-hidden="true" />
                {parsed ? parsed.fileName : 'Chọn file .csv'}
                <input type="file" accept=".csv,text/csv" className="sr-only" onChange={handleFile} />
              </label>
            </div>
          </div>

          {skipped && (
            <div role="alert" className="space-y-2 rounded-xl border border-warning-200 bg-warning-50 p-3 text-theme-xs text-warning-700 dark:border-warning-500/25 dark:bg-warning-500/10 dark:text-warning-400">
              <p className="font-semibold">{skipped.length} dòng bị bỏ qua khi nhập:</p>
              <ul className="custom-scrollbar max-h-40 space-y-0.5 overflow-auto">
                {skipped.map((item) => (
                  <li key={`${item.row}-${item.message}`}>
                    Dòng {item.row} (trong danh sách hợp lệ): {item.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {parsed && mapping && !skipped && (
            <>
              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold text-gray-800 dark:text-white/90">Map cột</legend>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {IMPORT_TARGETS.map((target: ImportTarget) => (
                    <label key={target} className="space-y-1 text-theme-xs text-gray-600 dark:text-gray-400">
                      <span>{IMPORT_TARGET_LABELS[target]}</span>
                      <select
                        value={mapping[target]}
                        onChange={(event) => setMapping({ ...mapping, [target]: Number(event.target.value) })}
                        className={SOLID_INPUT_CLASS}
                      >
                        <option value={-1}>— Không nhập —</option>
                        {parsed.headers.map((header, index) => (
                          <option key={`${header}-${index}`} value={index}>
                            {header || `Cột ${index + 1}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="space-y-2">
                <p className="text-theme-sm text-gray-700 dark:text-gray-300">
                  <strong>{validCount}</strong> dòng hợp lệ / {results.length} dòng.{' '}
                  {results.length > PREVIEW_LIMIT && <span className="text-gray-500">Hiển thị {PREVIEW_LIMIT} dòng đầu.</span>}
                </p>
                <div className="custom-scrollbar max-h-80 overflow-auto rounded-xl border border-gray-200 dark:border-white/[0.05]">
                  <table className="min-w-full text-theme-xs">
                    <thead className="bg-gray-50 text-left uppercase text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                      <tr>
                        <th className="px-3 py-2">Dòng</th>
                        <th className="px-3 py-2">Họ tên</th>
                        <th className="px-3 py-2">SĐT</th>
                        <th className="px-3 py-2">Kết quả kiểm tra</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                      {results.slice(0, PREVIEW_LIMIT).map((result) => (
                        <tr key={result.rowNumber}>
                          <td className="px-3 py-2 tabular-nums text-gray-500">{result.rowNumber}</td>
                          <td className="px-3 py-2 text-gray-800 dark:text-white/90">{parsed.rows[result.rowNumber - 2]?.[mapping.fullName] ?? ''}</td>
                          <td className="px-3 py-2 tabular-nums text-gray-700 dark:text-gray-300">{parsed.rows[result.rowNumber - 2]?.[mapping.phone] ?? ''}</td>
                          <td className="px-3 py-2">
                            {result.errors.length === 0 ? (
                              <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.success}`}>Hợp lệ</span>
                            ) : (
                              <ul className="space-y-0.5 text-error-600 dark:text-error-500">
                                {result.errors.map((error) => (
                                  <li key={error}>{error}</li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        <footer className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-800">
          <button type="button" onClick={onClose} className={BUTTON_OUTLINE_CLASS}>
            Đóng
          </button>
          <button type="button" onClick={confirmImport} disabled={validCount === 0 || skipped !== null} className={BUTTON_PRIMARY_CLASS}>
            <Upload size={16} aria-hidden="true" />
            Nhập {validCount} khách hợp lệ
          </button>
        </footer>
      </div>
    </Modal>
  );
};

/** Nút "Nhập CSV" ở đầu danh sách khách — chỉ hiện với Quản trị (04 §4.2: Import dữ liệu = Quản trị). */
export const ImportCustomersButton = () => {
  const actor = useCrmActor();
  const [isOpen, setIsOpen] = useState(false);
  if (!canImportCustomers(actor.role)) return null;
  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)} className={BUTTON_OUTLINE_CLASS}>
        <FileUp size={18} aria-hidden="true" />
        Nhập CSV
      </button>
      {isOpen && <ImportCustomersModal onClose={() => setIsOpen(false)} />}
    </>
  );
};
