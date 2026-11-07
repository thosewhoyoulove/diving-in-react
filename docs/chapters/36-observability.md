---
title: 第 36 章 React 可观测性、错误监控与线上性能治理
outline: deep
---

# 第 36 章 React 可观测性、错误监控与线上性能治理

开发环境里看见一次日志，不等于线上问题可以定位。可观测性要把用户操作、页面版本、路由、请求、React Render、浏览器性能和错误关联起来，同时保护用户隐私。

React 应用的线上治理通常包含三类信号：

- 日志：发生了什么；
- 指标：发生了多少、多久一次；
- Trace 或关联 ID：一次用户操作经过了哪些层。

## 本章学习目标

1. 设计前端错误、日志和性能事件；
2. 使用 Error Boundary 保护局部页面；
3. 关联用户操作、请求 ID 和版本号；
4. 采集 Web Vitals 和 React Profiler 数据；
5. 处理采样、脱敏和隐私边界；
6. 建立性能预算和线上回归流程。

## 36.1 生活化直觉

线上排查像维修一座城市。错误日志告诉你哪栋楼出问题，指标告诉你停电范围，Trace 告诉你电从哪里断开。只收集一条异常文本，很难判断是单个用户、某个版本还是整个区域的问题。

## 36.2 Error Boundary

```tsx
class PageBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientError(error, {
      componentStack: info.componentStack,
      route: window.location.pathname,
    });
  }

  render() {
    if (this.state.error) {
      return (
        <section role="alert">
          <h1>页面暂时不可用</h1>
          <button onClick={() => this.setState({ error: null })}>
            重试
          </button>
        </section>
      );
    }
    return this.props.children;
  }
}
```

Boundary 捕获渲染、生命周期和子树错误，但不能自动捕获所有事件处理器、异步回调和服务端错误。请求失败应进入数据状态，事件处理函数应自己处理异常。

## 36.3 统一错误模型

```ts
type ClientError = {
  name: string;
  message: string;
  route: string;
  release: string;
  requestId?: string;
  componentStack?: string;
  timestamp: number;
};

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : '未知错误');
}
```

错误上报要包含版本号和请求 ID，避免只看到“保存失败”却不知道发生在哪个发布版本和接口请求中。

## 36.4 日志和脱敏

```ts
function safeLog(event: string, payload: Record<string, unknown> = {}) {
  const safe = { ...payload };
  delete safe.password;
  delete safe.accessToken;
  delete safe.refreshToken;

  navigator.sendBeacon('/api/client-events', JSON.stringify({
    event,
    payload: safe,
    release: import.meta.env.VITE_RELEASE,
    at: Date.now(),
  }));
}
```

不要把完整表单、身份证号、聊天原文和令牌直接送到日志系统。日志服务也需要访问控制、保留周期和删除机制。

## 36.5 性能指标

```ts
performance.mark('search-start');

requestAnimationFrame(() => {
  performance.mark('search-feedback');
  performance.measure(
    'search-feedback-time',
    'search-start',
    'search-feedback',
  );
});
```

常见 Web Vitals 包括 LCP、INP 和 CLS。应用还可以记录业务指标：搜索反馈时间、流式首 Token 时间、工具确认等待时间和页面错误恢复成功率。

不要只收集平均值。P75、P90 或按设备和网络分组的数据更能反映用户体验。

## 36.6 React Profiler 与线上采样

```tsx
<Profiler
  id="conversation"
  onRender={(id, phase, actualDuration, baseDuration, startTime, commitTime) => {
    if (actualDuration < 50) return;
    safeLog('react-render-slow', {
      id,
      phase,
      actualDuration,
      baseDuration,
      startTime,
      commitTime,
    });
  }}
>
  <Conversation />
</Profiler>
```

线上不应无条件记录所有 Render。可以按比例采样，只记录超过阈值的异常 Commit，并关联版本、路线和设备类型。

## 36.7 源码视角：错误和性能信号的位置

```text
事件 / Render / Commit / 网络
  -> 应用层边界捕获
  -> 规范化错误或性能事件
  -> 加入 release、route、requestId
  -> 采样、脱敏、发送
  -> 后端聚合和告警
```

React DevTools 适合开发调查，线上系统要通过稳定的业务事件和浏览器 Performance API 采集信息。内部 Fiber 字段不应直接成为线上协议，因为版本变化会破坏数据含义。

## 36.8 业务场景：流式 Agent 的观测

