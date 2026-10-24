// runs before anything else: when a login is saved on this phone the empty frame of the app is drawn at once, so the page is never a blank color while the real screen loads
try {
  for (var i = 0; i < localStorage.length; i++) {
    if (/^sb-.*-auth-token$/.test(localStorage.key(i))) { document.documentElement.className += " hs"; break; }
  }
} catch (e) {}
