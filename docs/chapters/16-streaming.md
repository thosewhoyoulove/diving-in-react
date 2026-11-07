---
title: 第 16 章 React 中的异步与流式数据
outline: deep
---

# 第 16 章 React 中的异步与流式数据

传统请求通常等到完整 JSON 返回后一次性更新页面；流式请求则会持续收到数据片段，界面可以边接收边展示。聊天消息、日志、模型输出和实时进度都适合流式交互。

流式数据会把几个问题同时带到前台：

- 网络响应如何逐块读取；
- UTF-8 多字节字符可能跨块；
- 消息边界可能被拆开；
- 新请求如何取消旧请求；
- 组件卸载后如何停止更新；
- 部分成功、重试和错误如何展示。

React 负责把接收到的状态提交到 UI，但网络协议、缓存和重试仍然属于应用层设计。

## 本章学习目标

学习完本章，你应该能够：

1. 区分普通 Fetch、SSE 和 Fetch Stream；
2. 使用 `ReadableStream` 和 `TextDecoder` 读取文本片段；
3. 处理跨 Chunk 的消息边界；
4. 用 `AbortController` 取消请求；
5. 设计流式消息的状态模型；
6. 处理竞态、断线、超时和服务端错误。

## 16.1 源码模型：异步数据怎样进入 React

### 16.1.1 请求响应不在 Render 阶段完成

```text
用户事件 / Effect
  -> 发起 fetch
  -> 浏览器网络层接收数据
  -> Promise 或 ReadableStream 回调
  -> setState / 外部 Store
  -> 创建 Update
  -> React 调度 Render
  -> Commit 新文本
```

网络回调发生在 React 之外。每个 `setState` 都可能触发更新，流速很高时需要考虑批量、节流或将临时数据放入外部缓冲区。

### 16.1.2 Stream Reader 的基本协议

```ts
const response = await fetch('/api/stream');
if (!response.body) throw new Error('浏览器不支持响应流');

const reader = response.body.getReader();
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  // value 是 Uint8Array，不保证对应完整消息
}
```

一次 `read()` 可能得到半个 JSON、多个事件，或一个 UTF-8 字符的部分字节。不能把每个 Chunk 直接 `JSON.parse`。

### 16.1.3 TextDecoder 需要保留流状态

```ts
const decoder = new TextDecoder();
let text = '';

text += decoder.decode(value, { stream: true });
text += decoder.decode();
```

`stream: true` 允许 Decoder 保留跨 Chunk 的不完整字符。流结束时再调用一次无参数的 `decode()` 刷新剩余字节。

## 16.2 读取 Fetch Stream

### 16.2.1 业务解析器

```ts
export async function* readTextStream(
  response: Response,
): AsyncGenerator<string> {
  if (!response.body) throw new Error('响应没有 body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }

    const rest = decoder.decode();
    if (rest) yield rest;
  } finally {
    reader.releaseLock();
  }
}
```

调用方可以在每个文本片段到达时合并：

```tsx
async function consumeAnswer(
  prompt: string,
  signal: AbortSignal,
  onText: (text: string) => void,
) {
  const response = await fetch('/api/answer', {
    method: 'POST',
    body: JSON.stringify({ prompt }),
    headers: { 'content-type': 'application/json' },
    signal,
  });

  if (!response.ok) throw new Error(`请求失败：${response.status}`);

  for await (const chunk of readTextStream(response)) {
    onText(chunk);
  }
}
```

### 16.2.2 React 组件中的取消和状态

```tsx
type AnswerState =
  | { status: 'idle'; text: '' }
  | { status: 'streaming'; text: string }
  | { status: 'done'; text: string }
  | { status: 'error'; text: string; message: string };

function AnswerPanel() {
  const [answer, setAnswer] = useState<AnswerState>({
    status: 'idle',
    text: '',
  });
  const controllerRef = useRef<AbortController | null>(null);

  async function ask(prompt: string) {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setAnswer({ status: 'streaming', text: '' });

    try {
      await consumeAnswer(prompt, controller.signal, (chunk) => {
        setAnswer((current) => ({
          status: 'streaming',
          text: current.text + chunk,
        }));
      });
      setAnswer((current) => ({ status: 'done', text: current.text }));
    } catch (error) {
      if (controller.signal.aborted) return;
      setAnswer({
        status: 'error',
        text: '',
        message: error instanceof Error ? error.message : '请求失败',
      });
    }
  }

  useEffect(() => () => controllerRef.current?.abort(), []);

  return (
    <section>
      <button onClick={() => void ask('解释 Fiber')}>开始</button>
      <button onClick={() => controllerRef.current?.abort()}>停止</button>
      <pre>{answer.text}</pre>
      {answer.status === 'error' && <p role="alert">{answer.message}</p>}
    </section>
  );
}
```

这个例子用函数式 State 更新保证连续片段不会因为闭包读取旧值而丢失。生产实现还要限制文本更新频率，避免每个极小 Chunk 都触发一次昂贵的整棵子树 Render。

## 16.3 处理 SSE

Server-Sent Events 使用 `text/event-stream` 文本协议。典型消息如下：

```text
event: token
id: 42
data: {"text":"React"}

```

