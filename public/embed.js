/*! WebGames embed SDK v1. Usage: WebGames.mount(element, { game: "slide2048", client: "your-slug" }). Docs: #/embed-docs */
(function () {
  "use strict";
  var script = document.currentScript;
  // Default base: the folder this script was loaded from, e.g. https://example.com/webgames/
  var BASE = script && script.src ? script.src.replace(/[?#].*$/, "").replace(/[^/]*$/, "") : "";
  var COMMANDS = ["pause", "resume", "mute", "unmute"];

  function mount(el, opts) {
    if (typeof el === "string") el = document.querySelector(el);
    if (!el) throw new Error("WebGames.mount: element not found");
    opts = opts || {};
    if (!opts.game && !opts.portal) throw new Error("WebGames.mount: pass { game } or { portal }");
    var base = new URL(opts.base || BASE, location.href).href;
    if (base.slice(-1) !== "/") base += "/";
    var enc = encodeURIComponent;
    var path = opts.portal ? "embed/portal/" + enc(opts.portal) : "embed/" + enc(opts.game);
    var q = [];
    if (opts.client && !opts.portal) q.push("client=" + enc(opts.client));
    if (opts.sound === false) q.push("sound=0");

    var frame = document.createElement("iframe");
    frame.src = base + "#/" + path + (q.length ? "?" + q.join("&") : "");
    frame.title = opts.title || (opts.portal ? "Games" : "Game");
    frame.allow = "autoplay; fullscreen; gamepad";
    frame.setAttribute("allowfullscreen", "");
    frame.style.cssText = "display:block;width:100%;height:100%;border:0;background:#0b0d17";
    // An element without a height would collapse the game to nothing.
    if (!el.clientHeight) frame.style.height = opts.height || "min(80vh, 720px)";

    var ready = false, queue = [];
    function post(command) {
      var msg = { source: "webgames-host", command: command };
      if (!ready || !frame.contentWindow) { queue.push(msg); return; }
      frame.contentWindow.postMessage(msg, "*");
    }
    function onMessage(e) {
      if (e.source !== frame.contentWindow) return;
      var d = e.data;
      if (!d || d.source !== "webgames" || !d.event) return;
      if (!ready) {
        ready = true;
        while (queue.length) frame.contentWindow.postMessage(queue.shift(), "*");
      }
      if (typeof opts.onEvent === "function") {
        try { opts.onEvent(d.event); } catch (err) { setTimeout(function () { throw err; }); }
      }
    }
    window.addEventListener("message", onMessage);
    el.appendChild(frame);

    var api = {
      iframe: frame,
      destroy: function () {
        window.removeEventListener("message", onMessage);
        if (frame.parentNode) frame.parentNode.removeChild(frame);
      },
    };
    COMMANDS.forEach(function (c) { api[c] = function () { post(c); }; });
    return api;
  }

  window.WebGames = { version: 1, mount: mount };
})();
