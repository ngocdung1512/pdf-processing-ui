/**
 * Backend API base URL. Used by convert (PDF→DOCX) and chatbot.
 * Set NEXT_PUBLIC_API_URL in .env.local to override (e.g. for production).
 */
export const API_BASE_URL =
  typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_URL
    ? process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, "")
    : "http://localhost:8000";

export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${p}`;
}
