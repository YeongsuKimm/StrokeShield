// The only button in the app. Large tap targets and high contrast throughout: the patient may be impaired
// (docs/spec/06-frontend-ux.md "UX rules"). Tactile press, no glow, no gradient.
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export type ButtonTone = 'accent' | 'danger' | 'neutral' | 'quiet' | 'stage'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl'

const TONES: Record<ButtonTone, string> = {
  accent: 'bg-accent text-white border-transparent hover:bg-accent-press active:bg-accent-press',
  danger: 'bg-danger text-white border-transparent hover:bg-danger-press active:bg-danger-press',
  neutral: 'bg-ink text-white border-transparent hover:bg-ink/90',
  quiet: 'bg-surface text-ink border-control-edge hover:bg-sunken',
  // On the dark camera stage: a light outline that stays legible over video.
  stage: 'bg-white/10 text-stage-ink border-white/25 backdrop-blur-sm hover:bg-white/20',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 text-sm gap-1.5',
  md: 'min-h-11 px-4 text-[1rem] gap-2',
  lg: 'min-h-13 px-6 text-lg gap-2.5',
  xl: 'min-h-16 px-8 text-xl gap-3',
}

const base =
  'inline-flex items-center justify-center rounded-[var(--radius-control)] border font-medium ' +
  'transition-[background-color,transform,box-shadow] duration-150 ease-out ' +
  'active:translate-y-px disabled:pointer-events-none disabled:opacity-45 aria-disabled:opacity-45 select-none'

interface Common {
  tone?: ButtonTone
  size?: ButtonSize
  icon?: IconName
  iconAfter?: IconName
  block?: boolean
  children?: ReactNode
}

type ButtonProps = Common & ButtonHTMLAttributes<HTMLButtonElement> & { as?: 'button' }
type LinkProps = Common & AnchorHTMLAttributes<HTMLAnchorElement> & { as: 'a' }

export function Button(props: ButtonProps): ReactNode
export function Button(props: LinkProps): ReactNode
export function Button({ tone = 'accent', size = 'md', icon, iconAfter, block, className = '', children, ...rest }: ButtonProps | LinkProps) {
  const cls = `${base} ${TONES[tone]} ${SIZES[size]} ${block ? 'w-full' : ''} ${className}`
  const iconSize = size === 'xl' ? 24 : size === 'lg' ? 22 : 18
  const inner = (
    <>
      {icon && <Icon name={icon} size={iconSize} />}
      {children}
      {iconAfter && <Icon name={iconAfter} size={iconSize} />}
    </>
  )
  if ('as' in rest && rest.as === 'a') {
    const { as: _as, ...anchor } = rest as LinkProps
    return (
      <a className={cls} {...anchor}>
        {inner}
      </a>
    )
  }
  const { as: _as, ...button } = rest as ButtonProps
  return (
    <button className={cls} {...button}>
      {inner}
    </button>
  )
}
