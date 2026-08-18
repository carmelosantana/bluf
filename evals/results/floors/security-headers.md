---
case: security-headers
category: long-list
requires:
- Completeness of the list is the requirement. The prompt says "list the security
  headers ... and say what each one does", so a well-written answer covering six of the
  nine is not sufficient — the reader is building a checklist and cannot tell what is
  missing.
- One clause per header saying what it actually does, not what it is called.
- Names X-XSS-Protection as obsolete rather than silently omitting it. It appears in
  every older guide the reader will find next, and an answer that neither lists nor
  dismisses it invites exactly one follow-up.
- Says where they go in a Next.js app, because the prompt names Next.js. One line.
- Does not require: a copy-paste next.config.js block, a full CSP directive reference,
  nonce/middleware setup, recommended values, a CSP-report pipeline, or per-browser
  support notes.
---
Set these in `headers()` in `next.config.js`, or in middleware if your CSP needs a per-request nonce.

- **Strict-Transport-Security** — makes the browser use HTTPS for this host for `max-age` seconds, so a later `http://` link never leaves the machine in the clear.
- **Content-Security-Policy** — restricts which origins scripts, styles, images, frames and connections may come from. The main XSS mitigation.
- **X-Content-Type-Options: nosniff** — stops the browser guessing a response's type from its bytes, so an uploaded file served as `text/plain` cannot run as script.
- **Referrer-Policy** — limits how much of your URL is sent to third parties in `Referer`.
- **Permissions-Policy** — switches off browser features you do not use (camera, microphone, geolocation, payment) so injected or embedded code cannot request them.
- **X-Frame-Options: DENY** — stops other sites framing your pages (clickjacking). Superseded by CSP `frame-ancestors`, which you should set as well.
- **Cross-Origin-Opener-Policy: same-origin** — severs the `window.opener` link to cross-origin pages, so a window you open, or that opens you, cannot script yours.
- **Cross-Origin-Resource-Policy: same-origin** — declares your responses may not be embedded by other origins, blunting cross-origin leak attacks on your API and assets.
- **Cross-Origin-Embedder-Policy: require-corp** — required for cross-origin isolation (`SharedArrayBuffer`, precise timers). Set it only if you need that; it breaks third-party resources that have not opted in.

**Do not set X-XSS-Protection.** Every browser that honoured it has dropped it, and the filter was itself exploitable. It is in most older checklists, which is the only reason to name it.
