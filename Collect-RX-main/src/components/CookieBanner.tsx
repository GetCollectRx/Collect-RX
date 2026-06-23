import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

const CONSENT_KEY = 'crx_cookie_consent_v1'

/**
 * P9-02, essential-cookie notice; “accept” records consent for in-app use of localStorage/session.
 */
export function CookieBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem(CONSENT_KEY)) setVisible(true)
    } catch {
      setVisible(true)
    }
  }, [])

  if (!visible) return null

  return (
    <div
      className="fixed bottom-0 inset-x-0 z-[100] border-t border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm px-4 py-3 shadow-lg"
      role="dialog"
      aria-label="Cookie notice"
    >
      <div className="max-w-3xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm text-gray-700 dark:text-gray-300">
        <p>
          We use essential cookies and local storage for sign-in and preferences. See our{' '}
          <Link to="/legal/privacy" className="text-crx-600 dark:text-crx-400 underline">
            Privacy Policy
          </Link>
          .
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to="/legal/privacy"
            className="text-2xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
          >
            Details
          </Link>
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg bg-crx-500 hover:bg-crx-600 text-white text-2xs font-medium"
            onClick={() => {
              try {
                localStorage.setItem(CONSENT_KEY, '1')
              } catch {
                /* ignore */
              }
              setVisible(false)
            }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
