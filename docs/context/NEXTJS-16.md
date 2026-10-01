# Next.js 16 — what differs from what you remember

**Read this before writing any page, layout, route handler, Server Action, or config.**
Next 16.3.6 / React 19.2 / Tailwind v4. Distilled from `node_modules/next/dist/docs/`
(cited below as `DOCS/`). Verified against the bundled docs, not from memory.

If something here contradicts your instinct, this file wins. If you need detail beyond it,
read the one cited doc file — do not read the 456-file tree.

---

## The ten things that will bite you

1. `error.tsx`'s second prop is **`retry`**, not `reset`.
2. `revalidateTag` now takes a **required second argument** (`revalidateTag('posts', 'max')`).
3. `middleware.ts` is deprecated → **`proxy.ts`** exporting `proxy`. Node runtime only.
4. Every parallel-route slot needs an explicit **`default.tsx`** or the build fails.
5. **Turbopack is the default.** Do not pass `--turbopack`; pass `--webpack` to opt out.
6. `params`, `searchParams`, `cookies()`, `headers()`, `draftMode()` — **always `await`**. The
   Next 15 sync compat shim is gone.
7. `opengraph-image`/`icon` `params` *and* `id` are Promises; `sitemap`'s `id` too.
8. Tailwind v4: `@import "tailwindcss"` + `@tailwindcss/postcss`. **No `tailwind.config.js`**,
   no `@tailwind` directives. Theme tokens go in `@theme` in CSS.
9. `dynamic` / `revalidate` / `fetchCache` route exports **vanish** once `cacheComponents: true`.
10. Prefer the generated globals `PageProps<'/route'>`, `LayoutProps<'/route'>`,
    `RouteContext<'/route'>` over hand-written Promise types.

---

## 1. Async request APIs

`DOCS/01-app/02-guides/upgrading/version-16.md` §Async Request APIs.

```tsx
// app/caregivers/[id]/page.tsx  — preferred: generated props helper
export default async function Page(props: PageProps<'/caregivers/[id]'>) {
  const { id } = await props.params
  const { tab } = await props.searchParams
}
```

```tsx
// explicit form, if you need it
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const { id } = await params
}
```

Client Component page: `use(params)` / `use(searchParams)` from `react`.
Static routes resolve `params` to `{}`.

```tsx
// Layouts get params but NEVER searchParams, and do not re-render on navigation.
export default function Layout(props: LayoutProps<'/(staff)'>) {
  return <section>{props.children}</section>
}
```

```tsx
import { cookies, headers, draftMode } from 'next/headers'

const cookieStore = await cookies()       // get/getAll/has/set/delete
const session = cookieStore.get('session')?.value
const h = await headers()                 // read-only
const { isEnabled } = await draftMode()
```

`cookieStore.set` / `.delete` work **only** in Server Actions and Route Handlers.
`DOCS/01-app/03-api-reference/04-functions/cookies.md`

```tsx
// generateMetadata
export async function generateMetadata(
  { params }: PageProps<'/caregivers/[id]'>,
): Promise<Metadata> {
  const { id } = await params
  return { title: id }
}
```

Root params (`app/[lang]/layout.tsx`) are readable anywhere in Server Components via
`import { lang } from 'next/root-params'`. `unstable_rootParams` was removed.
`DOCS/01-app/03-api-reference/04-functions/next-root-params.md`

---

## 2. Caching and revalidation

**This project does not enable `cacheComponents`.** Everything is request-time and
authenticated; there is nothing worth prerendering. Keep the default model and do not add
caching without an ADR. The notes below are so you recognise what you are reading.

- `fetch` defaults to **`auto no cache`** — caching is opt-in (`cache: 'force-cache'`).
  `DOCS/01-app/03-api-reference/04-functions/fetch.md`
- Route Handlers are **not cached by default**. Only `GET` can opt in with
  `export const dynamic = 'force-static'`.
- Route segment config still supports `dynamic`, `revalidate`, `fetchCache`, `dynamicParams`,
  `runtime`, `maxDuration` while `cacheComponents` is off.
  `DOCS/01-app/02-guides/caching-without-cache-components.md`
- `export const experimental_ppr` was removed.

```ts
import { revalidatePath, revalidateTag, updateTag, refresh } from 'next/cache'

revalidatePath('/pipeline')          // what we use after mutations
revalidateTag('caregiver:123', 'max') // second arg REQUIRED; single-arg form is a TS error
updateTag('caregiver:123')           // Server Actions only; read-your-writes
refresh()                            // Server Actions only; refetch RSC payload, no invalidation
```

