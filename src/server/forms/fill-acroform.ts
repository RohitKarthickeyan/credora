import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { type PDFCheckBox, PDFDocument, PDFName } from 'pdf-lib'
import type { AcroFormFill } from '@/domain/documents/official-forms'

// pdf-lib's check() and acroField.setValue() accept only the first widget's on-value, so they
// cannot select IT-2104 "Married" or "No". This is its radio-button rule applied to a checkbox.
function selectOnValue(checkBox: PDFCheckBox, onValue: string): void {
  const value = PDFName.of(onValue)
  const widgets = checkBox.acroField.getWidgets()
  if (!widgets.some((widget) => widget.getOnValue() === value)) {
    throw new Error(`${checkBox.getName()} has no on-value ${onValue}`)
  }

  checkBox.acroField.dict.set(PDFName.of('V'), value)
  for (const widget of widgets) {
    widget.setAppearanceState(widget.getOnValue() === value ? value : PDFName.of('Off'))
  }
}

export async function fillAcroForm(fill: AcroFormFill): Promise<Uint8Array> {
  const bytes = await readFile(path.join(process.cwd(), 'src/server/forms/official', fill.asset))
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
  const form = pdf.getForm()

  for (const [name, value] of Object.entries(fill.text)) form.getTextField(name).setText(value)
  for (const [name, value] of Object.entries(fill.dropdowns)) form.getDropdown(name).select(value)
  for (const [name, onValue] of Object.entries(fill.checks)) {
    selectOnValue(form.getCheckBox(name), onValue)
  }

  form.flatten()
  pdf.setSubject(`${fill.documentKey} v${fill.templateVersion}`)
  pdf.setTitle(fill.title)

  return pdf.save()
}
