// `npm run db:migrate -- --name foo` appends forwarded args to the END of the whole script
// string, so a plain "prisma migrate dev && prisma generate" hands --name to `generate` and
// leaves `migrate dev` waiting forever on its interactive name prompt — invisible behind a
// pipe, and it holds pg_advisory_lock(72707369) until killed. This puts the args on the
// right command.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

// Runs the Prisma CLI through node itself: Node refuses to spawn `npx.cmd` without a shell
// (EINVAL), and a shell would concatenate the args unescaped.
const prisma = createRequire(import.meta.url).resolve('prisma/build/index.js')

const run = (args) => {
  const result = spawnSync(process.execPath, [prisma, ...args], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(['migrate', 'dev', ...process.argv.slice(2)])
run(['generate'])
