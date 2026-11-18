/**
 * The site's icon set: authored paths on a 24 px grid, one stroke weight
 * (1.5), round joins, `currentColor`. No icon font, no emoji, no glyphs.
 */
const svg = (body, size = 16) =>
  `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`

export const icon = {
  timer: (s) => svg('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 2M9.5 2.5h5M12 2.5V6"/>', s),
  check: (s) => svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', s),
  chevron: (s) => svg('<path d="M9.5 5.5L16 12l-6.5 6.5"/>', s),
  shield: (s) => svg('<path d="M12 3l7.5 2.8v5.4c0 4.6-3 8-7.5 9.8-4.5-1.8-7.5-5.2-7.5-9.8V5.8L12 3z"/><path d="M8.8 12.2l2.3 2.3 4.2-4.6"/>', s),
  download: (s) => svg('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>', s),
  gauge: (s) => svg('<path d="M4.5 16.5a8 8 0 1 1 15 0"/><path d="M12 14l3.5-4.5"/><circle cx="12" cy="14.5" r="1"/>', s),
  target: (s) => svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.6"/>', s),
  book: (s) => svg('<path d="M5 4.5h10.5a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3V4.5z"/><path d="M5 17a3 3 0 0 1 3-3h10.5"/>', s),
  calendar: (s) => svg('<rect x="4" y="5.5" width="16" height="14" rx="1.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>', s),
  map: (s) => svg('<path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0c0 5.4 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.2"/>', s),
  menu: (s) => svg('<path d="M4.5 7h15M4.5 12h15M4.5 17h15"/>', s),
  close: (s) => svg('<path d="M6 6l12 12M18 6L6 18"/>', s),
}
