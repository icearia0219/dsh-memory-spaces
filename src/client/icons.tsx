import type { ReactNode, SVGProps } from 'react'

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  readonly size?: number
}

function Icon({ children, size = 16, ...props }: IconProps & { readonly children: ReactNode }) {
  return <svg
    aria-hidden="true"
    fill="none"
    height={size}
    viewBox="0 0 16 16"
    width={size}
    {...props}
  >
    {children}
  </svg>
}

/** Version-independent check icon for successful memory actions. */
export function IconCheckOutline14(props: IconProps) {
  return <Icon {...props}><path d="m3 8.25 3.1 3.1L13 4.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></Icon>
}

/** Version-independent copy icon for snapshot links. */
export function IconCopyOutline16(props: IconProps) {
  return <Icon {...props}><rect height="9" rx="1.25" stroke="currentColor" strokeWidth="1.25" width="9" x="5" y="5" /><path d="M11 5V3.25C11 2.56 10.44 2 9.75 2h-6.5C2.56 2 2 2.56 2 3.25v6.5C2 10.44 2.56 11 3.25 11H5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" /></Icon>
}

/** Version-independent link icon for read-only snapshots. */
export function IconLinkOutline16(props: IconProps) {
  return <Icon {...props}><path d="m6.25 9.75 3.5-3.5M5.1 11.9l-1 .1A2.1 2.1 0 0 1 2 9.9l.1-1a3 3 0 0 1 .86-1.77l1.17-1.17a3 3 0 0 1 4.24 0M10.9 4.1l1-.1A2.1 2.1 0 0 1 14 6.1l-.1 1a3 3 0 0 1-.86 1.77l-1.17 1.17a3 3 0 0 1-4.24 0" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.25" /></Icon>
}

/** Version-independent share icon for selecting conversation history. */
export function IconShareOutline16(props: IconProps) {
  return <Icon {...props}><circle cx="4" cy="8" r="1.75" stroke="currentColor" strokeWidth="1.25" /><circle cx="12" cy="4" r="1.75" stroke="currentColor" strokeWidth="1.25" /><circle cx="12" cy="12" r="1.75" stroke="currentColor" strokeWidth="1.25" /><path d="m5.55 7.22 4.9-2.44m-4.9 4 4.9 2.44" stroke="currentColor" strokeWidth="1.25" /></Icon>
}

/** Version-independent warning icon for sensitive or destructive actions. */
export function IconWarningOutline16(props: IconProps) {
  return <Icon {...props}><path d="M7.12 2.65a1 1 0 0 1 1.76 0l5.02 9.44A1 1 0 0 1 13.02 13H2.98a1 1 0 0 1-.88-1.47Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.25" /><path d="M8 6v3.2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" /><circle cx="8" cy="11" fill="currentColor" r=".7" /></Icon>
}
