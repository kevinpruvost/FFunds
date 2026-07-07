import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  site: 'https://kevinpruvost.github.io',
  base: '/FFunds',
  integrations: [react()],
  vite: {
    css: {
      postcss: './postcss.config.cjs',
    },
  },
});
