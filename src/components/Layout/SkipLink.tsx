import { useTranslation } from 'react-i18next'

/**
 * "Skip to content" link: the first tab stop of every page, hidden until it
 * gets keyboard focus. It moves focus to `<main id="main" tabIndex={-1}>`
 * (both the desktop AppLayout and the web WebLayout render one).
 */
export function SkipLink() {
  const { t } = useTranslation()
  return (
    <a
      href="#main"
      onClick={(e) => {
        // HashRouter: a plain "#main" would be read as a route. Move focus instead.
        e.preventDefault()
        const main = document.getElementById('main')
        main?.focus()
        main?.scrollIntoView({ block: 'start' })
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-hextech-gold focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-hextech-black focus:outline-none focus:ring-2 focus:ring-hextech-gold-bright"
    >
      {t('common.skipToContent')}
    </a>
  )
}
