/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Design tokens (see :root in index.css). Hex mirrors the CSS vars so
        // Tailwind opacity modifiers (e.g. bg-accent/40) work.
        bg: '#08090b',
        surface: {
          DEFAULT: '#0e1014',
          2: '#15181e',
          3: '#1c2027'
        },
        hair: {
          DEFAULT: '#23272f',
          strong: '#2e333d'
        },
        content: {
          DEFAULT: '#e7e9ee',
          muted: '#9aa3b2',
          faint: '#5e6675'
        },
        accent: {
          DEFAULT: '#22d3ee',
          strong: '#06b6d4',
          violet: '#818cf8'
        },
        // Status colors used by workspace status dots (see WorkspaceStatus).
        status: {
          idle: '#64748b',
          running: '#38bdf8',
          awaiting: '#f59e0b',
          done: '#22c55e',
          error: '#ef4444'
        }
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem'
      },
      boxShadow: {
        elev: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -8px rgba(0,0,0,0.6), 0 2px 6px -2px rgba(0,0,0,0.5)',
        glow: '0 0 0 1px rgba(34,211,238,0.35), 0 0 20px -2px rgba(34,211,238,0.35)'
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif'
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace'
        ]
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' }
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.985)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' }
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translateX(12px)' },
          to: { opacity: '1', transform: 'translateX(0)' }
        }
      },
      animation: {
        'fade-in': 'fade-in 0.15s ease-out',
        'slide-up': 'slide-up 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
        'toast-in': 'toast-in 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
      }
    }
  },
  plugins: []
}
