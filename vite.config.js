import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Replace 'vancouver-re-analyzer' with whatever your GitHub repo name is
export default defineConfig({
  plugins: [react()],
  base: '/vancouver-re-analyzer/',
})
