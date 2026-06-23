import { Link } from 'react-router-dom'

export default function LegalPrivacy() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-800 dark:text-gray-200">
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="text-sm text-crx-600 dark:text-crx-400">
            ← Sign in
          </Link>
          <span className="text-sm font-medium">CollectRx</span>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-8 space-y-4 text-sm leading-relaxed">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Privacy policy</h1>
        <p className="text-gray-500 dark:text-gray-400">Last updated: April 25, 2026 (template, have counsel review before production)</p>
        <p>
          This policy describes how CollectRx handles information in the product. Your practice is typically the
          “organization” using the service; patients should also receive notices from you as required by law.
        </p>
        <h2 className="text-base font-semibold text-gray-900 dark:text-white pt-2">Data we process</h2>
        <p>
          The application may process practice identifiers, session data, claim and balance data you import, and
          contact details needed for reminders and payment links. Payment card data is handled by Stripe; CollectRx
          does not store full card numbers in this flow.
        </p>
        <h2 className="text-base font-semibold text-gray-900 dark:text-white pt-2">Cookies and storage</h2>
        <p>
          We use essential cookies and browser storage (e.g. for sign-in state and theme). You can control browser
          cookies in your device settings. Some features require storage to function.
        </p>
        <h2 className="text-base font-semibold text-gray-900 dark:text-white pt-2">Subprocessors</h2>
        <p>
          Depending on your configuration, data may be processed by your hosting provider, database provider, email
          (e.g. SendGrid), SMS (e.g. Twilio), telephony (e.g. Vapi), and payments (Stripe). Use agreements and
          Data Processing Agreements your practice signs with those vendors.
        </p>
        <p>
          <Link to="/legal/terms" className="text-crx-600 dark:text-crx-400 underline">
            Terms of use
          </Link>
        </p>
      </main>
    </div>
  )
}
