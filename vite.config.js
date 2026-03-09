import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/catalog-app/',  // GitHub 저장소 이름과 동일하게
})
