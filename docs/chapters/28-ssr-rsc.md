---
title: 第 28 章 SSR、Streaming SSR、Hydration 与 Server Components
outline: deep
---

# 第 28 章 SSR、Streaming SSR、Hydration 与 Server Components

客户端渲染、服务端渲染和 Server Components 都在讨论“代码和数据在哪里完成”。它们不是互相替代的同义词：

- 客户端渲染由浏览器执行组件并生成 DOM；
- SSR 由服务器先生成 HTML，浏览器随后 Hydrate；
- Streaming SSR 分段发送 HTML，让用户更早看到页面；
- Server Components 在服务器执行，并把可序列化结果交给客户端组件组合。

理解这些边界，才能解释首屏速度、交互可用时间、Hydration 错误和服务端数据访问。

## 本章学习目标

1. 区分 CSR、SSR、Streaming SSR 和 Server Components；
2. 解释 `renderToPipeableStream` 的基本流程；
3. 理解 Hydration 为什么要求服务端和客户端输出一致；
4. 识别客户端组件与服务端组件的边界；
5. 处理浏览器 API、随机数、时间和异步数据造成的不一致；
6. 评估 SSR 的缓存、性能和安全成本。

## 28.1 生活化直觉

CSR 像到餐厅后自己拿材料做饭；SSR 像餐厅先把菜做好送到桌边，用户可以更早看到结果，但要等服务员接好后续交互；Hydration 就是把静态菜单和真实操作台连接起来。

Streaming SSR 像分批上菜，先上已经完成的部分，慢菜完成后再送上。Server Components 则像厨师在后厨处理不需要交给顾客的原材料，浏览器只收到需要展示和交互的结果。

## 28.2 CSR 与 SSR 最小模型

客户端渲染：

```tsx
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
```

服务端渲染：

```tsx
import { renderToString } from 'react-dom/server';

const html = renderToString(<App />);
response.end(`<!doctype html><div id="root">${html}</div>`);
```

客户端接管时使用 `hydrateRoot`：

```tsx
import { hydrateRoot } from 'react-dom/client';

hydrateRoot(document.getElementById('root')!, <App />);
```

`hydrateRoot` 假设容器中的 HTML 是同一棵 React 树在服务端生成的结果。它不是重新把所有 DOM 从零创建一遍，而是尝试把事件和内部身份连接到已有 DOM。

## 28.3 Hydration 一致性

下面的代码可能产生不一致：

```tsx
function Clock() {
  return <time>{new Date().toLocaleTimeString()}</time>;
}
```

服务端和客户端执行时间不同，文本结果可能不同。随机数、浏览器宽度、`window.localStorage` 和用户时区也有同样问题。

可以先渲染稳定占位，再在客户端更新：

```tsx
function ClientClock() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    setTime(new Date().toLocaleTimeString());
  }, []);

  return <time>{time ?? '加载时间…'}</time>;
}
```

### 逐行解释

- 初始服务端和客户端都显示稳定文本；
- Hydration 可以匹配同样的 DOM；
- 客户端 Effect 执行后再更新浏览器时间；
- 这个方案牺牲了首屏真实时间，换来一致性。

## 28.4 Streaming SSR

React 18 的服务端 API 支持 Suspense 流式渲染。Node 环境可以使用 `renderToPipeableStream`：

```tsx
import { renderToPipeableStream } from 'react-dom/server';

export function render(request: Request, response: ServerResponse) {
  let didError = false;

  const stream = renderToPipeableStream(<App />, {
    onShellReady() {
      response.statusCode = didError ? 500 : 200;
      response.setHeader('content-type', 'text/html');
      stream.pipe(response);
    },
    onError(error) {
      didError = true;
      console.error(error);
    },
  });

  request.signal.addEventListener('abort', () => stream.abort());
}
```

`onShellReady` 表示外层 Shell 已经可以发送，内部 Suspense 内容可以随后到达。服务端必须设置超时和请求取消，避免客户端断开后仍然继续消耗资源。

## 28.5 Suspense 与服务端边界

```tsx
function ProductPage() {
  return (
    <main>
      <Header />
      <Suspense fallback={<ProductSkeleton />}>
        <ProductDetails />
      </Suspense>
    </main>
  );
}
```

Suspense 边界决定了哪些内容可以先展示，哪些内容需要等待。边界太大，首屏等待时间长；边界太碎，页面可能出现大量跳动和请求竞争。

## 28.6 Server Components 的边界

Server Component 只在服务端执行，适合读取服务端数据、访问服务器资源和减少发送到浏览器的 JavaScript。需要状态、事件或浏览器 API 的组件属于 Client Component。

```tsx
// Server Component：概念示例
export async function ProductList() {
  const products = await getProductsFromDatabase();
  return products.map((product) => (
    <ProductRow key={product.id} product={product} />
  ));
}
```

```tsx
'use client';

export function ProductRow({ product }: { product: Product }) {
  const [selected, setSelected] = useState(false);
  return <button onClick={() => setSelected(true)}>{product.name}</button>;
}
```

