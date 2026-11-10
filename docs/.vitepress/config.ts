import container from 'markdown-it-container';
import { defineConfig } from 'vitepress';

const chapters = [
  {
    text: '第一部分：React 基础与运行模型',
    items: [
      { text: '第 1 章 React 解决了什么问题', link: '/chapters/01-why-react' },
      { text: '第 2 章 JSX、React Element 与虚拟 DOM', link: '/chapters/02-jsx-element-vdom' },
      { text: '第 3 章 React 应用是如何启动的', link: '/chapters/03-startup' },
    ],
  },
  {
    text: '第二部分：组件、Props 与 State',
    items: [
      { text: '第 4 章 函数组件与组件树', link: '/chapters/04-components' },
      { text: '第 5 章 useState 的工作原理', link: '/chapters/05-usestate' },
      { text: '第 6 章 Hooks 的规则与本质', link: '/chapters/06-hooks-rules' },
    ],
  },
  {
    text: '第三部分：Fiber 与 React 更新机制',
    items: [
      { text: '第 7 章 为什么 React 需要 Fiber', link: '/chapters/07-fiber' },
      { text: '第 8 章 Fiber 如何实现可中断渲染', link: '/chapters/08-interruptible-render' },
      { text: '第 9 章 React 的 Reconciliation 与 Diff', link: '/chapters/09-reconciliation' },
      { text: '第 10 章 Lane、优先级与调度', link: '/chapters/10-lanes' },
    ],
  },
  {
    text: '第四部分：Hooks 深入理解',
    items: [
      { text: '第 11 章 useEffect', link: '/chapters/11-useeffect' },
      { text: '第 12 章 useRef、useMemo 与 useCallback', link: '/chapters/12-memoization' },
      { text: '第 13 章 Context、自定义 Hook 与状态抽离', link: '/chapters/13-context-hooks' },
    ],
  },
  {
    text: '第五部分：状态管理与复杂业务架构',
    items: [
      { text: '第 14 章 React 状态管理', link: '/chapters/14-state-management' },
      { text: '第 15 章 Redux 的工作原理', link: '/chapters/15-redux' },
      { text: '第 16 章 React 中的异步与流式数据', link: '/chapters/16-streaming' },
    ],
  },
  {
    text: '第六部分：React 性能优化',
    items: [
      { text: '第 17 章 React 为什么会重新渲染', link: '/chapters/17-rerender' },
      { text: '第 18 章 React 性能优化方法', link: '/chapters/18-performance' },
      { text: '第 19 章 浏览器渲染与 React 性能', link: '/chapters/19-browser-performance' },
    ],
  },
  {
    text: '第七部分：React 工程化与项目架构',
    items: [
      { text: '第 20 章 React 项目工程化', link: '/chapters/20-engineering' },
      { text: '第 21 章 React Router 与权限系统', link: '/chapters/21-router-permission' },
      { text: '第 22 章 React 微前端与 iframe 通信', link: '/chapters/22-iframe' },
    ],
  },
  {
    text: '第八部分：源码阅读与面试实战',
    items: [
      { text: '第 23 章 React 源码阅读方法', link: '/chapters/23-source-reading' },
      { text: '第 24 章 从 setState 到页面更新的完整链路', link: '/chapters/24-update-pipeline' },
      { text: '第 25 章 React 高频面试题', link: '/chapters/25-interview' },
      { text: '第 26 章 综合项目：SSE 流式 AI Agent', link: '/chapters/26-ai-agent' },
    ],
  },
  {
    text: '第九部分：React 19 与全栈渲染',
    items: [
      { text: '第 27 章 React 19 的 Actions 与乐观更新', link: '/chapters/27-actions' },
      { text: '第 28 章 SSR、Streaming SSR、Hydration 与 Server Components', link: '/chapters/28-ssr-rsc' },
      { text: '第 29 章 React Compiler、自动记忆化与手动优化', link: '/chapters/29-compiler' },
      { text: '第 30 章 React 数据获取、缓存一致性与服务端状态架构', link: '/chapters/30-data-fetching' },
    ],
  },
  {
    text: '第十部分：复杂交互与前端基础设施',
    items: [
      { text: '第 31 章 React 表单、校验与复杂提交', link: '/chapters/31-forms' },
      { text: '第 32 章 React 可访问性与键盘交互', link: '/chapters/32-accessibility' },
      { text: '第 33 章 React 设计系统与业务组件复用', link: '/chapters/33-design-system' },
      { text: '第 34 章 Web Worker、SharedWorker 与 React 高负载任务', link: '/chapters/34-workers' },
      { text: '第 35 章 React 离线能力、PWA 与冲突处理', link: '/chapters/35-offline' },
      { text: '第 36 章 React 可观测性、错误监控与线上性能治理', link: '/chapters/36-observability' },
    ],
  },
];

