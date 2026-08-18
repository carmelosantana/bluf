---
case: 401-no-evidence
category: debug-partial-evidence
requires:
- Refuses to name a cause. The prompt supplies one assertion line and no request, no
  server and no auth setup; any single diagnosis stated as the answer is a guess dressed
  as one. Saying so is part of being complete, not a hedge.
- Says what a 401 does establish — the request reached the server and was rejected as
  unauthenticated — so the reader knows which half of the system to look in.
- Gives a concrete first action that produces the missing evidence, not advice to
  "check the auth". The server almost always states its reason in the body or the
  WWW-Authenticate header.
- Gives the ordered candidate list to work through once that evidence is in hand, so the
  reader is not left with one command and no plan.
- Does not require: framework-specific auth middleware examples, a JWT structure
  explainer, or a walkthrough of every 4xx code.
---
Nobody can say from this — and that is the finding, not a hedge. A 401 establishes that the request reached the server and was rejected as unauthenticated; the assertion line carries no request, no headers and no response body, so it cannot distinguish between the reasons.

Get the server's own reason first. It nearly always states one:

```js
console.log(res.status, res.headers.get('www-authenticate'), await res.text())
```

Then work down this list, roughly in order of likelihood:

1. No credential was sent. Test clients often skip the login step, or the header the app sets in real use.
2. The credential is not valid here — expired token, a secret set in `.env` but not in the test environment, a signing key that differs between the test server and the issuer.
3. The credential is valid but insufficient: right user, missing scope, role or tenant for that route.
4. Authenticated but no session — cookie not persisted by the test client, or a CSRF/origin check rejecting it.

The printed body usually names which one outright.