不同框架对 Server Components 的文件约定、序列化协议和缓存策略不同。不能把框架实现细节直接当成 React DOM 的通用 API。

### 容易混淆

SSR 生成 HTML，Server Components 传递组件结果和数据边界；一个应用可以同时使用 SSR 和 Server Components，也可以只使用 SSR 而不使用 Server Components。

## 28.7 源码视角：服务端和客户端的职责

```text
服务器
  -> 执行服务端组件或普通组件
  -> 生成 HTML / RSC Payload
  -> 发送响应

浏览器
  -> 解析 HTML
  -> 下载客户端 JavaScript
  -> hydrateRoot 或框架运行时接管
  -> 绑定事件、恢复交互
```

React 的 Render 逻辑在不同环境有不同 Host Config。服务端没有真实 DOM，客户端则需要把结果连接到浏览器节点。源码阅读时要先确定你分析的是 `react-dom/server` 还是 `react-dom/client`。

## 28.8 业务场景：商品详情页

可以把页面拆成：

- 服务端生成标题、价格和 SEO 内容；
- Suspense 包住库存和推荐商品；
- 客户端组件负责数量选择和加入购物车；
- 购物车状态通过 Context 或外部 Store 共享；
- 结算请求由服务端重新校验价格和库存。

```tsx
function ProductPage({ id }: { id: string }) {
  return (
    <>
      <ProductSummary id={id} />
      <Suspense fallback={<InventorySkeleton />}>
        <Inventory id={id} />
      </Suspense>
      <AddToCartButton id={id} />
    </>
  );
}
```

不要把服务端渲染的价格当成最终结算金额。SSR 提升首屏展示，服务端仍需在提交时重新计算业务事实。

## 28.9 常见错误和错误边界

### 错误一：在服务端渲染阶段读取 `window`

服务端没有浏览器对象。把浏览器依赖放到客户端组件、Effect 或请求处理的客户端分支中。

### 错误二：用 `suppressHydrationWarning` 掩盖真实不一致

它只能用于非常明确的、可接受的文本差异。大量使用会让真实数据错误和结构错误失去提示。

### 错误三：把敏感数据直接序列化到 HTML

HTML 和 RSC Payload 都可能被浏览器看到。只发送必要字段，令牌和数据库密码必须留在服务端。

### 错误四：忽略流式响应的缓存行为

代理、CDN 和压缩层可能缓存或缓冲流式响应。要明确 Cache-Control、Vary、连接超时和断开处理。

### 错误五：Hydration 前修改 DOM

第三方脚本或客户端初始化直接修改服务端节点，可能造成 Hydration mismatch。将命令式库放入明确的 Effect 边界。

## 28.10 性能和架构考虑

- SSR 不一定降低总成本，服务器 Render 和客户端 Hydration 也消耗资源；
- 减少发送给浏览器的客户端 JavaScript，通常比单纯追求 HTML 更重要；
- Suspense 边界应围绕用户可感知内容设计；
- 对稳定页面使用 CDN 和数据缓存，对个性化内容避免错误共享；
- 监控 TTFB、FCP、LCP、Hydration 时间和客户端错误。

## 28.11 面试重点：标准回答

> SSR 是服务端先生成 HTML，客户端通过 hydrateRoot 接管已有结构；Streaming SSR 可以在部分内容准备好后提前发送，并用 Suspense 处理后续内容。Hydration 要求服务端和客户端初始输出一致，时间、随机数和浏览器 API 容易造成不一致。Server Components 则把部分组件和数据访问留在服务端，客户端组件负责交互；它与 SSR 可以组合，但概念和传输协议不同。

## 28.12 面试官追问

1. Hydration mismatch 常见原因有哪些？
2. 为什么 SSR 页面仍然需要下载 JavaScript？
3. Streaming SSR 和客户端 Loading 有什么区别？
4. Server Component 可以直接使用 `useState` 吗？为什么？
5. 如何缓存个性化 SSR 页面？

## 28.13 练习题与参考答案

### 练习题 1

找出三个可能造成 Hydration mismatch 的代码。

**参考答案**：Render 中直接读取当前时间、随机数和 `window.innerWidth`；还包括服务端和客户端使用不同语言环境格式化数字，以及第三方脚本在 Hydration 前修改 DOM。

### 练习题 2

设计商品页的 Suspense 边界。

**参考答案**：标题和基础价格作为 Shell 先展示；库存、推荐和评论分别使用边界，避免一个慢请求阻塞整页，也避免拆成过多碎片造成视觉跳动。

### 练习题 3

为什么 Server Component 中的数据库查询仍不能替代服务端权限检查？

**参考答案**：组件所在的服务端执行环境不自动等于授权环境。查询仍要根据当前用户、租户和资源归属过滤，接口和数据库层都不能把组件边界当作安全边界。

## 28.14 本章小结

CSR、SSR、Streaming SSR 和 Server Components 解决的是不同的执行位置和交互恢复问题。Hydration 要求初始结果一致，Streaming 需要明确 Suspense 和连接边界，Server Components 需要清晰划分服务端数据与客户端交互。选择渲染方式时要同时考虑首屏、JavaScript、缓存、隐私和运行成本。