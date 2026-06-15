import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      animation: {
        'glow-teal': 'glow-teal 3s ease-in-out infinite',
        'fade-up':   'fade-up 0.4s ease-out both',
      },
      keyframes: {
        'glow-teal': {
          '0%, 100%': { boxShadow: '0 0 15px 0 rgba(34,217,200,0.08)' },
          '50%':       { boxShadow: '0 0 40px 6px rgba(34,217,200,0.20)' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
