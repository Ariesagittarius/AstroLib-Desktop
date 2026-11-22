import { defineConfig, passthroughImageService } from 'astro/config';
import starlight from '@astrojs/starlight';
import { unified } from '@astrojs/markdown-remark';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

import { collections } from './src/config/collections.config.ts';
import { generateStarlightBookSidebar } from './src/server/adapters/starlight-sidebar.mjs';

import { features, isEffective, crossRefRefs, IS_DEV } from './src/config/features.config.ts';

import { rehypeKatexAnnotate, rehypeKatexPromote } from './src/plugins/rehype/rehype-katex-source.mjs';

import rehypeMathPromote from './src/plugins/rehype/rehype-math-promote.mjs';

import { rehypeCrossRef } from './src/plugins/rehype/rehype-cross-ref.mjs';

import devChapterExportServerPlugin from './src/server/plugins/chapter-export/dev-server-plugin.mjs';

import { geminiProxyDevServerPlugin } from './src/server/plugins/gemini-proxy/dev-server-plugin.mjs';

import { buptProxyDevServerPlugin } from './src/server/plugins/bupt-proxy/dev-server-plugin.mjs';

import { translationDevServerPlugin } from './src/server/plugins/translation/dev-server-plugin.mjs';

import { ingestDevServerPlugin } from './src/server/plugins/doc-ingestion/dev-server-plugin.mjs';

import { bilingualDevServerPlugin } from './src/server/plugins/bilingual-aligner/dev-server-plugin.mjs';

import { infoHighlightDevServerPlugin } from './src/server/plugins/info-highlight/dev-server-plugin.mjs';

import { devLibraryServerPlugin } from './src/server/plugins/library/dev-server-plugin.mjs';

import { contentApiDevServerPlugin } from './src/server/plugins/content-api/dev-server-plugin.mjs';

import { pdf2abpDevServerPlugin } from './src/server/plugins/pdf2abp/dev-server-plugin.mjs';

import rehypeMermaid from './src/plugins/rehype/rehype-mermaid.mjs';

import rehypeImageBlur from './src/plugins/rehype/rehype-image-blur.mjs';

import rehypeCjkPunctuation from './src/plugins/rehype/rehype-cjk-punctuation.mjs';

const dynamicSidebar = [
  ...collections.map(col => ({
    label: col.title,
    collapsed: true,
    items: (col.books || []).map(book => ({
      label: book.title,
      collapsed: true,

      items: generateStarlightBookSidebar(`content-sources/collections/${col.slug}/${book.slug}`, { languages: book.languages })
    }))
  }))
];

const remarkPlugins = [];
if (features.katex.enabled) remarkPlugins.push(remarkMath);

const rehypePlugins = [];
if (features.katex.enabled) {

  const katexGroup = [];
  if (features.mathPromote?.enabled) {
    katexGroup.push(rehypeMathPromote);
  }
  katexGroup.push(
    rehypeKatexAnnotate,
    [rehypeKatex, { output: 'html', strict: false, throwOnError: false }],
    rehypeKatexPromote,
  );
  rehypePlugins.push(...katexGroup);
}
if (features.cjkPunctuation?.enabled) {

  rehypePlugins.push(rehypeCjkPunctuation);
}
if (features.crossRef.enabled) {

  rehypePlugins.push([rehypeCrossRef, { collections, refs: crossRefRefs() }]);
}

if (features.mermaid.enabled) {

  rehypePlugins.push(rehypeMermaid);
}
if (features.imageBlur.enabled) {

  rehypePlugins.push(rehypeImageBlur);
}

const customCss = [];
if (features.katex.enabled) customCss.push('katex/dist/katex.min.css');
customCss.push('./src/styles/custom.css');
if (features.theme.enabled) {
  customCss.push('./src/themes/material-you/theme.css');
}
if (features.fonts.enabled) {

  customCss.push('@fontsource-variable/noto-sans-sc/index.css');
  customCss.push('@fontsource-variable/noto-serif-sc/index.css');
  customCss.push('@fontsource-variable/plus-jakarta-sans/index.css');
  customCss.push('./src/styles/fonts.css');
}

const componentOverrides = {
  Header: './src/components/HeaderOverride.astro',
  Sidebar: './src/components/SidebarOverride.astro',
  PageSidebar: './src/components/PageSidebarOverride.astro',
  Pagination: './src/components/PaginationOverride.astro',
  Footer: './src/components/FooterOverride.astro',
  PageFrame: './src/components/PageFrameOverride.astro',
  PageTitle: './src/components/PageTitleOverride.astro',
  SocialIcons: './src/components/SocialIconsOverride.astro',
  TwoColumnContent: './src/components/TwoColumnContentOverride.astro',
  Head: './src/components/HeadOverride.astro',
  MarkdownContent: './src/components/MarkdownContentOverride.astro',
  Search: './src/features/search-rec/ui/SearchModal.astro',
};
if (features.theme.enabled) {
  componentOverrides.ThemeSelect = './src/components/ThemeSelectOverride.astro';
}

export default defineConfig({

  site: 'https://astrolib.cloud',

  prefetch: false,
  image: {
    service: passthroughImageService(),
  },
  markdown: {
    processor: unified({
      remarkPlugins,
      rehypePlugins,
    }),
  },
  integrations: [
    starlight({
      title: 'AstroLib',
      description: '大学理工科教材与学术资料数字化阅读与自测系统',
      defaultLocale: 'root',
      locales: {
        root: {
          label: '简体中文',
          lang: 'zh-CN',
        },
      },
      favicon: '/favicon.png',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/Ariesagittarius/AstroLib',
        },
      ],
      components: componentOverrides,
      sidebar: dynamicSidebar,
      customCss,
    }),
  ],
  vite: {
    plugins: [

      ...(isEffective('chapterExport') ? [devChapterExportServerPlugin()] : []),

      geminiProxyDevServerPlugin(),

      translationDevServerPlugin(),

      ingestDevServerPlugin(),

      bilingualDevServerPlugin(),

      buptProxyDevServerPlugin(),

      infoHighlightDevServerPlugin(),

      devLibraryServerPlugin(),

      contentApiDevServerPlugin(),

      pdf2abpDevServerPlugin(),
    ],
    resolve: {
      alias: {
        '@': '/src',
      },
    },
    optimizeDeps: {
      include: ['mermaid'],
    },
    ssr: {
      noExternal: ['mermaid'],
    },
    server: {
      watch: {
        ignored: [
          '**/task/**',
          '**/.temp/**',
          '**/.astro/**',
          '**/artifacts/**',
          '**/dist/**',
        ],
      },
      ...(process.env.ASTROLIB_ENABLE_TUNNEL === '1'
        ? {
            allowedHosts: [
              '.trycloudflare.com',
              '.vaiwan.com',
              '.localtunnel.me',
            ],
          }
        : {}),
    }
  },
});
