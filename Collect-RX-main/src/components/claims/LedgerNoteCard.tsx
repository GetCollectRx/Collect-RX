import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export interface ParsedClaimOutcome {
  carrierName: string;
  claimStatus: 'APPROVED' | 'DENIED' | 'HELD_AT_CARRIER' | 'RECONSIDERATION_REQUIRED';
  approvedAmount: number | null;
  remainingPatientResponsibility: number | null;
  nextActionRequired: string;
  ledgerNote: string;
  denialReasonCode?: string;
}

type LedgerNoteCardProps = {
  parsed: ParsedClaimOutcome;
};

const statusBadgeColor: Record<string, string> = {
  APPROVED: 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-100',
  DENIED: 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-100',
  HELD_AT_CARRIER: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-100',
  RECONSIDERATION_REQUIRED: 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-100',
};

const statusLabel: Record<string, string> = {
  APPROVED: 'Approved',
  DENIED: 'Denied',
  HELD_AT_CARRIER: 'Held at Carrier',
  RECONSIDERATION_REQUIRED: 'Reconsideration Required',
};

export function LedgerNoteCard({ parsed }: LedgerNoteCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(parsed.ledgerNote);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  return (
    <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-5 space-y-4">
      {/* Header with status badge and copy button */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-blue-800 dark:text-blue-200 tracking-wider uppercase">
              Parsed Claim Outcome
            </span>
            <span
              className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                statusBadgeColor[parsed.claimStatus] || 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100'
              }`}
            >
              {statusLabel[parsed.claimStatus] || parsed.claimStatus}
            </span>
          </div>
          <p className="text-sm text-blue-700 dark:text-blue-300">{parsed.carrierName}</p>
        </div>

        <button
          onClick={handleCopy}
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-all ${
            copied
              ? 'bg-green-600 dark:bg-green-700 text-white'
              : 'bg-blue-600 dark:bg-blue-700 text-white hover:bg-blue-700 dark:hover:bg-blue-600'
          }`}
          title="Copy ledger note to clipboard"
        >
          {copied ? (
            <>
              <Check size={14} />
              <span>Copied!</span>
            </>
          ) : (
            <>
              <Copy size={14} />
              <span>Copy Note</span>
            </>
          )}
        </button>
      </div>

      {/* Ledger note textarea */}
      <div className="space-y-1">
        <label htmlFor="ledger-note" className="block text-xs font-semibold text-blue-800 dark:text-blue-200 uppercase tracking-wide">
          Ledger Note (Ready to Copy)
        </label>
        <textarea
          id="ledger-note"
          readOnly
          value={parsed.ledgerNote}
          className="w-full p-3 rounded border border-blue-300 dark:border-blue-700 bg-white dark:bg-blue-950/50 text-gray-800 dark:text-gray-100 font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
          rows={2}
        />
      </div>

      {/* Financial summary if available */}
      {(parsed.approvedAmount !== null || parsed.remainingPatientResponsibility !== null) && (
        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-blue-200 dark:border-blue-800">
          {parsed.approvedAmount !== null && (
            <div>
              <p className="text-xs text-blue-700 dark:text-blue-300">Approved Amount</p>
              <p className="text-sm font-semibold text-green-700 dark:text-green-300">
                ${parsed.approvedAmount.toFixed(2)}
              </p>
            </div>
          )}
          {parsed.remainingPatientResponsibility !== null && (
            <div>
              <p className="text-xs text-blue-700 dark:text-blue-300">Patient Responsibility</p>
              <p className="text-sm font-semibold text-orange-700 dark:text-orange-300">
                ${parsed.remainingPatientResponsibility.toFixed(2)}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Next actions */}
      <div className="pt-2 border-t border-blue-200 dark:border-blue-800">
        <p className="text-xs font-semibold text-blue-800 dark:text-blue-200 uppercase tracking-wide">
          Next Action
        </p>
        <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">{parsed.nextActionRequired}</p>
      </div>

      {/* Denial reason if present */}
      {parsed.denialReasonCode && (
        <div className="pt-2 border-t border-blue-200 dark:border-blue-800">
          <p className="text-xs font-semibold text-blue-800 dark:text-blue-200 uppercase tracking-wide">
            Denial Code
          </p>
          <p className="text-sm font-mono text-blue-700 dark:text-blue-300 mt-1">{parsed.denialReasonCode}</p>
        </div>
      )}

      <p className="text-xs text-blue-600 dark:text-blue-400 italic pt-2">
        ✓ Powered by CollectRx Transcript Parser
      </p>
    </div>
  );
}
