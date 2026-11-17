/* eslint-env browser */
/* global fetch, document */
// Points every [data-download] link at the newest Windows installer
// (pre-releases included — every Ascend beta is one) and fills
// [data-version]. Without JS, or if GitHub is unreachable, the links keep
// their href: the public releases page. Same logic as web/src/useLatestRelease.ts.
(function () {
  var REPO = 'ExCiiD/nexusmind'
  fetch('https://api.github.com/repos/' + REPO + '/releases?per_page=5', { headers: { Accept: 'application/vnd.github+json' } })
    .then(function (r) { return r.ok ? r.json() : [] })
    .then(function (releases) {
      var rel = null, asset = null
      for (var i = 0; i < releases.length && !asset; i++) {
        if (releases[i].draft) continue
        for (var j = 0; j < releases[i].assets.length; j++) {
          if (/Setup.*\.exe$/i.test(releases[i].assets[j].name)) { rel = releases[i]; asset = releases[i].assets[j]; break }
        }
      }
      if (!asset) return
      var version = rel.tag_name.replace(/^v/, '')
      var sizeMb = Math.round(asset.size / 1048576)
      document.querySelectorAll('[data-download]').forEach(function (a) { a.href = asset.browser_download_url })
      document.querySelectorAll('[data-version]').forEach(function (el) {
        el.textContent = 'v' + version + ' · ' + sizeMb + ' Mo · Windows 10/11'
        if (document.documentElement.lang === 'en') el.textContent = 'v' + version + ' · ' + sizeMb + ' MB · Windows 10/11'
      })
    })
    .catch(function () { /* keep the releases-page fallback */ })
})()
