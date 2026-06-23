import { Link } from 'react-router-dom'

export default function LegalTerms() {
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
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Terms of use</h1>
        <p className="text-gray-500 dark:text-gray-400">Last updated: April 25, 2026 (template, have counsel review before production)</p>
        <p>
          CollectRx is a software tool for dental practices to help manage insurance A/R workflows, reminders, and
          related communications. By using the service, the practice agrees to use it only for lawful purposes and
          in compliance with applicable privacy and healthcare marketing rules in your jurisdiction.
        </p>
        <p>
          The product does not replace professional judgment, legal advice, or your obligations under PIPEDA, PHIPA, or
          other laws. You are responsible for the accuracy of data you import, for obtaining required consents from
          patients for communications, and for your agreements with vendors (e.g. email, SMS, payments).
        </p>
        <p>
          We may update these terms; material changes will be communicated through the product or your account contact
          as appropriate. Continued use after changes constitutes acceptance of the updated terms.
        </p>
        <p>
          <Link to="/legal/privacy" className="text-crx-600 dark:text-crx-400 underline">
            Privacy policy
          </Link>
        </p>
      </main>
    </div>
  )
}
