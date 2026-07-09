import { generateCode } from '@/lib/codes'

export function generateCertificateCode(): string {
  return generateCode(8)
}
