# Client options

Pass any of these to `requestWithRetry(send, options)`. Unknown option names are
rejected with an error.

| Option | Default | Meaning |
| --- | --- | --- |
| `baseUrl` | `https://api.example.test` | Origin every request is sent to. |
| `timeoutMs` | `5000` | Per-attempt timeout in milliseconds. |
| `retryLimit` | `3` | Extra attempts after the first one fails. |

## Example

```js
await requestWithRetry(send, { retryLimit: 5 })
```
