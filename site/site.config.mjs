/**
 * Public address of the showcase site, without a trailing slash, for example
 * 'https://ascend.example'. The SITE_URL environment variable overrides it.
 *
 * Empty means "preview": the build writes no canonical link and no sitemap
 * rather than a guessed address, and every page asks search engines not to
 * index it (a robots meta tag and an X-Robots-Tag header). Setting the address
 * is what opens the site to search engines; the build then refuses a legal
 * page that still prints a bracketed placeholder.
 */
export const SITE_URL = ''

/**
 * Where "request access" and "write to us" lead: the publisher's contact
 * address, the one the legal pages give.
 */
export const CONTACT_EMAIL = 'exciid501@gmail.com'
