/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        app: {
          bg: "#f8fafc",
          surface: "#ffffff",
          "surface-muted": "#fcfcfd",
          border: "#e5e7eb",
          "border-soft": "#eef2f7",
          text: "#1f2937",
          muted: "#64748b",
          primary: "#171717",
          "primary-soft": "#f4f4f5",
          accent: "#f1f5f9",
          success: "#059669",
          "success-soft": "#ecfdf5",
          danger: "#dc2626",
        },
      },
      borderRadius: {
        app: "8px",
      },
      boxShadow: {
        app: "0 1px 2px rgb(15 23 42 / 0.04)",
        "app-raised": "0 10px 24px rgb(15 23 42 / 0.06)",
      },
      width: {
        sidebar: "288px",
      },
      keyframes: {
        "nav-progress-slide": {
          "0%": { width: "0" },
          "30%": { width: "40%" },
          "60%": { width: "75%" },
          "100%": { width: "100%", opacity: "0" },
        },
      },
      animation: {
        "nav-progress-slide": "nav-progress-slide 0.6s ease-out forwards",
      },
    },
  },
  plugins: [],
};
