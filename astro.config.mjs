import { defineConfig, passthroughImageService } from 'astro/config';
import starlight from '@astrojs/starlight';
import { unified } from '@astrojs/markdown-remark';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

// 导入多合集配置和我们的自然排序侧边栏生成器
import { collections } from './src/config/collections.config.ts';
import { generateStarlightBookSidebar } from './src/server/adapters/starlight-sidebar.mjs';

import { features, isEffective, crossRefRefs, IS_DEV } from './src/config/features.config.ts';

// 公式源码回填插件：让每个 KaTeX 公式携带 data-latex 原始源码（供前端一键复制）
import { rehypeKatexAnnotate, rehypeKatexPromote } from './src/plugins/rehype/rehype-katex-source.mjs';
// 数学变量智能提升插件：构建期提升正文漏网单字母变量与简式为 KaTeX 公式
import rehypeMathPromote from './src/plugins/rehype/rehype-math-promote.mjs';
// 构建期引用徽章下沉插件（方案 B）：把“例题 1.74 / 图 3-48 → badge”的匹配逻辑
// 从客户端 SPA 切换时扫描下沉到构建期，客户端切换零扫描（详见 docs/architecture/reader-and-content-pipeline.md）
import { rehypeCrossRef } from './src/plugins/rehype/rehype-cross-ref.mjs';
// 章节 LaTeX / PDF 导出：/__chapter_export__/* 实时端点（Vite dev server 插件，仅 dev 启用）
import devChapterExportServerPlugin from './src/server/plugins/chapter-export/dev-server-plugin.mjs';
// Gemini AI 中继模块：/api/proxy/gemini/* 本地 Node.js 进程全双工反代端点（Vite dev server 插件，仅 dev 启用）
import { geminiProxyDevServerPlugin } from './src/server/plugins/gemini-proxy/dev-server-plugin.mjs';
// BUPT AI 中继模块：/api/proxy/bupt/* 本地 Node.js 进程全双工反代端点（Vite dev server 插件，仅 dev 启用）
import { buptProxyDevServerPlugin } from './src/server/plugins/bupt-proxy/dev-server-plugin.mjs';
// 统一翻译模块：/api/translate/* 本地服务端点（Vite dev server 插件，仅 dev 启用）
import { translationDevServerPlugin } from './src/server/plugins/translation/dev-server-plugin.mjs';
// 文档摄取与 MinerU 自动解析服务：/api/ingest/* 本地服务端点（Vite dev server 插件，仅 dev 启用）
import { ingestDevServerPlugin } from './src/server/plugins/doc-ingestion/dev-server-plugin.mjs';
// 双语向量关联与热力图推理模块：/__bilingual__/* 本地端点（Vite dev server 插件，仅 dev 启用）
import { bilingualDevServerPlugin } from './src/server/plugins/bilingual-aligner/dev-server-plugin.mjs';
// 本地 Qwen 信息高亮与关注点透镜端点：/__info_highlight__/*（Vite dev server 插件，仅 dev 启用）
import { infoHighlightDevServerPlugin } from './src/server/plugins/info-highlight/dev-server-plugin.mjs';
// 统一研读实体与书库端点：/api/library/* 本地服务端点（Vite dev server 插件，仅 dev 启用）
import { devLibraryServerPlugin } from './src/server/plugins/library/dev-server-plugin.mjs';
// 统一内部内容数据 REST 服务：/api/v1/content/* 本地服务端点（Vite dev server 插件，仅 dev 启用）
import { contentApiDevServerPlugin } from './src/server/plugins/content-api/dev-server-plugin.mjs';
// 自动化 PDF2ABP 多智能体转换端点：/api/v1/pdf2abp/* 本地服务端点
import { pdf2abpDevServerPlugin } from './src/server/plugins/pdf2abp/dev-server-plugin.mjs';
// Mermaid 图表拦截插件：将 ```mermaid 代码块转化为 .mermaid-container DOM
import rehypeMermaid from './src/plugins/rehype/rehype-mermaid.mjs';
// 图像高斯模糊占位插件：为正文图片在构建期生成微型 LQIP Base64 占位并平滑渐显
import rehypeImageBlur from './src/plugins/rehype/rehype-image-blur.mjs';
// 中文学术标点规范化与呼吸间距自愈插件：智能修复 MinerU 识别的半角标点与句间间距
import rehypeCjkPunctuation from './src/plugins/rehype/rehype-cjk-punctuation.mjs';

