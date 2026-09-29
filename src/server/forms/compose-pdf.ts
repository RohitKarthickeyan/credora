import { PDFDocument, type PDFFont, StandardFonts } from 'pdf-lib'
import type { RenderedBlock, RenderedDocument } from '@/domain/documents/agency-document'

const PAGE_SIZE: [number, number] = [612, 792]
const MARGIN = 72
// Left empty on every page: the e-sign adapter stamps the bottom margin of the last page (T-052).
const BOTTOM_MARGIN = 144
const TEXT_WIDTH = PAGE_SIZE[0] - 2 * MARGIN
const LINE_SPACING = 1.4

function wrap(text: string, font: PDFFont, size: number): string[] {
  const lines: string[] = []
  let line = ''

  for (const word of text.split(' ')) {
    const candidate = line === '' ? word : `${line} ${word}`
    if (line !== '' && font.widthOfTextAtSize(candidate, size) > TEXT_WIDTH) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  lines.push(line)

  return lines
}

export async function composeDocumentPdf(document: RenderedDocument): Promise<Uint8Array> {
  // No creation or modification date, so identical input gives identical bytes.
  const pdf = await PDFDocument.create({ updateMetadata: false })
  pdf.setTitle(document.title)
  pdf.setSubject(`${document.documentKey} v${document.templateVersion}`)
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  let page = pdf.addPage(PAGE_SIZE)
  let top = PAGE_SIZE[1] - MARGIN

  const write = (text: string, font: PDFFont, size: number) => {
    for (const line of wrap(text, font, size)) {
      const lineHeight = size * LINE_SPACING
      if (top - lineHeight < BOTTOM_MARGIN) {
        page = pdf.addPage(PAGE_SIZE)
        top = PAGE_SIZE[1] - MARGIN
      }
      page.drawText(line, { x: MARGIN, y: top - size, size, font })
      top -= lineHeight
    }
  }
  const space = (points: number) => {
    top -= points
  }

  const drawBlock = (block: RenderedBlock) => {
    switch (block.kind) {
      case 'heading':
        space(8)
        write(block.text, bold, 12)
        return
      case 'paragraph':
        write(block.text, regular, 11)
        space(4)
        return
      case 'field':
        write(`${block.label}: ${block.value}`, regular, 11)
        return
      case 'signature':
        space(24)
        write('Signature: ______________________________', regular, 11)
        write(`Printed name: ${block.signerName}`, regular, 11)
        write('Date: ______________', regular, 11)
        return
    }
  }

  write(document.title, bold, 16)
  space(8)
  for (const block of document.blocks) drawBlock(block)

  return pdf.save()
}
