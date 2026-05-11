export interface PaginationQuery {
  page: number;
  limit: number;
  status?: string;
  search?: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedPatients<T> {
  patients: T[];
  pagination: PaginationMeta;
}

export interface ApiError {
  error: string;
  details?: string[];
}

export interface HealthResponse {
  status: 'healthy';
  uptime: number;
  timestamp: string;
  patients: number;
  practices: number;
}
