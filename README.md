# 深入浅出 React

从直觉、机制到源码，系统理解 React 18/19。

这是一本面向有前端开发经验读者的 React 学习笔记，沿着“先理解现象，再解释机制，最后联系源码和工程实践”的路线，逐步梳理 React 的组件模型、Hooks、Fiber、并发更新、状态管理、性能优化和复杂项目架构。

在线阅读：[GitHub Pages](https://thosewhoyoulove.github.io/diving-in-react/)

## 内容特点

- 用最小代码解释 React 的公开行为；
- 用 Render、Commit、Fiber、Lane 等概念建立运行模型；
- 区分官方 API 行为、当前源码实现和工程实践；
- 结合请求竞态、流式数据、权限系统和性能分析等业务场景；
- 每章包含源码模型、业务代码、错误边界和练习题。

## 当前进度

第 1 至第 21 章已经完成，第 22 至第 26 章已经建立目录和主题，正在继续补充正文。

已完成的章节包括：

1. React 解决了什么问题
2. JSX、React Element 与虚拟 DOM
3. React 应用是如何启动的
4. 函数组件与组件树
5. `useState` 的工作原理
6. Hooks 的规则与本质
7. 为什么 React 需要 Fiber
8. Fiber 如何实现可中断渲染
9. React 的 Reconciliation 与 Diff
10. Lane、优先级与调度
11. `useEffect`
12. `useRef`、`useMemo` 与 `useCallback`
13. Context、自定义 Hook 与状态抽离
14. React 状态管理
15. Redux 的工作原理
16. React 中的异步与流式数据
17. React 为什么会重新渲染
18. React 性能优化方法
19. 浏览器渲染与 React 性能
20. React 项目工程化
21. React Router 与权限系统

后续章节方向：

- 第 22 章：React 微前端与 iframe 通信；
- 第 23 章：React 源码阅读方法；
- 第 24 章：从 `setState` 到页面更新的完整链路；
- 第 25 章：React 高频面试题；
- 第 26 章：综合项目：SSE 流式 AI Agent。

完整章节导航位于 [`docs/.vitepress/config.ts`](./docs/.vitepress/config.ts)。

## 学习路线

```text
React 基础
  -> 组件、Props 与 State
  -> Fiber、Diff、Lane 与调度
  -> Hooks、异步流和状态管理
  -> 性能、工程化和复杂架构
  -> 源码阅读、面试表达和综合项目
```

建议按照章节顺序阅读。第 7 至第 10 章建立 Fiber 和调度模型，第 11 至第 16 章把模型应用到 Hooks、状态管理和异步流，第 17 至第 21 章再进入性能与工程架构。

## 本地运行

环境要求：

- Node.js 20 或更高版本；
- npm；

安装依赖：

```bash
npm install
```

启动本地文档服务：

```bash
npm run docs:dev
```

启动后打开终端输出的本地地址。VitePress 会在 Markdown 文件变化后自动更新页面。

构建生产文档：

```bash
npm run docs:build
```

预览生产构建结果：

```bash
npm run docs:preview
```

生产构建输出在 `docs/.vitepress/dist`。该目录由 Git 忽略，不应手动提交。

## 项目结构

```text
.
├── docs/
│   ├── chapters/          # 各章 Markdown 正文
│   ├── guide/             # 学习路线和完整目录
│   ├── index.md           # 文档首页
│   └── .vitepress/
│       ├── config.ts      # 标题、导航、侧边栏和部署路径
│       └── theme/         # 自定义主题样式
├── .github/workflows/
│   └── deploy-pages.yml   # GitHub Pages 构建与部署
├── package.json
└── package-lock.json
```

## 文档写作约定

每章尽量保持以下结构：

1. 本章学习目标；
2. 最小源码模型；
3. 业务代码示例；
4. React 内部运行机制；
5. 常见错误和错误边界；
6. 性能与架构考虑；
7. 练习题和本章小结。

涉及 React 源码时，会明确区分：

- **官方行为**：公开 API 和文档明确保证的行为；
- **源码视角**：React 18/19 当前实现中的内部机制，可能随版本变化；
- **工程实践**：真实项目中的设计、测试和性能经验。

## 发布方式

推送到 `main` 分支后，GitHub Actions 会自动执行以下流程：

1. 使用 Node.js 20 安装锁定依赖；
2. 执行 `npm run docs:build`；
3. 上传 `docs/.vitepress/dist` 构建产物；
4. 部署到 GitHub Pages。

工作流文件位于 [`deploy-pages.yml`](./.github/workflows/deploy-pages.yml)。如果本地构建失败，应先修复构建问题，再推送到 `main`。

## 参与完善

欢迎通过 Issue 或 Pull Request 提出：

- API 行为或源码解释中的错误；
- 示例代码的边界问题；
- 章节顺序和学习路径建议；
- 需要补充的业务场景或练习题。

提交文档修改前，建议运行：

```bash
npm run docs:build
git diff --check
```

## 许可证

本项目当前用于学习和技术交流。具体转载、引用和二次发布规则以后续仓库声明为准。
