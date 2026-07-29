export interface ImportRowError {
  sheet: string | null;
  row: number;
  field: string | null;
  message: string;
}

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: ImportRowError[];
  /** Thời gian xử lý phía server (ms) — chỉ một số endpoint trả về. */
  durationMs?: number;
  /** File Excel lỗi (base64) do server dựng sẵn — chỉ có khi import thất bại. */
  errorFile?: string | null;
  /** Tên file lỗi gợi ý đi kèm `errorFile`. */
  errorFileName?: string | null;
}

export type ImportMode = 'create' | 'update';
