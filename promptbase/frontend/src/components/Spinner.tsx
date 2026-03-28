interface Props {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZES = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-10 h-10' }

export default function Spinner({ size = 'md', className = '' }: Props) {
  return (
    <div
      className={`${SIZES[size]} border-2 border-indigo-500 border-t-transparent rounded-full animate-spin ${className}`}
    />
  )
}