一次 Agent 运行可以关联：

```ts
type RunTelemetry = {
  runId: string;
  conversationId: string;
  release: string;
  firstTokenMs?: number;
  totalDurationMs?: number;
  tokenCount?: number;
  toolCalls: number;
  stoppedByUser: boolean;
  errorCode?: string;
};
```

可以回答：

- 首 Token 是网络慢还是服务端排队慢；
- 哪个工具调用最常失败；
- 用户停止是因为等待太久还是内容不符合预期；
- 长消息是否造成 Render 长任务；
- 哪个发布版本错误率上升。

不要记录完整私密对话来换取可观测性。使用消息长度、哈希、分类标签和脱敏后的错误信息。

## 36.9 常见错误和错误边界

### 错误一：只上报 message，不上报上下文

没有版本、路由、请求 ID 和设备信息，错误很难复现。

### 错误二：日志包含敏感信息

在日志发送前做字段级脱敏，不能只依赖后端人工删除。

### 错误三：错误边界覆盖整个应用

局部页面错误不应让导航和其他页面全部不可用。按路由和关键功能分层设置 Boundary。

### 错误四：只看平均性能

平均值会掩盖低端设备和慢网络。按分位数和用户群体分析。

### 错误五：性能数据没有采样

全部采集会带来网络、存储和隐私成本。为慢事件和错误设置采样规则。

### 错误六：告警没有行动边界

告警应说明阈值、负责人、最近发布和回滚方式。只收集数据不形成响应流程，不能称为治理。

## 36.10 性能预算

可以为页面定义预算：

- 首屏 JavaScript 体积；
- 首屏 LCP；
- 输入到反馈的 INP；
- 单次 React Commit 时间；
- 长任务数量和最长时长；
- 流式消息更新频率；
- 错误率和恢复成功率。

预算不是绝对数字，而是发布前后比较和回归检测的约束。预算超出时要有解释、优化计划或明确的业务权衡。

## 36.11 发布与回滚

线上治理需要把版本号注入前端：

```ts
export const release = import.meta.env.VITE_RELEASE ?? 'local';
```

每个错误和性能事件带 release，发布后观察一段时间：

1. 构建和 Smoke Test 通过；
2. 观察错误率和核心性能；
3. 对比上一个版本；
4. 发现回归时停止扩散或回滚；
5. 记录根因和修复验证。

静态站点也需要保留可回退的构建产物，不能只覆盖当前文件而丢失上一版本。

## 36.12 性能和架构考虑

- 监控 SDK 延迟加载，不能阻塞首屏；
- 上报使用 `sendBeacon` 或低优先级请求；
- 错误对象统一序列化，避免循环引用；
- 事件 Schema 版本化；
- 采样和脱敏在客户端、服务端都做；
- 用自动化性能测试守住关键页面预算。

## 36.13 面试重点：标准回答

> React 线上可观测性需要把错误、日志、指标和关联 ID 连接起来。Error Boundary 负责局部渲染恢复，请求和事件错误分别在各自边界处理；性能用 Web Vitals、Performance API、React Profiler 和业务时延共同衡量。所有事件要带 release、route 和 requestId，并做采样和脱敏。治理的终点不是收集数据，而是能定位、告警、回滚和验证。

## 36.14 面试官追问

1. Error Boundary 能捕获哪些错误，不能捕获哪些？
2. 为什么只看平均响应时间不够？
3. 如何在不记录隐私文本的情况下定位 AI 对话问题？
4. React Profiler 是否应该全量在线上开启？
5. 性能预算如何融入 CI？

## 36.15 练习题与参考答案

### 练习题 1

为一个搜索页设计错误和性能事件。

**参考答案**：错误事件包含 release、route、requestId、错误码和脱敏参数；性能事件包含输入到结果展示时间、请求时长、Render 时长和设备网络标签，并按分位数聚合。

### 练习题 2

设计 Agent 首 Token 延迟的采集方案。

**参考答案**：记录用户提交时间、请求发送时间、响应建立时间和第一条 token 到达时间，计算各阶段耗时；只记录 runId、消息长度和版本，不保存完整私密内容。

## 36.16 本章小结

可观测性把 React 应用从“本地能运行”带到“线上可治理”。错误边界、统一错误模型、版本和请求关联、Web Vitals、React Profiler、采样和脱敏共同构成证据链。只有把指标接入告警、发布比较和回滚流程，性能优化才会成为持续工程能力。