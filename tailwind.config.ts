import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        arabic: ["var(--font-readex)", "Readex Pro", "sans-serif"],
        mono: ["var(--font-jetbrains)", "JetBrains Mono", "monospace"],
      },
      colors: {
        bmw: {
          black: "#0A0B0D",
          carbon: "#121418",
          card: "#181B20",
          cardBorder: "#242831",
          blue: "#0066B1",
          electricBlue: "#1C69D4",
          mDarkBlue: "#002C5F",
          mRed: "#E2231A",
          muted: "#8E939D",
          silver: "#E6E6E6",
        },
      },
      boxShadow: {
        "bmw-glow": "0 0 25px -5px rgba(0, 102, 177, 0.4)",
        "m-red-glow": "0 0 25px -5px rgba(226, 35, 26, 0.4)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.97)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "m-sweep": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out",
        "scale-in": "scale-in 0.18s ease-out",
        "m-sweep": "m-sweep 2.2s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
};

export default config;
