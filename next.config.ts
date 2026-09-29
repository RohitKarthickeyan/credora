import type { NextConfig } from "next";

// src/app/dev/page.dev.tsx is matched only by the 'dev.tsx' entry, so in a production build
// the file is never compiled as a route: it is not an entrypoint, its inline Server Action is
// never registered, and no action id exists for it. A NODE_ENV guard inside the page would
// leave that POST endpoint reachable, and it is the endpoint that truncates the database.
// 'tsx' and 'ts' must stay in the list or every other route stops resolving.
const devOnlyPageExtensions = process.env.NODE_ENV === "production" ? [] : ["dev.tsx"];

const nextConfig: NextConfig = {
  pageExtensions: [...devOnlyPageExtensions, "tsx", "ts"],
  // 10 MiB of upload (MAX_UPLOAD_BYTES) plus multipart headroom.
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
};

export default nextConfig;
