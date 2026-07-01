import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** shadcn-style class combiner: clsx for conditionals, twMerge so caller
 *  classNames override component defaults instead of fighting them. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
