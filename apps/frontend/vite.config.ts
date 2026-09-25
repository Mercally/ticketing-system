import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Vite ignores the PORT env var by default; aspire/AppHost.cs sets it (WithHttpEndpoint(env:
    // "PORT", port: 5173)) expecting Vite to actually bind there, since Gateway's CORS allow-list
    // is wired from this same resource's resolved endpoint. Without this, a port already in use
    // makes Vite silently pick a different one, which the rest of the stack won't know about.
    port: Number(process.env.PORT) || 5173,
  },
})
