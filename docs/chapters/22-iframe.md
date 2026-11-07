---
title: 第 22 章 React 微前端与 iframe 通信
outline: deep
---

# 第 22 章 React 微前端与 iframe 通信

微前端把一个大型前端拆成多个可以独立开发、构建和发布的应用。`iframe` 是边界最清晰的实现方式之一：子应用拥有独立的 Window、Document、脚本环境和 CSS 作用域，主应用通过浏览器消息协议与它通信。

隔离能力越强，通信成本也越高。一个可靠的 iframe 集成不能只写一行 `postMessage`，还要设计：

- 来源校验和消息身份校验；
- 初始化握手和版本协商；
- 请求与响应的关联 ID；
- 超时、重试和取消；
- 子应用加载失败和重新加载；
- 登录、主题、语言和路由的边界；
- 敏感数据与权限的服务端校验。

## 本章学习目标

学习完本章，你应该能够：

1. 解释 iframe 的浏览器隔离边界；
2. 正确使用 `postMessage` 和 `message` 事件；
3. 设计带版本、请求 ID 和错误字段的通信协议；
4. 防止任意来源消息和任意目标窗口造成的安全问题；
5. 实现初始化握手、请求超时、重试和销毁；
6. 判断 iframe、Module Federation 和路由级微前端的适用场景。

## 22.1 源码模型：两个 Window 之间的消息

### 22.1.1 iframe 创建独立浏览上下文

```text
主应用 Window
  ├── iframe 元素
  └── iframe.contentWindow
        ├── 独立 Document
        ├── 独立 React Root
        ├── 独立 CSS 和 JS 全局对象
        └── message 事件监听器
```

同源 iframe 可以通过 DOM API 访问对方文档，但跨源 iframe 受到同源策略限制。跨源场景下，双方通常通过结构化克隆传递数据：

```ts
otherWindow.postMessage(message, targetOrigin);
```

发送者指定目标窗口，接收者通过 `event.origin` 和 `event.source` 验证消息来源。

### 22.1.2 `postMessage` 不提供业务协议

浏览器只负责投递消息，不知道消息含义、版本、请求是否完成，也不保证你的业务操作幂等。业务层需要自行定义：

```ts
type HostToChildMessage =
  | {
      type: 'host:hello';
      protocol: 1;
      requestId: string;
      payload: { theme: 'light' | 'dark'; locale: string };
    }
  | {
      type: 'host:navigate';
      protocol: 1;
      requestId: string;
      payload: { pathname: string };
    }
  | {
      type: 'host:request';
      protocol: 1;
      requestId: string;
      payload: { method: string; input: unknown };
    };

type ChildToHostMessage =
  | {
      type: 'child:ready';
      protocol: 1;
      requestId: string;
    }
  | {
      type: 'child:response';
      protocol: 1;
      requestId: string;
      ok: true;
      payload: unknown;
    }
  | {
      type: 'child:response';
      protocol: 1;
      requestId: string;
      ok: false;
      error: { code: string; message: string };
    };
```

`requestId` 让响应可以对应到原始请求，`protocol` 让双方在升级时拒绝不兼容的消息。实际项目还应对 `payload` 做运行时校验，不能只依赖 TypeScript。

### 22.1.3 安全校验的三个条件

```ts
function isMessageFromChild(
  event: MessageEvent,
  childWindow: Window,
  allowedOrigin: string,
) {
  return event.origin === allowedOrigin && event.source === childWindow;
}
```

只检查 `origin` 不够，因为同一来源可能有多个窗口；只检查 `source` 也不够，因为来源可能是恶意页面。消息类型、协议版本和字段结构仍要继续校验。

## 22.2 React 宿主组件

### 22.2.1 保存 iframe Window 和加载状态

```tsx
function EmbeddedApp({ src }: { src: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  return (
    <section aria-label="嵌入应用">
      {status === 'loading' && <p>正在加载子应用…</p>}
      {status === 'error' && <p role="alert">子应用加载失败，请重试。</p>}
      <iframe
        ref={iframeRef}
        title="订单应用"
        src={src}
        sandbox="allow-scripts allow-forms allow-same-origin"
        onLoad={() => setStatus('ready')}
        onError={() => setStatus('error')}
      />
    </section>
  );
}
```

`sandbox` 应按最小权限配置。`allow-same-origin`、表单、弹窗和下载能力都可能扩大风险，是否需要要根据子应用功能决定。跨源子应用还需要在服务端配置合适的 `Content-Security-Policy` 和 `frame-ancestors`。

### 22.2.2 实现带超时的请求客户端

```tsx
type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: number;
};

function createChildClient(
  iframe: HTMLIFrameElement,
  targetOrigin: string,
) {
  const pending = new Map<string, PendingRequest>();

  function send<T>(payload: HostToChildMessage['payload'], timeout = 5000) {
    const requestId = crypto.randomUUID();

    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('子应用响应超时'));
      }, timeout);

      pending.set(requestId, { resolve, reject, timer });
      iframe.contentWindow?.postMessage({
        type: 'host:request',
        protocol: 1,
        requestId,
        payload,
      }, targetOrigin);
    });
  }

  function handleMessage(event: MessageEvent) {
    if (
      event.origin !== targetOrigin ||
      event.source !== iframe.contentWindow
    ) return;

    const message = event.data as ChildToHostMessage;
    if (message.type !== 'child:response') return;

    const request = pending.get(message.requestId);
    if (!request) return;
    pending.delete(message.requestId);
    window.clearTimeout(request.timer);

    if (message.ok) request.resolve(message.payload);
    else request.reject(new Error(message.error.message));
  }

  function dispose() {
    for (const request of pending.values()) {
      window.clearTimeout(request.timer);
      request.reject(new Error('宿主已销毁通信客户端'));
    }
    pending.clear();
  }

  return { send, handleMessage, dispose };
}
```

