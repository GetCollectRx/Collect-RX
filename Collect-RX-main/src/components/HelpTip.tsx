import { useId, useState } from 'react';

/**
 * P9-01, small in-app “What is this?” control (toggle for mobile; avoid hover-only).
 */
export function HelpTip({ children, label = 'What is this?' }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  return (
    <span className="relative inline-flex items-center align-middle">
      <button
        type="button"
        className="w-5 h-5 shrink-0 rounded-full text-2xs font-semibold leading-none border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-crx-500/50"
        aria-label={label}
        aria-expanded={open}
        aria-controls={tipId}
        onClick={() => setOpen((v) => !v)}
      >
        ?
      </button>
      {open && (
        <span
          id={tipId}
          role="tooltip"
          className="absolute left-0 top-full z-30 mt-1 w-64 max-w-[min(16rem,calc(100vw-2rem))] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2.5 text-2xs text-gray-600 dark:text-gray-300 shadow-md"
        >
          {children}
        </span>
      )}
    </span>
  );
}
