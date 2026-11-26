import { useTranslation } from 'react-i18next'

const SEEN_KEY = 'nm.youtube.termsSeen'
export const YOUTUBE_TERMS_URL = 'https://www.youtube.com/t/terms'

/** Shown under the YouTube button until the first upload (docs/prod/GOOGLE_YOUTUBE_VERIFICATION.md § 3.6). */
export function youtubeTermsSeen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === '1' } catch { return false }
}
export function markYoutubeTermsSeen() {
  try { localStorage.setItem(SEEN_KEY, '1') } catch { /* shown again next time: harmless */ }
}

/**
 * « En publiant, tu acceptes les Conditions d'utilisation de YouTube. Ascend ne lit rien de ta chaîne. » — required
 * for the Google verification of the youtube.upload scope (§ 3.6), with the link to YouTube's terms.
 */
export function YoutubeTermsNote() {
  const { t } = useTranslation()
  if (youtubeTermsSeen()) return null
  return (
    <p className="w-full text-[11px] text-hextech-text-dim" data-testid="youtube-terms">
      {t('recording.youtubeTerms.before')}
      <a href={YOUTUBE_TERMS_URL} target="_blank" rel="noreferrer" className="text-hextech-gold hover:underline">{t('recording.youtubeTerms.link')}</a>
      {t('recording.youtubeTerms.after')}
    </p>
  )
}