// 根据中央图书配置，全自动生成自然排序的树状侧边栏 (Zero-Built-in Books 架构)
const dynamicSidebar = [
  ...collections.map(col => ({
    label: col.title,
    collapsed: true,
    items: (col.books || []).map(book => ({
      label: book.title,
      collapsed: true,
      // 调用生成器，就地读取目录并进行 1.1 -> 10.1 排序，取代鸡肋的默认 autogenerate
      items: generateStarlightBookSidebar(`content-sources/collections/${col.slug}/${book.slug}`, { languages: book.languages })
    }))
  }))
];

/* ---------------------------------------------------------------------------
 * 通用装配辅助：按功能开关拼装 Starlight 配置
 *   · 功能关闭（features.<id>.enabled = false）→ 对应插件/CSS/组件不进入产物
 *   · 关键注释保留，避免后续改回（性能约束见 astro-project-guide / 交接文档）
 * ------------------------------------------------------------------------- */

// remark 插件（KaTeX）：关闭则 $..$ 不做数学处理
const remarkPlugins = [];
if (features.katex.enabled) remarkPlugins.push(remarkMath);

// rehype 插件（顺序至关重要）：katex 相关需“前后夹住” rehype-katex
const rehypePlugins = [];
if (features.katex.enabled) {
  // output: 'html' 去掉 MathML 重复标记，公式页 HTML 体积约减半；
  // strict/throwOnError 关闭保证 OCR 出的部分不严谨 LaTeX 不阻断构建。
  // rehypeKatexAnnotate / rehypeKatexPromote 夹在 rehype-katex 前后，
  // 把原始 LaTeX 源码写进成品公式的 data-latex 属性（供前端复制）。
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
  // 学术出版标点与呼吸间距自愈（在 KaTeX 完成公式渲染后执行，确保精准跳过公式内部与代码块）
  rehypePlugins.push(rehypeCjkPunctuation);
}
if (features.crossRef.enabled) {
  // 方案 B：构建期徽章下沉，须在 KaTeX 相关插件之后执行（依赖公式结构已定型）。
  // refs 取 features.crossRef.config.refs：'static' 时强制全部静态 chip（关闭同页联动）
  rehypePlugins.push([rehypeCrossRef, { collections, refs: crossRefRefs() }]);
}

if (features.mermaid.enabled) {
  // Mermaid 图表代码块拦截
  rehypePlugins.push(rehypeMermaid);
}
if (features.imageBlur.enabled) {
  // 正文图像高斯模糊占位与尺寸防抖动
  rehypePlugins.push(rehypeImageBlur);
}

// customCss 顺序很重要（同特异性、同层，后加载者生效）：
//   katex 基础样式必须先于 custom.css（后者覆盖 .katex .tag 定位）；
//   vitepress-theme 色板须在 custom.css 之后（优先级最高），删除即整体回退；
//   fonts.css 必须最后加载，才能覆盖 vitepress-theme 里对 --sl-font 的默认定义；
//   关闭某功能即不引入对应 CSS（如关闭 fonts 则不打包 @fontsource 与 fonts.css）。
const customCss = [];
if (features.katex.enabled) customCss.push('katex/dist/katex.min.css');
customCss.push('./src/styles/custom.css');
if (features.theme.enabled) {
  customCss.push('./src/themes/material-you/theme.css');
}
if (features.fonts.enabled) {
  // 自托管思源 webfont 与 Plus Jakarta Sans 品牌英文字体由 registry 引入（index.css 含全部 unicode-range 切片）。
  // 默认系统档位浏览器不会下载任何 woff2（未 use 的 @font-face 不请求），零下载。
  customCss.push('@fontsource-variable/noto-sans-sc/index.css');
  customCss.push('@fontsource-variable/noto-serif-sc/index.css');
  customCss.push('@fontsource-variable/plus-jakarta-sans/index.css');
  customCss.push('./src/styles/fonts.css');
}

