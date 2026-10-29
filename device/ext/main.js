// Runs in the PAGE's own world, before any page script, and refuses fullscreen.
//
// A content script normally runs in an isolated world: patching
// Element.prototype there changes nothing the page can see, and the page keeps the
// native requestFullscreen. Verified the hard way — with the patch in nav.js the
// test page still reported `function requestFullscreen() { [native code] }`.
// This file is declared with "world": "MAIN" for exactly that reason.
//
// Why block it at all: in kiosk mode there is no browser chrome, so a fullscreen
// element (a video player, an ad overlay) covers the panel and takes every control
// with it. There is no Esc affordance on a touchscreen and no window to close.
(function () {
  'use strict';
  var names = ['requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen', 'mozRequestFullScreen'];
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    if (Object.prototype.hasOwnProperty.call(Element.prototype, name) || Element.prototype[name]) {
      Object.defineProperty(Element.prototype, name, {
        configurable: true,
        writable: true,
        value: function blocked() {
          return Promise.reject(new DOMException(
            'fullscreen is disabled in MPC browse mode', 'NotAllowedError'));
        }
      });
    }
  }
  // Belt and braces: if something slips through (an iframe that loaded before this
  // patch, or a fullscreen entered through a path not covered above), leave it
  // again immediately so the bar comes back.
  document.addEventListener('fullscreenchange', function () {
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(function () {});
    }
  }, true);
})();
