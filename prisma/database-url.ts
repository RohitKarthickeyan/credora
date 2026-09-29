import { existsSync } from 'node:fs'

export function databaseUrl(): string {
  if (existsSync('.env')) process.loadEnvFile('.env')

  const url = process.env.DATABASE_URL
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env (see README.md).')
  }
  return url
}