const customContainerTitles = {
  interview: '面试重点',
  confuse: '容易混淆',
  source: '源码视角',
  practice: '工程实践',
  note: '版本说明',
};

function configureCustomContainers(md: any) {
  const defaultFence = md.renderer.rules.fence;

  md.renderer.rules.fence = (tokens: any[], index: number, options: any, env: any, self: any) => {
    const token = tokens[index];

    if (token.info.trim() === 'mermaid') {
      return `<pre class="mermaid">${md.utils.escapeHtml(token.content)}</pre>`;
    }

    return defaultFence(tokens, index, options, env, self);
  };

  Object.entries(customContainerTitles).forEach(([type, defaultTitle]) => {
    md.use(container, type, {
      render(tokens: Array<{ nesting: number; info: string }>, index: number) {
        const token = tokens[index];

        if (token.nesting === 1) {
          const title = token.info.trim().slice(type.length).trim() || defaultTitle;
          return `<div class="custom-block ${type}"><p class="custom-block-title">${title}</p>\n`;
        }

        return '</div>\n';
      },
    });
  });
}

export default defineConfig({
  markdown: {
    config: configureCustomContainers,
  },
  base: '/diving-in-react/',
  lang: 'zh-CN',
  title: '深入浅出 React',
  description: '从直觉、机制到源码，系统理解 React 18/19。',
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    logo: { text: 'DR' },
    siteTitle: '深入浅出 React',
    nav: [
      { text: '首页', link: '/' },
      { text: '目录', link: '/guide/' },
      { text: '开始阅读', link: '/chapters/01-why-react' },
      { text: 'GitHub', link: 'https://github.com/thosewhoyoulove/diving-in-react', target: '_blank', rel: 'noopener' },
    ],
    sidebar: chapters,
    outline: { level: [2, 3], label: '本页目录' },
    lastUpdated: {
      text: '最后更新于',
      formatOptions: {
        dateStyle: 'long',
        timeStyle: 'short',
        forceLocale: true,
      },
    },
    docFooter: {
      prev: '上一章',
      next: '下一章',
    },
    socialLinks: [
      {
        icon: 'github',
        link: 'https://github.com/thosewhoyoulove/diving-in-react',
        ariaLabel: 'GitHub',
      },
    ],
    search: {
      provider: 'local',
      options: {
        detailedView: 'auto',
        translations: {
          button: {
            buttonText: '搜索全书',
            buttonAriaLabel: '搜索全书',
          },
          modal: {
            displayDetails: '显示详细结果',
            resetButtonTitle: '清除搜索',
            backButtonTitle: '关闭搜索',
            noResultsText: '没有找到相关内容',
            footer: {
              selectText: '选择',
              selectKeyAriaLabel: '回车',
              navigateText: '导航',
              navigateUpKeyAriaLabel: '上箭头',
              navigateDownKeyAriaLabel: '下箭头',
              closeText: '关闭',
              closeKeyAriaLabel: 'Esc',
            },
          },
        },
      },
    },
    footer: {
      message: '用运行机制理解 React，用工程实践验证 React。',
      copyright: '《深入浅出 React》学习笔记',
    },
  },
});
