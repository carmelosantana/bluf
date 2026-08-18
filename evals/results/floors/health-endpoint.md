---
case: health-endpoint
category: multi-step
requires:
- Working Express route code. The prompt says "show me how to write", so a description
  of the approach without the handler is not an answer.
- Reports process uptime, and uses the right API for it (process.uptime(), seconds).
- Actually pings Postgres rather than assuming the pool is healthy, and returns 503 on
  the failure path and 200 on the success path.
- Does not require: a readiness/liveness split, a ping timeout, structured logging, a
  pool-configuration walkthrough, or an explanation of what a health check is for.
---
```js
import express from 'express'
import { Pool } from 'pg'

const app = express()
const pool = new Pool() // reads PG* env vars

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ok', uptime: process.uptime() })
  } catch (error) {
    res.status(503).json({ status: 'error', uptime: process.uptime(), error: error.message })
  }
})
```

`process.uptime()` is seconds since this process started, not since the machine booted. The `SELECT 1` is the ping: if the pool cannot get a connection or the query fails, the throw takes you to the 503.
