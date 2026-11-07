---
title: 第 26 章 综合项目：SSE 流式 AI Agent
outline: deep
---

# 第 26 章 综合项目：SSE 流式 AI Agent

本章设计一个“支持 SSE 流式输出的 AI Agent 对话系统”。它不是把一个输入框连接到一个接口，而是把本书前面的 React 机制放进一个真实业务：路由、权限、Redux、流式协议、工具调用、用户确认、请求取消、错误恢复和性能优化。

> **工程实践**：下面的代码展示前端边界和核心模型。真正的模型调用、工具执行、权限校验和敏感数据访问必须在服务端完成。项目可以在 Vite + React 中拆分运行，但本章不会假设当前仓库已经安装 React Router 或 Redux Toolkit。

## 本章学习目标

学习完本章，你应该能够：

1. 设计流式 Agent 的前端目录和数据边界；
2. 定义 token、阶段、工具调用、确认、完成和错误事件；
3. 使用 Fetch Stream 解析 SSE 风格数据；
4. 按消息 ID 合并增量文本；
5. 用 AbortController 实现停止和卸载取消；
6. 处理请求竞态、重试和幂等；
7. 用 Redux Toolkit 管理会话级客户端状态；
8. 设计工具调用和用户确认的安全流程；
9. 对消息列表和高频 token 更新做性能优化；
10. 在面试中清楚介绍这个项目的架构取舍。

## 26.1 先建立直觉：一名会汇报进度的助手

普通聊天请求像“提交问题，等待完整答案”。Agent 更像一名可以执行任务的助手：

1. 接收用户问题；
2. 分析任务并持续汇报阶段；
3. 需要外部工具时提出调用请求；
4. 危险操作等待用户确认；
5. 继续输出工具结果和最终结论；
6. 出错时可以停止、重试或恢复。

因此，前端不能只保存一个 `answer: string`。它至少要区分：

- 当前会话和消息身份；
- 文本是否仍在流式接收；
- Agent 目前处于思考、调用工具、等待确认还是完成；
- 某个工具调用是否允许执行；
- 当前请求是否被用户停止；
- 哪个请求拥有写入页面的资格。

## 26.2 项目目录结构

```text
src/
  app/
    App.tsx                 # 应用根组件和路由入口
    providers.tsx           # Redux、主题、会话 Provider
  features/
    agent/
      agentApi.ts           # SSE/Fetch Stream 传输层
      agentProtocol.ts      # 事件类型和运行时解析
      agentSlice.ts         # Redux Toolkit 状态
      agentSelectors.ts     # 派生数据选择器
      agentReducer.test.ts  # Reducer 和消息合并测试
      components/
        Conversation.tsx
        MessageList.tsx
        ToolCallCard.tsx
        RunStatus.tsx
        Composer.tsx
      pages/
        AgentPage.tsx
  features/
    permissions/
      permissionSlice.ts
  shared/
    http.ts
    errors.ts
    ids.ts
  main.tsx
```

目录按业务域组织。传输协议不应该散落在消息列表组件中，权限判断不应该只存在按钮的条件渲染里。

## 26.3 核心数据模型

### 26.3.1 消息模型

```ts
export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';
export type MessageStatus =
  | 'pending'
  | 'streaming'
  | 'complete'
  | 'stopped'
  | 'error';

export type ToolCall = {
  callId: string;
  name: string;
  input: unknown;
  output?: unknown;
  status: 'requested' | 'waiting_confirmation' | 'running' | 'success' | 'error';
  requiresConfirmation: boolean;
  error?: string;
};

export type AgentMessage = {
  id: string;
  runId: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  toolCalls: ToolCall[];
  createdAt: number;
  error?: string;
};
```

消息 ID 和运行 ID 必须独立：一个运行可能产生多条消息，一个消息也可能接收多个事件。不要使用数组下标作为身份。

### 26.3.2 运行状态

```ts
export type RunPhase =
  | 'idle'
  | 'starting'
  | 'thinking'
  | 'streaming'
  | 'waiting_confirmation'
  | 'tool_running'
  | 'completed'
  | 'stopped'
  | 'failed';

export type AgentRun = {
  runId: string;
  conversationId: string;
  phase: RunPhase;
  currentMessageId?: string;
  currentToolCallId?: string;
  requestId: string;
  error?: string;
};
```

