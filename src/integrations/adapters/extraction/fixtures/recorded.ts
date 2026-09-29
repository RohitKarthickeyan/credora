import type { ExtractionResult } from '@/integrations/ports/extraction'

type RecordedExtraction = {
  readonly document: string
  readonly sha256: string
  readonly result: ExtractionResult
}

// Values as printed on the document, never normalised: the mixed name orders and date formats
// are what T-071's normaliser must survive (ADR-001: mocks are adversarial). All data fictional.
export const RECORDED_EXTRACTIONS: readonly RecordedExtraction[] = [
  {
    document: 'ny-drivers-license.pdf',
    sha256: '2d9bb2b7549abdccb6f78abdbbc22a9f72f216c303fb08a488a558591ad9c2f1',
    result: {
      fields: [
        { name: 'fullName', value: 'SANTOS, MARIA ELENA', confidence: 0.98 },
        { name: 'dateOfBirth', value: '03/14/1988', confidence: 0.99 },
        { name: 'address', value: '123 MAIN ST APT 4B, BROOKLYN, NY 11201', confidence: 0.96 },
        { name: 'documentNumber', value: '123 456 789', confidence: 0.99 },
        { name: 'issuer', value: 'NEW YORK STATE', confidence: 0.97 },
        { name: 'issueDate', value: '06/01/2021', confidence: 0.98 },
        { name: 'expiryDate', value: '03/14/2029', confidence: 0.99 },
      ],
      text: [
        'NEW YORK STATE',
        'DRIVER LICENSE',
        'ID 123 456 789',
        'SANTOS, MARIA ELENA',
        '123 MAIN ST APT 4B',
        'BROOKLYN, NY 11201',
        'DOB 03/14/1988',
        'ISSUED 06/01/2021',
        'EXPIRES 03/14/2029',
      ].join('\n'),
      confidence: 0.97,
    },
  },
  {
    document: 'hha-certificate.pdf',
    sha256: '7d85b7571d35c77aa6616f1dfe634c9ca3993a4789b85e778f71c02e1687cd4e',
    result: {
      fields: [
        { name: 'issuer', value: 'Brooklyn Home Care Training Institute', confidence: 0.95 },
        { name: 'fullName', value: 'Maria Santos', confidence: 0.97 },
        { name: 'completionDate', value: 'September 15, 2023', confidence: 0.96 },
        { name: 'documentNumber', value: 'HHA-2023-004512', confidence: 0.98 },
      ],
      text: [
        'Brooklyn Home Care Training Institute',
        'Certificate of Completion',
        'Home Health Aide Training Program',
        'This certifies that',
        'Maria Santos',
        'has completed 75 hours of training',
        'Completion date: September 15, 2023',
        'Certificate No. HHA-2023-004512',
      ].join('\n'),
      confidence: 0.95,
    },
  },
  {
    document: 'ppd-tb-result.pdf',
    sha256: 'b52b62cb060b5fce2e4818e7a18fb7beecf469cd98961faf39f8c09e4c605137',
    result: {
      fields: [
        { name: 'issuer', value: 'Downtown Brooklyn Medical Clinic', confidence: 0.93 },
        { name: 'fullName', value: 'Maria E. Santos', confidence: 0.95 },
        { name: 'dateOfBirth', value: '03/14/1988', confidence: 0.97 },
        { name: 'issueDate', value: '8/20/26', confidence: 0.62 },
      ],
      text: [
        'Downtown Brooklyn Medical Clinic',
        'Tuberculin Skin Test (PPD) Result',
        'Patient: Maria E. Santos',
        'DOB: 03/14/1988',
        'Date read: 8/20/26',
        'Induration: 0 mm',
        'Result: Negative',
      ].join('\n'),
      confidence: 0.81,
    },
  },
]
