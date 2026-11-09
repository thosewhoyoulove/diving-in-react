---
title: 第 20 章 React 项目工程化
outline: deep
---

# 第 20 章 React 项目工程化

React 项目从几个组件成长为长期维护的产品后，代码组织、类型检查、测试、错误上报、配置和部署会直接影响交付速度。工程化的目标是让错误尽早暴露，让构建结果可重复，让团队能安全修改共享代码。

本章以 Vite、TypeScript、ESLint、测试和 GitHub Pages 为例说明工程边界。工具可以替换，但边界问题普遍存在：源码如何编译、环境变量如何注入、错误如何恢复、构建如何验证、发布如何回滚。

## 本章学习目标

学习完本章，你应该能够：

1. 规划 React 项目的目录和模块边界；
2. 配置 TypeScript、Lint、格式化和构建检查；
3. 区分单元测试、组件测试和端到端测试；
4. 使用 Error Boundary 处理渲染错误；
5. 安全读取环境变量并区分构建时配置；
6. 设计 CI、静态部署和运行时观测。

## 20.1 源码模型：从源码到可访问页面

工程化的源码链路需要同时包含构建和运行时：

```mermaid
flowchart LR
  A[源代码] --> B[TypeScript / JSX 编译]
  B --> C[打包与代码分割]
  C --> D[浏览器加载模块]
  D --> E[createRoot / hydrateRoot]
  E --> F[React Render 与 Commit]
  F --> G[可访问页面]
```

输入是源码和构建配置，处理过程是编译、拆包、加载和挂载，输出是浏览器中的组件树。构建检查解决交付问题，运行时测试解决用户行为问题，两者需要分别验证。

一个 Vite React 项目通常经历：

```text
TypeScript / JSX / CSS
  -> Vite 开发服务器或生产构建
  -> 模块解析、转换、Tree Shaking、代码分割
  -> 静态资源输出
  -> CDN 或静态服务器
  -> 浏览器加载入口
  -> React createRoot / hydrateRoot
```

开发环境的模块热更新和生产环境的打包结果不同。不能只在开发服务器中验证路径、资源、环境变量和错误恢复。

### 20.1.1 入口边界

```tsx
const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('缺少 #root 节点');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

入口负责挂载、全局 Provider、错误边界和基础样式。业务组件不应该在模块顶层隐式创建全局连接或读取不可用的浏览器对象。

### 20.1.2 目录按职责和业务划分

```text
src/
  app/          # 入口、Provider、路由
  features/     # 按业务领域组织的组件、Hook、API
  components/   # 跨领域通用组件
  lib/          # 请求、日志、日期、验证等基础能力
  pages/        # 页面组合
  test/         # 测试工具和 Mock
```

目录不是架构本身。真正的边界是依赖方向：基础模块不依赖页面，通用组件不读取某个页面的私有 Store，业务模块通过接口访问基础能力。

## 20.2 TypeScript 建模

### 20.2.1 从接口边界开始定义类型

```ts
export type User = {
  id: string;
  name: string;
  role: 'admin' | 'member';
};

export type ApiError = {
  code: string;
  message: string;
  requestId?: string;
};

export async function getUser(id: string): Promise<User> {
  const response = await fetch(`/api/users/${encodeURIComponent(id)}`);
  if (!response.ok) {
    const error = await response.json() as ApiError;
    throw new Error(`${error.code}: ${error.message}`);
  }
  return response.json() as Promise<User>;
}
```

类型应反映接口可能的失败和状态，而不是把所有数据都写成 `any`。运行时接口仍可能返回错误结构，需要 Schema 校验库或手工校验来补足 TypeScript 的静态边界。

### 20.2.2 用联合类型表达加载状态

```ts
type Resource<T> =
  | { status: 'idle' }
  | { status: 'loading'; previous?: T }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error; previous?: T };