生产代码应把 `event.data` 先交给 Schema 校验器，确认类型、协议和字段后再访问。请求超时只代表本地等待结束，不代表子应用一定停止了服务端操作，因此需要设计取消消息或幂等请求。

## 22.3 初始化握手

双方不要假设 iframe 加载完成就代表 React 子应用已经准备好。子应用应该在自己的 React Root 挂载后发送 `child:ready`：

```tsx
function ChildApp() {
  useEffect(() => {
    window.parent.postMessage({
      type: 'child:ready',
      protocol: 1,
      requestId: crypto.randomUUID(),
    }, 'https://host.example.com');
  }, []);

  return <App />;
}
```

宿主收到 `child:ready` 后发送初始化数据：

```tsx
useEffect(() => {
  const iframe = iframeRef.current;
  if (!iframe) return;

  function onMessage(event: MessageEvent) {
    if (
      event.origin !== CHILD_ORIGIN ||
      event.source !== iframe.contentWindow
    ) return;

    if (event.data?.type === 'child:ready') {
      iframe.contentWindow?.postMessage({
        type: 'host:hello',
        protocol: 1,
        requestId: crypto.randomUUID(),
        payload: { theme: 'light', locale: 'zh-CN' },
      }, CHILD_ORIGIN);
    }
  }

  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}, []);
```

握手应允许重复执行，因为 iframe 可能重新加载、浏览器恢复页面或网络连接暂时中断。初始化消息应幂等，子应用收到相同配置时不应重复创建连接。

## 22.4 子应用侧的 React Hook

```tsx
function useHostMessage() {
  const [hostConfig, setHostConfig] = useState<HostConfig | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== HOST_ORIGIN || event.source !== window.parent) return;
      const message = event.data as HostToChildMessage;

      if (message.type === 'host:hello' && message.protocol === 1) {
        setHostConfig(message.payload as HostConfig);
        window.parent.postMessage({
          type: 'child:response',
          protocol: 1,
          requestId: message.requestId,
          ok: true,
          payload: { accepted: true },
        }, HOST_ORIGIN);
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return hostConfig;
}
```

如果子应用也支持独立运行，需要把“有宿主”和“独立打开”设计成两种明确模式。不要让业务组件到处判断 `window.parent !== window`，可以在入口层创建一个统一的 Host Adapter。

## 22.5 常见错误边界

### 错误一：使用 `'*'` 作为目标来源

```ts
iframe.contentWindow?.postMessage(data, '*');
```

这会让消息可能被任意来源接收。生产代码应使用精确的目标 Origin；如果来源确实动态变化，应在可信握手完成后保存并校验来源。

### 错误二：只校验消息类型，不校验来源

攻击者可以在页面中派发同名消息。必须同时校验 `event.origin`、`event.source`、协议版本和数据结构。

### 错误三：把 Token 放进所有消息

iframe 消息可能被错误的监听器记录或转发。优先使用受保护的会话 Cookie、短期令牌和最小权限数据，不要把长期密钥直接注入子应用。

### 错误四：卸载 iframe 时留下监听器和定时器

每个 `message` 监听器、请求超时和重试任务都要在 React Effect 清理函数中释放，否则重新进入页面后会出现重复响应和内存泄漏。

### 错误五：没有定义幂等请求

网络重试可能让“创建订单”“扣款”执行两次。涉及写操作时要使用幂等键，并让服务端根据幂等键返回相同结果。

### 错误六：把跨域问题误判成 React 问题

Origin、CORS、CSP、`frame-ancestors` 和 Cookie 策略属于浏览器与服务器边界。先检查 Network、Console 和响应头，再定位 React 组件逻辑。

## 22.6 选择 iframe 还是其他微前端方案

| 方案 | 隔离程度 | 集成成本 | 适合场景 |
| --- | --- | --- | --- |
| iframe | 强 | 中 | 团队独立、技术栈不同、系统边界清晰 |
| Module Federation | 中 | 高 | 需要共享运行时和组件、页面级组合 |
| 路由级独立部署 | 中 | 中 | 多团队维护不同业务域 |
| 单体应用模块化 | 弱 | 低 | 团队统一、需要共享状态和交互 |

选择时还要评估 SEO、无障碍、首屏速度、跨应用导航、监控、登录和发布回滚，而不是只比较加载方式。

## 22.7 练习题

1. 设计一个带 `protocol`、`requestId`、`type` 和错误结构的双向消息协议。
2. 为宿主客户端增加 AbortSignal，取消超时请求和 iframe 卸载时的待处理请求。
3. 模拟恶意来源和错误 `event.source`，验证消息会被拒绝。
4. 设计一个幂等的“创建报告”请求，说明重试时如何避免重复创建。
5. 比较 iframe 和 Module Federation 在共享登录、CSS 隔离、部署独立性和性能方面的取舍。
6. 为子应用设计独立运行模式，保证它没有宿主时仍能完成本地开发和基础测试。

## 本章小结

iframe 微前端的核心是隔离边界和明确协议。浏览器负责消息投递，业务代码负责来源校验、版本、请求关联、超时、取消、重试和权限。只要把通信当作一个需要演进和测试的 API，而不是临时事件监听，跨应用集成才会保持可维护。