`DOCS/01-app/03-api-reference/04-functions/revalidateTag.md`, `.../updateTag.md`, `.../refresh.md`

`"use cache"`, `cacheLife`, `cacheTag` are stable but require `cacheComponents: true`. They
cannot read `cookies()`/`headers()`/`searchParams`, which rules them out for almost everything
here. `DOCS/01-app/03-api-reference/01-directives/use-cache.md`

---

## 3. Proxy (was middleware)

`DOCS/01-app/03-api-reference/03-file-conventions/proxy.md`

```ts
// proxy.ts — at src/ root, sibling of app/
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function proxy(request: NextRequest) {
  const session = request.cookies.get('session')
  if (!session && request.nextUrl.pathname.startsWith('/pipeline')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
```

Constraints that matter for this project:

- Runtime is **`nodejs`, not configurable**. `export const runtime` in a proxy file throws.
- **Do not hit the database here.** It runs on every request including prefetches. Cookie-only
  optimistic checks. Real authorization lives in `src/server/auth/policy.ts`, called by every
  use case. This is the documented recommendation, not just our preference.
- `fetch`'s `cache`/`next.revalidate`/`next.tags` options have no effect in proxy.
- Server Actions are POSTs to the page route — a matcher that excludes a path also skips
  Server Function calls there.
- Set request headers via `NextResponse.next({ request: { headers } })`.
- Config flag renamed: `skipMiddlewareUrlNormalize` → top-level `skipProxyUrlNormalize`.
- Codemod if you ever port one: `npx @next/codemod@canary middleware-to-proxy .`

---

## 4. Server Actions

`DOCS/01-app/02-guides/server-actions.md`, `DOCS/01-app/03-api-reference/01-directives/use-server.md`

```ts
// src/app/(staff)/caregivers/[id]/actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function signOff(prevState: SignOffState, formData: FormData) {
  const actor = await requireStaff()                 // 1. authenticate
  assertCan(requirePrincipal(), 'clearance.signOff') // 2. authorize (T-014; named exports)
  const input = signOffSchema.parse(...)             // 3. validate
  await clearanceService.signOff(actor, input)       // 4. use case
  revalidatePath('/clearance')                       // revalidate BEFORE redirect
  redirect('/pipeline')                              // redirect() throws
}
```

Rules:
- All Server Functions must be `async`. They are always POST.
- Cannot be *defined* in a Client Component — define in a `'use server'` file and import.
- **Client dispatch is sequential** — one action at a time per client. Never `Promise.all`
  over actions; parallelise inside one action.
- Unused Server Functions are dead-code-eliminated from client bundles.

```tsx
'use client'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'   // note: react-dom, not react

const [state, formAction, pending] = useActionState(signOff, { message: '' })
// action signature becomes (prevState, formData)
```

Security (`server-actions.md` §Security):
- CSRF via `Origin` vs `Host`. Configure `experimental.serverActions.allowedOrigins` in
  production.
- Body limit 1MB default → raise with `experimental.serverActions.bodySizeLimit` for uploads.
- Set `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` for multi-instance deploys (closure encryption).
- **Always authenticate and authorize inside each action.** Take an ID from the client and
  re-read the row scoped by the session's agency. Render-time gating is not a boundary.
- With `experimental.authInterrupts`, throw `unauthorized()` / `forbidden()` from
  `next/navigation` instead of generic errors.

---

## 5. Route Handlers

`DOCS/01-app/03-api-reference/03-file-conventions/route.md`. Used here **only** for webhooks
and file streaming — never for our own UI's data, which uses Server Components and Actions.

```ts
// src/app/api/webhooks/[provider]/route.ts
import type { NextRequest } from 'next/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params
  const raw = await request.text()          // keep raw for signature verification
  const signature = request.headers.get('x-signature')
  // verify → persist → enqueue → 200 fast. No business logic here.
  return Response.json({ received: true })
}
```

- Methods: `GET POST PUT PATCH DELETE HEAD OPTIONS`; anything else returns 405.
- No `route.ts` alongside `page.tsx` in the same segment.
- Streaming: return `new Response(readableStream)`.
- No `bodyParser` config needed.

---

## 6. File conventions in `app/`

`layout` · `page` · `loading` · `not-found` · `error` · `global-error` · `route` · `template` ·
`default` · `forbidden` (experimental) · `unauthorized` (experimental).
Root level: `proxy.ts`, `instrumentation.ts`, `instrumentation-client.ts`.

