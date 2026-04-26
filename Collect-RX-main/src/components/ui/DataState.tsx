import { Card } from './Card';
import { LoadingSpinner } from './LoadingSpinner';

type DataStateProps = {
  loading: boolean;
  error: string | null;
  /** When true and not loading/error, show empty state instead of children */
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyDetail?: string;
  children: React.ReactNode;
};

/**
 * P3-14 — shared loading / error / empty shell for data-driven pages.
 */
export function DataState({
  loading,
  error,
  isEmpty = false,
  emptyTitle = 'No data',
  emptyDetail = 'Try adjusting filters or refresh after new data is available.',
  children,
}: DataStateProps) {
  if (loading) {
    return <LoadingSpinner fullPage label="Loading…" />;
  }
  if (error) {
    return (
      <div className="page-enter p-6 flex-1 flex items-center justify-center">
        <Card className="text-center max-w-md w-full">
          <p className="text-sm font-medium text-red-600 dark:text-red-400">Something went wrong</p>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">{error}</p>
        </Card>
      </div>
    );
  }
  if (isEmpty) {
    return (
      <div className="page-enter p-6 flex-1 flex items-center justify-center">
        <Card className="text-center max-w-md w-full">
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{emptyTitle}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">{emptyDetail}</p>
        </Card>
      </div>
    );
  }
  return <>{children}</>;
}