// 组件覆盖：仅主题切换按开关装配（其余为自定义骨架/性能优化，恒用）
const componentOverrides = {
  Header: './src/components/HeaderOverride.astro',        // 紧凑学术顶栏（Logo/Search/Links/ThemeSelect/Dividers）
  Sidebar: './src/components/SidebarOverride.astro',      // 左侧 LaTeX 公式渲染
  PageSidebar: './src/components/PageSidebarOverride.astro', // 右侧多合集自适应大纲与卡片修补
  Pagination: './src/components/PaginationOverride.astro', // 文章底部翻页卡片（M3 Filled Tonal Pagers）
  Footer: './src/components/FooterOverride.astro', // 底部：原翻页/编辑链接 + 在线精修工具壳（仅 dev）
  PageFrame: './src/components/PageFrameOverride.astro', // 顶层骨架覆盖：注入全站统一视窗挂载容器 (#astro-overlay-root)
  PageTitle: './src/components/PageTitleOverride.astro', // 页面大标题 H1 构建期数学公式转译（零客户端 KaTeX）
  SocialIcons: './src/components/SocialIconsOverride.astro', // 顶栏 GitHub 社交入口：覆盖默认黑底硬币圆盘，使用官方净标
  TwoColumnContent: './src/components/TwoColumnContentOverride.astro', // 正文两栏布局覆盖：在正文卡片上方挂载 NoticeFramework
  Head: './src/components/HeadOverride.astro', // 全站 SEO 增强：智能 Title 补齐书名、Description 自动合成、Schema.org 与站长验证
  MarkdownContent: './src/components/MarkdownContentOverride.astro', // 正文语义增强：包裹为 <article role="article"> 赋能 Chrome 朗读/阅读模式
  Search: './src/features/search-rec/ui/SearchModal.astro', // 跨书知识整合、多模态搜索与推荐系统
};
if (features.theme.enabled) {
  componentOverrides.ThemeSelect = './src/components/ThemeSelectOverride.astro'; // 顶栏外观与主题切换按钮
}

export default defineConfig({
  // 规范站点根域名
  site: 'https://astrolib.cloud',
  // 彻底关闭 Starlight/Astro 默认隐式启用的全量链接悬停预取
  // 页面预取与内存缓存完全由 AstroLib 自研 SPA 路由引擎与用户偏好设置精准接管
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
      // 章节 LaTeX / PDF 导出端点：仅 dev + chapterExport 启用时注册（生产构建不加载，零污染）
      ...(isEffective('chapterExport') ? [devChapterExportServerPlugin()] : []),
      // Gemini AI 本地 Node.js 进程全双工中继反代端点（仅 dev 启用）
      geminiProxyDevServerPlugin(),
      // 统一学术教材翻译本地服务端点（仅 dev 启用）
      translationDevServerPlugin(),
      // MinerU 学术文档摄取与自动解析本地服务端点（仅 dev 启用）
      ingestDevServerPlugin(),
      // 双语向量关联与热力图推理端点（仅 dev 启用）
      bilingualDevServerPlugin(),
      // BUPT AI 本地 Node.js 进程全双工中继反代端点（仅 dev 启用）
      buptProxyDevServerPlugin(),
      // 本地 Qwen 关注点透镜与信息高亮端点（仅 dev 启用）
      infoHighlightDevServerPlugin(),
      // 统一研读实体与书库端点（仅 dev 启用）
      devLibraryServerPlugin(),
      // 统一内部内容数据 REST 服务端点（仅 dev 启用）
      contentApiDevServerPlugin(),
      // 自动化 PDF2ABP 多智能体转换端点（仅 dev 启用）
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
