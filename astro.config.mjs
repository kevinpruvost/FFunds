import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import starlight from '@astrojs/starlight';
import starlightThemeSix from '@six-tech/starlight-theme-six'

export default defineConfig({

  site: 'https://kevinpruvost.github.io',
	base: '/FFunds',

  integrations: [
    starlight({
      plugins: [
        starlightThemeSix({
          navLinks: [{ // optional
            label: 'Docs',
            link: '/getting-started',
          }],
          footerText: //optional
            'Built & designed by [Six](https://six.technology).'
       })
      ],
      title: 'FFunds',
      defaultLocale: 'root',
      locales: {
        root: { label: 'Français', lang: 'fr' },
      },
      sidebar: [
        {
          label: 'Documentation',
          items: [
            { label: 'Connaissances en investissement', slug: 'index' },
            { label: 'Simulations', slug: 'simulations' },
          ],
        },
      ],
    }),
    mdx(),
  ],
});
