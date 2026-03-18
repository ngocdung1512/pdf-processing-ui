import coreWebVitals from "eslint-config-next/core-web-vitals"

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "OCR_LLM/**",
      "uploads/**",
      "conversion_env/**",
      ".venv/**",
      "__pycache__/**",
      ".npm-cache/**",
      ".pip-cache/**",
      "DocLayout-YOLO/**",
    ],
  },
  ...coreWebVitals,
]

export default config