将运行状态和消息内容分开，可以让顶部状态条只订阅 `phase`，消息列表只订阅消息集合，减少高频 token 更新的影响范围。

## 26.4 SSE 事件协议

服务端可以返回 `Content-Type: text/event-stream`，每条事件使用空行分隔：

```text
event: run_started
data: {"runId":"r1"}

event: token
data: {"messageId":"m1","text":"你好"}

event: tool_call
data: {"callId":"c1","name":"search","input":{"q":"React"}}

event: confirmation_required
data: {"callId":"c1","reason":"需要访问外部数据"}

event: done
data: {"messageId":"m1"}

```

前端需要把网络字节流恢复为完整事件，再把事件解析成领域 Action。不要在组件中根据字符串前缀直接修改多个 State。

```ts
export type AgentEvent =
  | { type: 'run_started'; runId: string }
  | { type: 'phase'; runId: string; phase: RunPhase }
  | { type: 'token'; runId: string; messageId: string; text: string }
  | {
      type: 'tool_call';
      runId: string;
      messageId: string;
      call: ToolCall;
    }
  | { type: 'confirmation_required'; runId: string; callId: string; reason: string }
  | { type: 'tool_result'; runId: string; callId: string; output: unknown }
  | { type: 'done'; runId: string; messageId: string }
  | { type: 'error'; runId: string; messageId?: string; message: string };
```

## 26.5 SSE/Fetch Stream 解析代码

### 26.5.1 从字节到文本

```ts
export async function* readSseEvents(
  response: Response,
): AsyncGenerator<{ event?: string; data: string }> {
  if (!response.body) throw new Error('响应没有可读取的 body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? '';

      for (const block of blocks) {
        const event = parseSseBlock(block);
        if (event) yield event;
      }
    }

    buffer += decoder.decode();
    const last = parseSseBlock(buffer);
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}

function parseSseBlock(block: string) {
  if (!block.trim()) return null;

  let event: string | undefined;
  const data: string[] = [];

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }

  return { event, data: data.join('\n') };
}
```

关键点：

- `ReadableStream` 的 Chunk 不等于一条 SSE 消息；
- `TextDecoder` 必须以流模式复用，避免中文字符跨 Chunk 时损坏；
- 最后一次 `decoder.decode()` 用来刷新剩余字节；
- 未完成的 `buffer` 要保留到下一次读取；
- SSE 的 `data:` 可以出现多行，不能只保留最后一行。

### 26.5.2 将协议事件转成领域事件

```ts
export function decodeAgentEvent(
  raw: { event?: string; data: string },
): AgentEvent {
  const payload = JSON.parse(raw.data) as Record<string, unknown>;

  switch (raw.event) {
    case 'run_started':
      return { type: 'run_started', runId: String(payload.runId) };
    case 'token':
      return {
        type: 'token',
        runId: String(payload.runId),
        messageId: String(payload.messageId),
        text: String(payload.text ?? ''),
      };
    case 'done':
      return {
        type: 'done',
        runId: String(payload.runId),
        messageId: String(payload.messageId),
      };
    default:
      throw new Error(`不支持的 Agent 事件：${raw.event ?? 'unknown'}`);
  }
}
```

生产代码应使用运行时 Schema 校验 JSON。TypeScript 的类型断言不会验证服务端真实数据，无法单独保护协议边界。

## 26.6 Redux Toolkit 状态设计

以下示例展示 Slice 的核心形状。真实项目需要安装并配置 Redux Toolkit 后使用。

```ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

type AgentState = {
  activeRunId: string | null;
  runs: Record<string, AgentRun>;
  messages: Record<string, AgentMessage>;
  messageOrder: string[];
};

const initialState: AgentState = {
  activeRunId: null,
  runs: {},
  messages: {},
  messageOrder: [],
};

const agentSlice = createSlice({
  name: 'agent',
  initialState,
  reducers: {
    runStarted(state, action: PayloadAction<AgentRun>) {
      state.activeRunId = action.payload.runId;
      state.runs[action.payload.runId] = action.payload;
    },
    phaseChanged(
      state,
      action: PayloadAction<{ runId: string; phase: RunPhase }>,
    ) {
      const run = state.runs[action.payload.runId];
      if (run) run.phase = action.payload.phase;
    },
    messageAdded(state, action: PayloadAction<AgentMessage>) {
      state.messages[action.payload.id] = action.payload;
      state.messageOrder.push(action.payload.id);
    },
    tokenAppended(
      state,
      action: PayloadAction<{
        runId: string;
        messageId: string;
        text: string;
      }>,
    ) {
      const run = state.runs[action.payload.runId];
      const message = state.messages[action.payload.messageId];
      if (!run || !message || run.runId !== message.runId) return;
      if (message.status === 'stopped' || message.status === 'error') return;
      message.status = 'streaming';
      message.content += action.payload.text;
      run.currentMessageId = message.id;
    },
    runFailed(
      state,
      action: PayloadAction<{ runId: string; message: string }>,
    ) {
      const run = state.runs[action.payload.runId];
      if (!run) return;
      run.phase = 'failed';
      run.error = action.payload.message;
    },
  },
});

export const {
  runStarted,
  phaseChanged,
  messageAdded,
  tokenAppended,
  runFailed,
} = agentSlice.actions;
export default agentSlice.reducer;
```

RTK 的 Immer 允许在 Reducer 中写出 `message.content += text`，它会生成不可变结果。这个写法只在 Immer 管理的 Reducer 中成立，不能复制到普通 State 对象上。

### 26.6.1 Selector 避免整页更新

```ts
export const selectMessageList = (state: RootState) =>
  state.agent.messageOrder.map((id) => state.agent.messages[id]);

export const selectRunPhase = (runId: string) => (state: RootState) =>
  state.agent.runs[runId]?.phase ?? 'idle';
```

真实代码可使用记忆化 Selector，避免每次读取都创建新数组。消息列表还可以按窗口虚拟化，顶部状态条只读取当前运行阶段。

## 26.7 请求发送、取消和竞态处理

