// Uncalibrated starting values (T-070 § Risks 3). The check is advisory and never blocks a send.
const GLARE_CHANNEL_MIN = 250
const GLARE_SHARE = 0.02
const EDGE_BAND = 0.03
const EDGE_LUMA = 180
const EDGE_SHARE = 0.6
const MIN_SHORT_SIDE = 800

export type PhotoIssue = 'GLARE' | 'EDGE_CUT' | 'TOO_SMALL'

type PixelGrid = {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
}

export const PHOTO_ISSUE_COPY: Record<PhotoIssue, string> = {
  GLARE: 'Part of the document looks washed out by light. Tilt it away from the light and try again.',
  EDGE_CUT: 'An edge of the document may be cut off. Make sure all four corners are in the picture.',
  TOO_SMALL: 'This picture is small and may be hard to read. Move closer and take it again.',
}

function channels(pixels: PixelGrid, x: number, y: number): [number, number, number] {
  const offset = (y * pixels.width + x) * 4
  return [pixels.data[offset] ?? 0, pixels.data[offset + 1] ?? 0, pixels.data[offset + 2] ?? 0]
}

function share(
  pixels: PixelGrid,
  xs: readonly [number, number],
  ys: readonly [number, number],
  test: (rgb: [number, number, number]) => boolean,
): number {
  let hits = 0
  for (let y = ys[0]; y < ys[1]; y++) {
    for (let x = xs[0]; x < xs[1]; x++) if (test(channels(pixels, x, y))) hits++
  }
  return hits / ((xs[1] - xs[0]) * (ys[1] - ys[0]))
}

function hasGlare(pixels: PixelGrid): boolean {
  const clipped = share(pixels, [0, pixels.width], [0, pixels.height], (rgb) => Math.min(...rgb) >= GLARE_CHANNEL_MIN)
  return clipped >= GLARE_SHARE
}

function hasCutEdge(pixels: PixelGrid): boolean {
  const { width, height } = pixels
  const bandX = Math.max(1, Math.round(width * EDGE_BAND))
  const bandY = Math.max(1, Math.round(height * EDGE_BAND))
  const bright = ([r, g, b]: [number, number, number]) => 0.299 * r + 0.587 * g + 0.114 * b >= EDGE_LUMA
  const sides: [readonly [number, number], readonly [number, number]][] = [
    [[0, bandX], [0, height]],
    [[width - bandX, width], [0, height]],
    [[0, width], [0, bandY]],
    [[0, width], [height - bandY, height]],
  ]
  return sides.some(([xs, ys]) => share(pixels, xs, ys, bright) >= EDGE_SHARE)
}

export function assessPhoto(
  pixels: PixelGrid,
  original: { readonly width: number; readonly height: number },
): readonly PhotoIssue[] {
  const issues: PhotoIssue[] = []
  if (hasGlare(pixels)) issues.push('GLARE')
  if (hasCutEdge(pixels)) issues.push('EDGE_CUT')
  if (Math.min(original.width, original.height) < MIN_SHORT_SIDE) issues.push('TOO_SMALL')
  return issues
}