Hierarchy: `layout` → `template` → `error` → `loading` → `not-found` → `page`.

```tsx
// error.tsx — CHANGED IN 16: the prop is `retry`, not `reset`
'use client'
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return <button onClick={() => retry()}>Try again</button>
}
```

`retry()` refetches and re-renders the boundary's children in a Transition. `reset` still
exists but only clears error state without refetching — prefer `retry`.
`DOCS/01-app/03-api-reference/03-file-conventions/error.md`

**Every parallel-route slot now requires an explicit `default.tsx`** or the build fails.
Return `null` or call `notFound()`.

`forbidden()` / `unauthorized()` from `next/navigation` need
`experimental.authInterrupts: true`. They throw, so a surrounding `try/catch` swallows them —
use `unstable_rethrow`. Cannot be called in the root layout.

---

## 7. Config and CLI

```ts
// next.config.ts   (.cjs / .cts are NOT supported)
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  typedRoutes: true,              // was experimental.typedRoutes
  serverExternalPackages: [],     // Prisma/argon2 etc. are auto-excluded already
  experimental: {
    authInterrupts: true,
    serverActions: { bodySizeLimit: '10mb' },  // document uploads
  },
}
export default nextConfig
```

Promoted to top level in 16: `cacheComponents`, `cacheLife`, `cacheHandlers`,
`reactCompiler`, `typedRoutes`, `turbopack`, `adapterPath`, `skipProxyUrlNormalize`,
`partialPrefetching`.

CLI: `next dev` and `next build` use **Turbopack by default**. A project with a custom
`webpack` config fails `next build` unless you pass `--turbopack` (ignores it) or `--webpack`.
`next dev` writes to `.next/dev`, so dev and build can run concurrently.
`next typegen` regenerates `PageProps`/`LayoutProps`/`RouteContext`.

`next/image` defaults changed: `minimumCacheTTL` 60s → 14400s, `qualities` → `[75]`,
`maximumRedirects` → 3, local IP optimisation blocked, `images.domains` → `remotePatterns`.

---

## 8. Removed in 16 — do not reach for these

AMP (`next/amp`, `useAmp`) · **`next lint`** and the `eslint` key in next.config (use the
ESLint CLI; `next build` no longer lints) · `serverRuntimeConfig` / `publicRuntimeConfig` /
`next/config` · `devIndicators` sub-options · `experimental.dynamicIO` · `experimental.useCache`
· `experimental.ppr` and `experimental_ppr` · `unstable_rootParams` · synchronous
`params`/`searchParams`/`cookies`/`headers`/`draftMode` · forced `scroll-behavior: auto`
during navigation.

Deprecated but working: `middleware.ts`, `next/legacy/image`, `images.domains`,
`runtime = 'edge'`, `preferredRegion`, single-arg `revalidateTag`, `unstable_cacheLife` /
`unstable_cacheTag` prefixes.

`DOCS/01-app/02-guides/upgrading/version-16.md` §Removals

---

## 9. Tailwind v4

`DOCS/01-app/01-getting-started/11-css.md`

```js
// postcss.config.mjs — no autoprefixer, no postcss package, no tailwind.config.js
export default { plugins: { '@tailwindcss/postcss': {} } }
```

```css
/* src/app/globals.css */
@import 'tailwindcss';

@theme {
  --color-brand-600: oklch(0.55 0.17 250);
  --color-surface:   oklch(0.99 0 0);
}
```

Tokens defined in `@theme` become utilities (`bg-brand-600`, `text-surface`). Define every
colour there; no arbitrary values in components (`CONVENTIONS.md`).

Production builds chunk and merge CSS in import order — keep CSS imports in one entry file
and disable import-sorting lint rules for it.

---

## 10. Auth and sessions

`DOCS/01-app/02-guides/authentication.md`, `DOCS/01-app/02-guides/data-security.md`

```ts
// src/server/auth/session.ts
import 'server-only'
import { cookies } from 'next/headers'

export async function createSession(userId: string) {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const cookieStore = await cookies()
  cookieStore.set('session', await encrypt({ userId, expiresAt }), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })
}
```

The documented pattern, which this project follows:

- Stateless encrypted session cookie signed with `jose`; `SESSION_SECRET` from env.
- **Proxy does optimistic cookie checks only.** Real enforcement lives in a Data Access Layer
  marked `import 'server-only'`, with `verifySession()` memoised by React `cache()`.
- Verify auth **inside every Server Action and Route Handler**.
- Setting or deleting a cookie in a Server Action re-renders the current route in the same
  response, preserving client state.
