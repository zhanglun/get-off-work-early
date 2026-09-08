import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // 独立默认端口（避开 5173 常用段，减少与其它 Vite 项目相撞）；被占用时自动递增，实际端口以终端输出为准
    port: 5180,
    strictPort: false,
    proxy: { '/api': 'http://localhost:4120' },
  },
});