```ts
export async function runAgent(
  input: string,
  signal: AbortSignal,
  onEvent: (event: AgentEvent) => void,
) {
  const response = await fetch('/api/agent/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Agent 请求失败：${response.status}`);
  }

  for await (const raw of readSseEvents(response)) {
    onEvent(decodeAgentEvent(raw));
  }
}
```

组件或 Thunk 中保存当前控制器：

```tsx
function useAgentRun() {
  const controllerRef = useRef<AbortController | null>(null);
  const dispatch = useAppDispatch();

  async function start(input: string) {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const runId = crypto.randomUUID();

    dispatch(runStarted({
      runId,
      conversationId: 'current',
      requestId: runId,
      phase: 'starting',
    }));

    try {
      await runAgent(input, controller.signal, (event) => {
        if (event.runId !== runId) return;
        dispatchEventToStore(dispatch, event);
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      dispatch(runFailed({
        runId,
        message: error instanceof Error ? error.message : '运行失败',
      }));
    }
  }

  function stop() {
    controllerRef.current?.abort();
  }

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { start, stop };
}
```

这里同时使用 AbortSignal 和 `runId`：Abort 负责停止本地读取和网络请求，`runId` 负责在服务端或代理层仍可能发来迟到事件时拒绝旧数据。两者不能互相替代。

## 26.8 消息列表和工具调用卡片

```tsx
function MessageList({ ids }: { ids: string[] }) {
  const messages = useAppSelector(selectMessagesByIds(ids));

  return (
    <ol aria-live="polite">
      {messages.map((message) => (
        <li key={message.id}>
          <MessageContent message={message} />
          {message.toolCalls.map((call) => (
            <ToolCallCard key={call.callId} call={call} />
          ))}
        </li>
      ))}
    </ol>
  );
}

function ToolCallCard({ call }: { call: ToolCall }) {
  const dispatch = useAppDispatch();

  if (call.status === 'waiting_confirmation') {
    return (
      <div role="group" aria-label="工具调用确认">
        <p>助手请求调用：{call.name}</p>
        <button onClick={() => dispatch(confirmToolCall(call.callId))}>
          允许
        </button>
        <button onClick={() => dispatch(rejectToolCall(call.callId))}>
          拒绝
        </button>
      </div>
    );
  }

  return <pre>{JSON.stringify(call.output ?? call.input, null, 2)}</pre>;
}
```

`aria-live` 应谨慎使用。每个 token 都触发辅助技术播报可能造成体验问题，可以按消息或阶段更新可访问文本。工具结果应安全转义，不能把未经处理的模型输出当作 HTML 插入。

## 26.9 工具调用和用户确认

工具调用不应该直接由模型输出驱动浏览器执行。推荐的流程是：

```text
模型提出工具调用
  -> 服务端验证工具名称和输入
  -> 判断是否需要用户确认
  -> 前端展示确认卡片
  -> 用户确认
  -> 前端发送带确认 ID 的指令
  -> 服务端再次校验权限和过期时间
  -> 服务端执行工具
  -> 通过事件流返回结果
```

确认接口应使用一次性确认 ID、过期时间和幂等键：

```ts
type ConfirmToolRequest = {
  runId: string;
  callId: string;
  confirmationId: string;
  decision: 'approve' | 'reject';
};
```

前端的“允许”按钮只能表达用户意图，不能成为安全边界。服务端必须重新确认当前用户是否仍拥有权限，工具输入是否符合 Schema，资源是否属于当前租户。

## 26.10 React Router 和权限控制

```tsx
function AgentRoute() {
  const { loading, can } = usePermissions();

  if (loading) return <PageSkeleton />;
  if (!can('agent:use')) return <ForbiddenPage />;

  return <AgentPage />;
}
```

路由级权限控制页面入口，工具级权限控制具体操作，接口级权限保护真正资源。登录状态过期时要停止当前流、清理敏感消息缓存，并把用户带到登录页。

## 26.11 性能优化方案

### 26.11.1 合并 token 更新

如果每个 token 都派发一次 Redux Action，大消息可能产生大量 Render。可以在传输层先缓冲 16 至 50 毫秒，再一次性派发：

```ts
function createTokenBatcher(flush: (text: string) => void) {
  let buffer = '';
  let timer: number | null = null;

  return {
    push(text: string) {
      buffer += text;
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        const next = buffer;
        buffer = '';
        flush(next);
      }, 32);
    },
    flush() {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      if (buffer) flush(buffer);
      buffer = '';
    },
  };
}
```

延迟窗口需要通过真实设备测量。过度合并会让文字出现不自然的停顿，完全逐 token 更新又可能让 Markdown 解析和消息列表变重。

### 26.11.2 限制消息列表成本

- 使用稳定的 `key`；
- 只让当前消息订阅增量文本；
- 对历史消息使用 `memo`；
- 长对话使用虚拟列表或分页；
- Markdown 解析按批次执行；
- 代码高亮放到 Worker 或延后处理；
- 用 `startTransition` 更新不紧急的格式化预览。

### 26.11.3 网络和缓存

会话列表、工具目录和权限信息可以缓存；实时流不能简单地无限缓存。重连需要 Last-Event-ID 或服务端事件序号，避免重复追加。敏感对话不能无期限写入 LocalStorage。

## 26.12 测试策略

### 26.12.1 协议解析测试

测试以下输入：

- 一个事件被拆成多个 Chunk；
- UTF-8 中文字符跨 Chunk；
- 一个 Chunk 包含多条事件；
- `data:` 多行；
- 空行、结束标志和格式错误；
- 服务端发送未知事件。

### 26.12.2 Reducer 测试

```ts
it('只把当前运行的 token 合并到目标消息', () => {
  const state = reducer(initialStateWithRun('r1', 'm1'), tokenAppended({
    runId: 'r1',
    messageId: 'm1',
    text: 'React',
  }));

  expect(state.messages.m1.content).toBe('React');
});
```

还应测试旧 `runId`、已停止消息、工具确认、失败和重试。

### 26.12.3 组件和端到端测试

组件测试验证发送、流式展示、停止、确认、拒绝和重试。端到端测试验证登录、权限、路由刷新、网络断开和多标签页行为。网络可以使用 Mock Service Worker 模拟分块响应和延迟。

## 26.13 常见工程陷阱

### 陷阱一：把模型输出当作可信指令

模型输出是外部数据，必须经过协议解析、Schema 校验、权限判断和服务端执行边界。不能因为事件名是 `tool_call` 就直接调用浏览器 API。

### 陷阱二：只用 `cancelled` 标记，不取消请求

标志位只能阻止部分 State 更新，不能释放网络资源。优先使用 AbortController，并在服务端支持取消或幂等。

### 陷阱三：没有运行 ID

多个问题快速发送时，旧流可能把 token 追加到新消息。所有事件都要带 `runId` 和目标消息 ID。

### 陷阱四：重试创建重复消息

重试要区分“继续同一次运行”和“创建新的运行”。服务端使用幂等键，前端明确保留原消息还是创建重试消息。

### 陷阱五：在每个 token 上重新解析整个历史 Markdown

这会让长对话逐渐变慢。只更新当前消息，按帧或时间窗口合并，历史消息完成后缓存渲染结果。

### 陷阱六：把前端权限当成安全机制

路由守卫和按钮隐藏只改善体验。模型、工具和数据接口必须在服务端检查身份、权限、租户和资源归属。

### 陷阱七：SSE 断线后无条件重连

无条件重连可能重复执行工具、重复追加消息或形成请求风暴。重连要带事件序号、退避、最大次数和幂等策略。

## 26.14 面试时如何介绍这个项目

可以按下面的顺序介绍：

> 我设计了一个 React + TypeScript 的流式 AI Agent 页面。传输层使用 Fetch Stream 读取 SSE 风格事件，通过 TextDecoder 和缓冲区恢复消息边界；协议层把 token、阶段、工具调用、用户确认、完成和错误转换成领域事件。状态层用 Redux Toolkit 保存运行状态和消息实体，并用 runId、messageId 和 AbortController 处理并发竞态和取消。工具调用不会直接由模型驱动执行，前端展示确认卡片，服务端再次校验权限、参数和幂等键。性能上对 token 做时间窗口合并，对历史消息使用 Memo 或虚拟列表，并把 Markdown 解析和高亮从高频更新路径中移出。测试覆盖 SSE 分块解析、Reducer、取消、重试、权限和关键端到端流程。

面试官继续追问时，可以展开：

- 为什么 Chunk 不等于事件；
- 如何避免旧流覆盖新流；
- 用户确认和服务端权限的区别；
- 工具执行如何防重复；
- 长对话为什么需要窗口化；
- 如何验证流式更新没有阻塞输入。

## 26.15 本章小结

流式 Agent 页面是 React 运行模型、状态管理、异步控制、权限和性能的综合练习。可靠设计要把字节流、协议事件、领域消息和 React UI 分层，给每次运行和每条消息稳定身份，用 AbortController 和请求 ID 处理取消竞态，用服务端权限和幂等保护工具执行，再通过批量更新和窗口化控制长对话成本。

## 26.16 练习题与参考答案

### 练习题 1

为什么一个 Fetch Chunk 不能直接当成一条 SSE 事件？

**参考答案**：Chunk 是网络层当前收到的字节片段，可能只包含半条事件，也可能包含多条事件。需要先使用流式 TextDecoder 恢复文本，再按空行恢复事件边界。

### 练习题 2

设计防止旧 Agent 运行覆盖新运行的方案。

**参考答案**：每次运行生成唯一 `runId`，每条事件携带 `runId` 和目标 `messageId`；前端只接受当前运行的事件，AbortController 取消旧流，服务端用幂等键和事件序号避免重复执行。

### 练习题 3

为什么用户确认按钮不能直接调用工具？

**参考答案**：浏览器端代码可被修改，用户也可以绕过页面直接调用接口。确认请求只能表达意图，服务端必须再次检查身份、权限、工具名称、参数、资源归属和确认是否过期。

### 练习题 4

如何让一万条消息的流式页面保持可用？

**参考答案**：历史消息分页或虚拟化，只让当前消息订阅增量文本，按时间窗口合并 token，缓存已完成 Markdown，延后代码高亮，必要时把解析放到 Worker，并用 Performance 面板验证长任务。

### 练习题 5

服务端断线后如何安全重连？

**参考答案**：使用事件序号或 Last-Event-ID 恢复，按指数退避限制重试次数，服务端和工具操作使用幂等键，客户端根据已确认的事件去重，不能简单从头执行整个 Agent。