```

这种类型能让 UI 在 `switch` 中覆盖所有状态，并保留错误时的旧数据，减少“白屏”式错误体验。

## 20.3 Lint、格式化和构建检查

`eslint-plugin-react-hooks` 可以发现 Hook 依赖和调用顺序问题；TypeScript 检查可以发现 Props、Reducer 和 API 数据的类型错误；格式化工具统一代码样式。CI 至少应运行：

```json
{
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "build": "vite build"
  }
}
```

命令应尽量在本地和 CI 使用同一版本、同一锁文件和同一 Node 版本。构建成功不等于功能正确，类型通过也不等于运行时接口安全。

## 20.4 测试分层

### 20.4.1 纯函数单元测试

```ts
export function formatPrice(value: number, currency = 'CNY') {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
  }).format(value);
}
```

这个函数适合直接输入输出测试，速度快、失败定位清晰。

### 20.4.2 组件测试

组件测试关注用户可见行为：

```tsx
it('提交成功后显示订单号', async () => {
  render(<Checkout />);

  await userEvent.click(screen.getByRole('button', { name: '提交订单' }));

  expect(await screen.findByText(/订单号/)).toBeInTheDocument();
});
```

测试不应过度依赖内部 State、实现细节或某个 Hook 的调用次数。组件如何实现可以改变，只要用户行为和结果保持正确。

### 20.4.3 端到端测试

端到端测试覆盖浏览器、路由、接口和关键业务流程：登录、搜索、提交、支付跳转和权限拦截。数量不必很多，但要覆盖产品最重要的用户路径和部署后最可能失败的边界。

## 20.5 Error Boundary

渲染阶段、生命周期和部分子树错误可以由 Error Boundary 捕获：

```tsx
class RouteErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error?: Error }
> {
  state = { hasError: false };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, { componentStack: info.componentStack });
  }

  render() {
    if (this.state.hasError) {
      return (
        <section role="alert">
          <h1>页面加载失败</h1>
          <button onClick={() => this.setState({ hasError: false })}>
            重试
          </button>
        </section>
      );
    }
    return this.props.children;
  }
}
```

Error Boundary 不会自动捕获事件处理函数、异步回调、服务端错误或 Boundary 自身的错误。网络请求必须在请求状态中处理，事件处理函数需要显式 Catch。Boundary 应按路由、页面或关键功能划分，避免一个小组件错误导致整站空白。

## 20.6 环境变量与配置

Vite 中暴露给浏览器的变量通常使用 `VITE_` 前缀：

```ts
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;
if (!apiBaseUrl) throw new Error('缺少 VITE_API_BASE_URL');
```

浏览器端变量不是秘密，API 密钥、数据库密码和服务端令牌不能放进前端环境变量。配置应在构建时或运行时明确注入，避免把开发环境地址硬编码到业务模块。

## 20.7 业务代码：统一 API 客户端

```ts
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      accept: 'application/json',
      ...options.headers,
    },
  });

  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent('auth:expired'));
  }

  if (!response.ok) {
    let message = `请求失败：${response.status}`;
    try {
      const body = await response.json() as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // 非 JSON 错误响应使用默认消息
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}
```

统一客户端可以集中处理超时、认证过期、请求 ID 和错误格式，但不要在底层自动吞掉所有错误。页面仍需要决定是否展示重试、旧数据或降级内容。

## 20.8 CI 与静态部署

GitHub Actions 可以在推送和 Pull Request 时运行检查：

```yaml
name: verify

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test
      - run: npm run build
```

静态站点部署还要确认：

- `base` 路径与部署仓库地址一致；
- 资源 URL 在子路径下仍然正确；
- SPA 路由刷新时服务器能回退到入口页面，或使用静态路由方案；
- 构建产物不包含本地密钥；
- 部署失败时保留上一个可用版本。

## 20.9 常见错误边界

### 错误一：只用 TypeScript 保护接口

TypeScript 在编译时工作，不能验证线上 JSON。外部数据要进行运行时校验，并把校验失败作为可展示错误处理。

### 错误二：Error Boundary 包住整个应用

一个小组件崩溃后整站显示错误页，用户会丢失仍然可用的导航和其他功能。根据业务重要性放置多个恢复边界。

### 错误三：测试只断言实现细节

测试 Hook 调用次数、组件内部 State 名称和 DOM 层级，会让重构成本很高。优先测试用户行为、可访问角色、可见文本和网络结果。

### 错误四：开发环境能访问，生产环境资源 404

常见原因包括 `base`、大小写路径、静态资源相对地址和子路径路由。每次发布都应验证构建后的真实 URL。

### 错误五：CI 只运行构建

构建通过只能说明打包完成。Lint、类型、单元测试和关键端到端流程都可能独立失败。

### 错误六：日志包含敏感信息

错误上报应过滤令牌、密码、完整表单和个人信息。日志需要有请求 ID 和版本号，方便定位具体发布版本。

## 20.10 练习题

1. 为一个页面设计目录和依赖方向，说明哪些模块可以被多个业务复用。
2. 为 API 响应增加运行时校验，区分接口错误、网络错误和数据格式错误。
3. 把一个大 Error Boundary 拆成路由级和功能级恢复边界。
4. 编写组件测试，覆盖加载、成功、失败和重试四种状态。
5. 检查 Vite 项目的生产构建路径，验证在子目录部署时资源和路由是否正确。
6. 设计一份 CI 检查顺序，说明哪些检查可以并行，哪些检查依赖构建结果。

## 本章小结

工程化把 React 代码接入可重复的类型、测试、构建、发布和观测流程。目录边界减少依赖耦合，类型和运行时校验保护数据边界，测试验证用户行为，Error Boundary 提供局部恢复，CI 保证每次变更都经过同样的检查。