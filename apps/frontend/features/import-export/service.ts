import { apiClient } from '@/services/api-client';
import type { ApiResponse } from '@/types/api';
import type { ImportResult, ImportRowError } from './types';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Tải file (blob) từ 1 endpoint export → lưu về máy. */
export async function downloadXlsx(path: string, filename: string): Promise<void> {
  const res = await apiClient.get<Blob>(path, { responseType: 'blob' });
  triggerDownload(new Blob([res.data], { type: XLSX_MIME }), filename);
}

/** Upload 1 file .xlsx tới endpoint import → trả ImportResult. */
export async function uploadXlsx(
  path: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ImportResult> {
  const form = new FormData();
  form.append('file', file);
  const res = await apiClient.post<ApiResponse<ImportResult>>(path, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });
  return res.data.data;
}

/** Tạo file CSV danh sách lỗi để tải xuống (UTF-8 BOM cho Excel/tiếng Việt). */
export function downloadErrorCsv(errors: ImportRowError[], filename: string): void {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['Sheet', 'Row', 'Field', 'Message'].map(esc).join(',');
  const body = errors.map((e) => [e.sheet, e.row, e.field, e.message].map(esc).join(',')).join('\n');
  const blob = new Blob(['﻿' + header + '\n' + body], { type: 'text/csv;charset=utf-8' });
  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
