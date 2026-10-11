// Turns the print-media Google Fonts stylesheet on once the page has loaded,
// so fonts never block the first paint. A separate file (not an inline
// onload="" attribute) because the site's Content-Security-Policy only
// allows scripts from its own origin.
document.querySelectorAll('link[data-async-font]').forEach(function (l) { l.media = 'all'; });
