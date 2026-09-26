/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        dex: {
          bg: "#0a0a0f",
          surface: "#13131a",
          border: "#2a2a35",
          accent: "#6366f1",
          accent2: "#8b5cf6",
          text: "#e4e4e7",
          muted: "#71717a",
          success: "#10b981",
          warning: "#f59e0b",
          danger: "#ef4444",
        },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
