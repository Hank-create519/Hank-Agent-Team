/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,tsx,jsx}'],
  theme: {
    extend: {
      colors: {
        'deep-blue': '#05050F',
        'panel': '#0A0A1A',
        'glass': 'rgba(18, 18, 40, 0.6)',
        'accent': '#4DABF7',
        'cyan': '#22D3EE',
        'status-green': '#22C55E',
        'status-yellow': '#F59E0B',
        'status-red': '#EF4444',
        'text-primary': '#E2E8F0',
        'text-secondary': '#94A3B8',
      },
    },
  },
  plugins: [],
};