空行表示一个事件结束。单条事件的字段可能跨多行，因此应先按行解析，再按空行组装。

```ts
type SseEvent = {
  event?: string;
  id?: string;
  data: string;
};

function parseSseBuffer(buffer: string) {
  const events: SseEvent[] = [];
  const blocks = buffer.split('\n\n');
  const rest = blocks.pop() ?? '';

  for (const block of blocks) {
    let event: string | undefined;
    let id: string | undefined;
    const data: string[] = [];

    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('id:')) id = line.slice(3).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }

    events.push({ event, id, data: data.join('\n') });
  }

  return { events, rest };
}
```

解析器必须把未完成的最后一段返回给下次读取。遇到 `data: [DONE]` 之类的结束协议时，应该将其转换成明确的完成状态，而不是把它当普通文本展示。

## 16.4 流式消息的领域模型

```ts
type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  status: 'pending' | 'streaming' | 'complete' | 'error';
  error?: string;
};

function appendToken(messages: Message[], id: string, token: string) {
  return messages.map((message) =>
    message.id === id
      ? { ...message, content: message.content + token, status: 'streaming' }
      : message,
  );
}
```

消息 ID 要由客户端或服务端明确生成，不能用数组下标作为稳定身份。流式响应到达顺序可能与用户操作顺序不同，更新必须按 ID 定位目标消息。

### 16.4.1 业务代码：聊天提交

```tsx
function ChatComposer() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');

  async function submit() {
    const content = input.trim();
    if (!content) return;

    const assistantId = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: 'user', content, status: 'complete' },
      { id: assistantId, role: 'assistant', content: '', status: 'pending' },
    ]);
    setInput('');

    try {
      await consumeAnswer(content, new AbortController().signal, (chunk) => {
        setMessages((current) => appendToken(current, assistantId, chunk));
      });
      setMessages((current) => current.map((message) =>
        message.id === assistantId
          ? { ...message, status: 'complete' }
          : message,
      ));
    } catch (error) {
      setMessages((current) => current.map((message) =>
        message.id === assistantId
          ? {
              ...message,
              status: 'error',
              error: error instanceof Error ? error.message : '生成失败',
            }
          : message,
      ));
    }
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <textarea value={input} onChange={(event) => setInput(event.target.value)} />
      <button type="submit">发送</button>
    </form>
  );
}
```

示例展示了消息合并，但它还缺少并发发送控制、停止当前回复、滚动定位和服务端重连。完整产品应把这些能力放进明确的控制器或状态机中。

## 16.5 常见错误边界

### 错误一：把 Chunk 当作消息

网络层的 Chunk 只代表当前收到的字节片段，不代表协议消息。必须通过换行、长度字段或协议解析器恢复边界。

### 错误二：忽略 UTF-8 跨 Chunk

直接对每个 `Uint8Array` 调用 `new TextDecoder().decode(value)`，可能破坏跨块的中文或 Emoji。复用 Decoder，并在结束时刷新。

### 错误三：只设置 `cancelled`，没有取消网络

```tsx
let cancelled = false;
return () => { cancelled = true; };
```

这个标志可以阻止旧响应写入 State，但请求仍在占用连接和服务端资源。优先使用 `AbortController`，必要时再加请求 ID 校验。

### 错误四：把 Abort 当作错误提示

用户主动停止请求通常不应显示“服务器错误”。在 Catch 中先检查 `signal.aborted`，再处理真正的失败。

### 错误五：流式更新造成输入卡顿

每个 Token 都执行一次复杂 Markdown 解析、代码高亮和大列表 Render，会阻塞主线程。可以按时间窗口合并片段，或把原始文本和格式化展示拆成不同更新路径。

### 错误六：服务端没有真正刷新数据

即使前端使用 Stream，代理层、压缩层或服务端缓冲也可能让数据批量到达。要检查响应头、代理配置、心跳和超时策略。

## 16.6 测试策略

流式解析器应使用固定字节片段测试：

- 一个事件完整落在单个 Chunk；
- 空行被拆到两个 Chunk；
- UTF-8 字符被拆开；
- 一个 Chunk 包含多个事件；
- 结束标记后还有无效数据。

组件测试需要验证：开始请求、片段合并、用户停止、组件卸载、旧请求失败和新请求成功的顺序。网络层可以用 Mock Service Worker 模拟延迟和分块响应。

## 16.7 练习题

1. 实现一个支持 `data:` 多行字段的 SSE 解析器，并写出跨 Chunk 测试。
2. 为 `AnswerPanel` 增加 200ms 批量刷新，比较每 Token 更新和批量更新的交互差异。
3. 实现“停止生成”按钮，确保停止后服务端响应不能继续修改消息。
4. 设计两个并发提问的消息模型，保证响应按消息 ID 合并。
5. 处理网络断开后的重连，并说明如何避免重复追加已经收到的事件。
6. 为流式 Markdown 设计安全渲染边界，说明为什么不能直接把服务端文本当 HTML 插入页面。

## 本章小结

流式 UI 的难点在于字节、协议消息、领域消息和 React State 之间的边界。先正确恢复文本和消息，再处理取消、竞态、节流和错误展示。React 只负责把状态变化呈现出来，网络协议和资源生命周期必须由业务代码明确管理。