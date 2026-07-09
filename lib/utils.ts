import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** shadcn-style class combiner: clsx for conditionals, twMerge so caller
 *  classNames override component defaults instead of fighting them. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Shared form-field token: matches Input/Select but with a fixed height so
 *  composite pickers (date + time, etc.) line up to the exact same box. */
export const fieldStyles =
  'h-10 px-3 border border-black font-mono text-sm bg-white focus:outline-none focus:border-clay-600 focus:ring-1 focus:ring-clay-600'
