/**
 * « Back » of a page opened from elsewhere (the Record player is opened from the Mistake Lab, the session stats, the objective list…):
 * return to the page it came from, with the router history, when that entry belongs to the app. React Router gives the first entry of the
 * session the key « default »: there is nothing to go back to, so the page's own parent (the Record hub) is the fallback.
 */
export function backTarget(locationKey: string | undefined, fallback: string): -1 | string {
  return locationKey && locationKey !== 'default' ? -1 : fallback
}
