// Hopprint line icons. 20×20 grid, stroke = currentColor.
// Usage: icon('checkin')            -> SVG string, 20px, stroke 2.2
//        icon('checkin', 19, 2.3)   -> nav size/weight
// Paths that carry their own stroke-width (print, beers) keep it at every size.
const ICON_PATHS = {
  'checkin': '<path d="M6.4 3h7.2a.7.7 0 0 1 .7.7L14.08 7H5.92L5.7 3.7A.7.7 0 0 1 6.4 3Z" fill="currentColor" stroke="none"></path><circle cx="13.7" cy="2.4" r="1.5" fill="currentColor" stroke="none"></circle><path d="M6.4 3h7.2a.7.7 0 0 1 .7.7l-.8 12.2a1.7 1.7 0 0 1-1.7 1.6H8.2a1.7 1.7 0 0 1-1.7-1.6L5.7 3.7A.7.7 0 0 1 6.4 3Z"></path>',
  'beers': '<path d="M2.9 3.4h5.2M3.2 3.9 3.8 11.8M11.9 3.4h5.2M16.8 3.9 16.2 11.8" stroke-width="1.6"></path><path d="M7.1 6.4h5.8a.6.6 0 0 1 .6.6l-.19 2.9H6.69L6.5 7A.6.6 0 0 1 7.1 6.4Z" fill="currentColor" stroke="none"></path><circle cx="12.9" cy="5.8" r="1.15" fill="currentColor" stroke="none"></circle><path d="M7.1 6.4h5.8a.6.6 0 0 1 .6.6l-.55 8.5a1.4 1.4 0 0 1-1.4 1.3H8.45a1.4 1.4 0 0 1-1.4-1.3L6.5 7A.6.6 0 0 1 7.1 6.4Z"></path>',
  'stats': '<path d="M4 16V9M10 16V4M16 16v-5"></path>',
  'print': '<path stroke-linejoin="round" stroke-width="1.3" d="M7 3C4.6 3.8 2.6 5.3 2.4 7.6c-.1 1.8.2 3.4 1.3 4.9 1-.2 1.9-.7 2.3-1.1-.4-1-.5-2-.4-2.8 1.4 2.2 3.6 3.6 6.1 4 1.3-2.3 1.6-4.8.9-7.2.8.8 1.6 1.8 1.8 2 .9-.2 1.7-.6 2.3-1.2C15.8 3.6 14 2.3 12.8 1.3 10.9.8 9 1.4 7 3zM16.2 7.3c1.2 1.3 1.8 2.9 1.6 5-1.6.6-3.2.2-4.6-.5.4-1.2.6-2.4.5-3.4.9-.3 1.8-.6 2.5-1.1zM16 13.3c.2 2-.4 4-1.6 5.5-1.8-.2-3.6-1.2-4.8-2.4.6-.9 1.1-1.9 1.5-2.8.5.2 1 .3 1.4.3.2-.5.4-.9.6-1.3.9.4 1.9.6 2.9.7zM4.9 12.8c.1 2 1.1 3.5 2.7 4.4 1.4-.8 2.2-2.3 2.6-3.9-1.1-.5-2.1-.9-2.9-1.7-.7.5-1.5.9-2.4 1.2z"></path><path stroke-linejoin="round" stroke-width="2.3" d="M6.2 .9 7 3M7 3C4.6 3.8 2.6 5.3 2.4 7.6c-.1 1.8.2 3.4 1.3 4.9M4.9 12.8c.1 2 1.1 3.5 2.7 4.4M9.6 16.4c1.2 1.2 3 2.2 4.8 2.4 1.2-1.5 1.8-3.5 1.6-5.5M17.8 12.3c.2-2.1-.4-3.7-1.6-5M16.7 6.2C15.8 3.6 14 2.3 12.8 1.3 10.9.8 9 1.4 7 3"></path>',
  'discover': '<circle cx="10" cy="10" r="7"></circle><circle cx="10" cy="10" r="2.6"></circle>',
  'calendar': '<rect x="3" y="4.5" width="14" height="13" rx="3"></rect><path d="M3 8.5h14M7 3v3M13 3v3"></path>',
  'venue': '<path d="M10 17.5s5.5-5 5.5-9a5.5 5.5 0 0 0-11 0c0 4 5.5 9 5.5 9Z"></path><circle cx="10" cy="8.4" r="1.9"></circle>',
  'wishlist': '<path d="M4 5.5h12v9l-4-2.4-4 2.4Z"></path>',
  'sort': '<path d="M3 5.5h14M5.5 10h9M8 14.5h4"></path>',
  'search': '<circle cx="9" cy="9" r="5.5"></circle><path d="M13.2 13.2 17 17"></path>',
  'chevron': '<path d="M5.5 8 10 12.5 14.5 8"></path>',
  'share': '<path d="M10 13V4M6.5 7.5 10 4l3.5 3.5"></path><path d="M4 16.5h12"></path>',
  'rating-never': '<circle cx="10" cy="10" r="7.2"></circle><circle cx="7.5" cy="8.2" r="1.05" fill="currentColor" stroke="none"></circle><circle cx="12.5" cy="8.2" r="1.05" fill="currentColor" stroke="none"></circle><path d="M6.8 13.8Q10 10.9 13.2 13.8"></path>',
  'rating-maybe': '<circle cx="10" cy="10" r="7.2"></circle><circle cx="7.5" cy="8.2" r="1.05" fill="currentColor" stroke="none"></circle><circle cx="12.5" cy="8.2" r="1.05" fill="currentColor" stroke="none"></circle><path d="M7.1 12.8 12.9 12.5"></path>',
  'rating-definitely': '<circle cx="10" cy="10" r="7.2"></circle><circle cx="7.5" cy="8.2" r="1.05" fill="currentColor" stroke="none"></circle><circle cx="12.5" cy="8.2" r="1.05" fill="currentColor" stroke="none"></circle><path d="M6.8 11.5Q10 14.8 13.2 11.5"></path>',
  'occasion-home-solo': '<path d="M3 9.5 10 4l7 5.5V16a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 16Z"></path>',
  'occasion-home-social': '<path d="M3 9.5 10 4l7 5.5V16a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 16Z"></path><circle cx="10" cy="12" r="1.6"></circle>',
  'occasion-bar': '<path d="M6 3h8l-1 12.5A1.6 1.6 0 0 1 11.4 17H8.6A1.6 1.6 0 0 1 7 15.5Z"></path><path d="M6.4 8h7.2"></path>',
  'occasion-event': '<path d="M10 3v3.5M10 13.5V17M3 10h3.5M13.5 10H17M5.2 5.2l2.4 2.4M12.4 12.4l2.4 2.4M14.8 5.2l-2.4 2.4M7.6 12.4l-2.4 2.4"></path>',
  'occasion-dining': '<path d="M6 3v6.5M6 9.5V17M4 3v4a2 2 0 0 0 4 0V3M14 3c-1.6 0-2.6 1.4-2.6 3.2S12.4 9.5 14 9.5V17"></path>',
  'occasion-traveling': '<path d="M3 11.5 17 6l-4.5 9-2-3.5Z"></path>',
  // set 2: modes, feedback, milestones, trends, actions, status
  'mode-wheelhouse': '<circle cx="9" cy="11" r="6"></circle><circle cx="9" cy="11" r="2.2"></circle><path d="M9 11 16.5 3.5M13.5 3.5h3v3"></path>',
  'mode-adjacent': '<path d="M2.5 8q2.5-2.6 5 0t5 0t5 0M2.5 13.5q2.5-2.6 5 0t5 0t5 0"></path>',
  'mode-wildcard': '<rect x="3.5" y="3.5" width="13" height="13" rx="3"></rect><circle cx="7" cy="7" r="1.2" fill="currentColor" stroke="none"></circle><circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none"></circle><circle cx="13" cy="13" r="1.2" fill="currentColor" stroke="none"></circle>',
  'mode-random': '<path d="M3 6h2.8c2.2 0 3.4 1 4.4 4s2.2 4 4.4 4H17M3 14h2.8c1.3 0 2.2-.4 2.9-1.2M11.3 7.2c.7-.8 1.6-1.2 2.9-1.2H17M14.8 3.8 17 6l-2.2 2.2M14.8 11.8 17 14l-2.2 2.2"></path>',
  'feedback': '<path d="M4.5 4h11A1.5 1.5 0 0 1 17 5.5v7a1.5 1.5 0 0 1-1.5 1.5H9l-4 3v-3h-.5A1.5 1.5 0 0 1 3 12.5v-7A1.5 1.5 0 0 1 4.5 4Z"></path><path d="M6.5 7.8h7M6.5 10.8h4.5"></path>',
  'feedback-bug': '<rect x="6" y="6.5" width="8" height="10.5" rx="4"></rect><path d="M7.6 6.8a2.4 2.4 0 0 1 4.8 0M3.5 9.5 6 10.5M16.5 9.5 14 10.5M3.5 14.5 6 14M16.5 14.5 14 14M7.5 3.2l.9 1.4M12.5 3.2l-.9 1.4"></path>',
  'feedback-idea': '<path d="M7.2 13.5c0-1.4-2.2-2.6-2.2-5.3a5 5 0 0 1 10 0c0 2.7-2.2 3.9-2.2 5.3Z"></path><path d="M7.8 16.6h4.4"></path>',
  'feedback-confusion': '<circle cx="10" cy="10" r="7.2"></circle><circle cx="7.5" cy="8.2" r="1.05" fill="currentColor" stroke="none"></circle><circle cx="12.5" cy="8.2" r="1.05" fill="currentColor" stroke="none"></circle><path d="M6.9 13.2q1.05-1.2 2.1 0t2.1 0t2.1 0"></path>',
  'feedback-other': '<path d="M4.5 4h11A1.5 1.5 0 0 1 17 5.5v7a1.5 1.5 0 0 1-1.5 1.5H9l-4 3v-3h-.5A1.5 1.5 0 0 1 3 12.5v-7A1.5 1.5 0 0 1 4.5 4Z"></path><circle cx="7" cy="9" r="1.1" fill="currentColor" stroke="none"></circle><circle cx="10" cy="9" r="1.1" fill="currentColor" stroke="none"></circle><circle cx="13" cy="9" r="1.1" fill="currentColor" stroke="none"></circle>',
  'milestone-brewery': '<path d="M4.2 17V9l4 2.5V9l4 2.5V4.5h3.5V17Z"></path><path d="M3 17h14"></path>',
  'milestone-style': '<path d="M3.5 3.5h5l7 7a1.5 1.5 0 0 1 0 2.1l-3.9 3.9a1.5 1.5 0 0 1-2.1 0l-6-6Z"></path><circle cx="7" cy="7" r="1.2" fill="currentColor" stroke="none"></circle>',
  'trend-abv': '<path d="M11 2.5 4.5 11.5H10L9 17.5l6.5-9H10Z"></path>',
  'trend-up': '<path d="M3 14.5 8 9.5l3 3 6-6M13 6.5h4v4"></path>',
  'trend-down': '<path d="M3 5.5l5 5 3-3 6 6M13 13.5h4v-4"></path>',
  'trend-region': '<path d="M3 5.5 7.5 3.5l5 2 4.5-2v11l-4.5 2-5-2-4.5 2Z"></path><path d="M7.5 3.5v11M12.5 5.5v11"></path>',
  'trend-loyal': '<path d="M10 16.5S3 12.4 3 7.6A3.6 3.6 0 0 1 10 6a3.6 3.6 0 0 1 7 1.6c0 4.8-7 8.9-7 8.9Z"></path>',
  'note': '<path d="M12.8 4.2l3 3-8.3 8.3-3.5.5.5-3.5Z"></path><path d="M11 6l3 3"></path>',
  'account': '<circle cx="10" cy="7" r="3.2"></circle><path d="M4 17c.6-3.2 3-5 6-5s5.4 1.8 6 5"></path>',
  'refresh': '<path d="M16 10a6 6 0 1 1-1.8-4.3M16 3.5v3.2h-3.2"></path>',
  'export-csv': '<path d="M5.5 3h6l3.5 3.5V16a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"></path><path d="M11.5 3v3.5H15M7.5 10.5h5M7.5 13.5h5"></path>',
  'export-json': '<path d="M3.5 6.5 10 3.5l6.5 3v7L10 16.5l-6.5-3Z"></path><path d="M3.5 6.5 10 9.5l6.5-3M10 9.5v7"></path>',
  'import': '<path d="M10 3.5v9M6.5 9 10 12.5 13.5 9M4 16.5h12"></path>',
  'warning': '<path d="M10 3.5l7.5 13h-15Z"></path><path d="M10 8.5v3.4"></path><circle cx="10" cy="14.3" r="1" fill="currentColor" stroke="none"></circle>',
  'success': '<circle cx="10" cy="10" r="7.2"></circle><path d="M6.8 10.2 9 12.4l4.3-4.6"></path>',
  'error': '<circle cx="10" cy="10" r="7.2"></circle><path d="M7.5 7.5l5 5M12.5 7.5l-5 5"></path>',
  'trash': '<path d="M3.5 5.5h13M8 5.5v-2h4v2M5.2 5.5l.8 10.6a1 1 0 0 0 1 .9h6a1 1 0 0 0 1-.9l.8-10.6"></path>',
  'mail': '<rect x="3" y="4.5" width="14" height="11" rx="2"></rect><path d="M3.5 5.5 10 10.5l6.5-5"></path>',
};
function icon(name, size = 20, weight = 2.2, cls = '') {
  const p = ICON_PATHS[name];
  if (!p) { console.warn('icon: unknown', name); return ''; }
  return `<svg class="ico${cls ? ' ' + cls : ''}" width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="${weight}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${p}</svg>`;
}
