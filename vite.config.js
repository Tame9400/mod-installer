import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '',
  plugins: [
    react(),
    {
      name: 'remove-crossorigin',
      transformIndexHtml: {
        enforce: 'post',
        transform(html) {
          return html.replace(/ crossorigin/g, '');
        },
      },
    },
  ],
  root: 'src/renderer',
  build: {
    outDir: '../../dist/renderer',
    emptyOutWarn: true,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      input: 'src/renderer/index.html',
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
