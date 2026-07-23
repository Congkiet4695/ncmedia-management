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
}

export type ImportMode = 'create' | 'update';
