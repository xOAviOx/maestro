/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Status colors used by workspace status dots (see WorkspaceStatus).
        status: {
          idle: '#64748b',
          running: '#3b82f6',
          awaiting: '#f59e0b',
          done: '#22c55e',
          error: '#ef4444'
        }
      }
    }
  },
  plugins: []
}
