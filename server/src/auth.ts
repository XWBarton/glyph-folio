import type { Request, Response, NextFunction } from 'express'

const AUTH_TOKEN = process.env['AUTH_TOKEN']

/**
 * Optional bearer token auth middleware.
 * If AUTH_TOKEN env var is not set, all requests are allowed (local network use).
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!AUTH_TOKEN) { next(); return }

  const header = req.headers['authorization'] ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''

  if (token !== AUTH_TOKEN) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  next()
}
