import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        togo: {
          green: "#2E7D32",
          yellow: "#FDD835",
          red: "#C62828",
        },
      },
    },
  },
  plugins: [],
};

export default config;
