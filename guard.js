// Pages cannot send frame headers, so refuse to render inside someone else's frame.
(function () {
  if (window.top === window.self) return;
  document.documentElement.style.display = "none";
  try { window.top.location.replace(window.location.href); } catch (e) {}
})();
