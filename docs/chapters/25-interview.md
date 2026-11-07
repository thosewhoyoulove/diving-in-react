---
title: 第 25 章 React 高频面试题
outline: deep
---

# 第 25 章 React 高频面试题

高级前端面试中的 React 问题，通常不是要求你背出某个函数名，而是观察你能否把现象、机制、边界和工程取舍连起来。本章用“标准回答 + 追问 + 代码模型”的方式整理高频主题。

回答原理题时，可以遵循四步：

1. 先给出一句准确结论；
2. 解释它解决了什么问题；
3. 描述 React 18/19 中的大致实现；
4. 补充版本边界、工程实践和容易混淆的地方。

## 本章学习目标

学习完本章，你应该能够：

1. 用一条连续链路解释 Fiber 和更新过程；
2. 区分官方保证与源码实现细节；
3. 回答 Hooks、Effect、Memo、批量更新和 Transition；
4. 解释 Context、Redux 和服务端状态的边界；
5. 从用户体验和测量数据回答性能问题；
6. 设计一个流式 AI 对话页面并说明风险。

## 25.1 什么是 Fiber

### 标准回答

Fiber 是 React 内部表示组件和宿主节点的一种数据结构，也是 React 把渲染工作拆成可调度单元的基础。一个 Fiber 通常保存节点类型、Props、State、子节点、兄弟节点、父节点、更新优先级和副作用标记。

React 15 的 Stack Reconciler 依赖递归调用栈遍历组件树，复杂更新可能长时间占用主线程。Fiber 把树节点变成带 `child`、`sibling`、`return` 指针的工作单元，React 可以在 Render 阶段暂停、恢复或丢弃尚未提交的工作。

```ts
type Fiber = {
  tag: number;
  type: unknown;
  pendingProps: unknown;
  memoizedProps: unknown;
  memoizedState: unknown;
  child: Fiber | null;
  sibling: Fiber | null;
  return: Fiber | null;
  lanes: number;
  flags: number;
};
```

### 容易混淆

Fiber 不是 DOM，也不等于 JSX Element。Element 是一次 Render 产生的轻量描述，Fiber 是 React 为了跨 Render 保存身份、State 和调度信息建立的运行时节点。

### 追问

**Fiber 为什么使用 child、sibling、return，而不是只保存 children 数组？**

这种指针结构把树遍历转换成可保存的“下一个工作单元”：优先进入 child，没有 child 就寻找 sibling，再没有 sibling 就通过 return 回到父节点。React 可以在任意工作单元边界保存进度。

## 25.2 Fiber 为什么可以中断

### 标准回答

可中断主要发生在 Render 阶段。React 把组件树遍历拆成很多 Fiber 工作单元，通过并发工作循环逐个处理，并在浏览器需要恢复输入时让出主线程。未提交的 workInProgress 树只是计算结果，暂停或丢弃它不会把半成品 DOM 暴露给用户。

```text
workLoopConcurrent
  -> performUnitOfWork
  -> 检查 shouldYield
  -> 让出主线程或继续
```

Commit 阶段要保持宿主环境的一致性，通常会在一个提交过程中完成必要的 DOM 变化。可中断不意味着所有 React 工作都可以任意暂停。

### 追问

**Scheduler 和 Fiber 的区别是什么？**

Scheduler 决定什么时候安排任务、何时让出执行机会；Fiber 保存 React 树节点和具体渲染工作。Scheduler 像时间管理器，Fiber 像待处理的工作清单。

## 25.3 React 为什么需要 Key

### 标准回答

Key 是同一层级列表节点的稳定身份。Reconciliation 会使用 Key 判断旧节点和新节点是否代表同一个业务实体，从而决定复用、移动、插入还是删除。

```tsx
{todos.map((todo) => (
  <TodoRow key={todo.id} todo={todo} />
))}
```

Key 稳定时，输入框 State、DOM 状态和组件实例可以跟随同一条 Todo 数据。Key 缺失或不稳定时，React 可能复用错误节点或重置状态。

### 为什么不推荐 index 作为 Key

```tsx
items.map((item, index) => <Row key={index} item={item} />)
```

如果列表只追加且永不排序、删除，index 可能暂时可用。可编辑列表、拖拽排序和中间插入中，index 会随着位置变化而对应不同数据，输入状态可能错位。随机 Key 更糟，因为每次 Render 都会把节点当成新节点。

### 追问

**Key 只要全局唯一吗？**

不需要全局唯一，只需要在同一个父节点的同一层级内稳定且能区分兄弟节点。不同列表可以使用相同 Key。

## 25.4 Hooks 为什么不能写在条件中

### 标准回答

React 通过调用顺序把当前 Render 中的 Hook 调用对应到 Fiber 上的 Hook 链表。条件、循环或提前返回会改变调用顺序，导致这次 `useState` 读取到上一次另一个 Hook 的记录。

```tsx
// 错误
if (enabled) useEffect(() => {}, []);
useState(0);
```

应该始终调用 Hook，把条件放进 Hook 内部：

```tsx
useEffect(() => {
  if (!enabled) return;
  // 只有 enabled 时执行同步逻辑
}, [enabled]);
```

### 追问

**自定义 Hook 为什么可以复用？**

自定义 Hook 复用的是一组 Hook 调用规则和业务逻辑。每个组件调用它时，仍然在自己的 Fiber 和 Hook 链中创建独立状态；自定义 Hook 不会自动共享 State。

## 25.5 `useEffect` 与 `useLayoutEffect` 的区别

### 标准回答

两者都用于把 React 与外部系统同步，但执行阶段不同。`useLayoutEffect` 在 DOM Commit 后、浏览器绘制前执行，适合读取布局并同步修正视觉结果；`useEffect` 属于 Passive Effect，通常在提交后由 React 调度执行，适合订阅、请求、日志和不需要阻塞绘制的同步。

```tsx
useLayoutEffect(() => {
  const rect = panelRef.current?.getBoundingClientRect();
  setPosition(rect?.bottom ?? 0);
}, []);

useEffect(() => {
  const unsubscribe = store.subscribe(onChange);
  return unsubscribe;
}, []);
```

### 容易混淆

`useEffect` 不是类组件生命周期的简单替代品。它表达的是与外部系统建立和清理同步关系。可以直接从 Props 和 State 计算的值，不需要 Effect。

### 追问

**为什么服务端渲染时要谨慎使用 `useLayoutEffect`？**

服务器没有 DOM，也没有浏览器绘制阶段。布局测量只能在客户端进行，应使用客户端封装或把不影响首屏的逻辑改成 `useEffect`。

## 25.6 `React.memo` 是否一定能优化性能

### 标准回答

不一定。`React.memo` 对 Props 做浅比较，只有当子组件本身计算成本较高、Props 大部分时间稳定且父组件频繁更新时，跳过 Render 才可能有收益。如果 Props 每次都是新对象或新函数，比较仍然失败；如果组件很轻，比较成本可能超过节省的 Render 成本。

```tsx
const Row = memo(function Row({ id, selected }: {
  id: string;
  selected: boolean;
}) {
  return <div aria-selected={selected}>{id}</div>;
});
```

`memo` 不能阻止组件自身 State、Context 依赖或外部 Store 选择器结果变化导致的更新。

### 面试重点

回答性能题要说明“先测量再优化”。可以使用 React DevTools Profiler 定位实际耗时，再选择拆分组件、稳定引用、Selector 或虚拟列表。

## 25.7 `setState` 是同步还是异步

### 标准回答

`setState` 是安排更新，不是立即修改当前 Render 中的变量。事件处理函数结束后，React 会根据更新来源和优先级安排 Render。React 18 对更多异步边界中的更新支持自动批量，但“批量”与“异步”不是完全等价的概念。

```tsx
setCount((value) => value + 1);
console.log(count); // 仍是当前 Render 捕获的值
```

如果要在更新完成后做同步 DOM 测量，可以使用 Layout Effect；极少数必须同步提交的场景才考虑 `flushSync`。

### 追问

**为什么函数式更新能处理连续更新？**

它把“如何从上一个状态得到下一个状态”放进 Update 队列。React 处理队列时会将每个函数作用到最新的中间状态，而不是都捕获同一次 Render 的旧值。

## 25.8 React 如何实现批量更新

React 会把同一调度窗口内的多个 Update 放入队列，在一次 Render 中按顺序计算，并尽量合并为一次 Commit：

```tsx
function Form() {
  const [name, setName] = useState('');
  const [valid, setValid] = useState(false);

  async function submit() {
    setName('已提交');
    setValid(true);
  }
}
```

批量更新减少重复 Render 和 DOM 提交，但每个 State 仍然是独立的。不要依赖某种具体的日志次数来编写业务逻辑，因为 Strict Mode、渲染器和更新来源会影响观察结果。

## 25.9 `startTransition` 解决什么问题

`startTransition` 把更新标记为非紧急，让紧急输入有机会先得到响应：

```tsx
const [isPending, startTransition] = useTransition();

function handleSearch(value: string) {
  setInput(value);
  startTransition(() => setQuery(value));
}
```

它适合大列表筛选、路由内容切换和预览计算。它不等于防抖，不减少网络请求，也不能让单次 CPU 计算自动变快。请求层仍然需要缓存、取消和竞态处理。

## 25.10 Redux 和 Context 有什么区别

### 标准回答

Context 是 React 提供的依赖传递机制，适合让一棵子树读取主题、会话或配置；Redux 是一个独立的状态容器协议，包含 Store、Action、Reducer、Dispatch、Middleware 和订阅机制，适合需要明确事件、可追踪更新和复杂派生逻辑的共享客户端状态。

Context 的更新通常会影响读取该 Context 的消费者；Redux 配合 Selector 可以让组件按选择结果订阅。两者都不是服务端数据缓存的自动替代品。

### 业务判断

- 局部 UI 状态：组件 State；
- 稳定配置或会话依赖：Context；
- 复杂客户端业务状态：Redux 或其他外部 Store；
- 服务端列表和详情：带缓存、失效和重试能力的数据层；
- 可分享筛选条件：URL。

## 25.11 React 组件为什么会重新渲染

直接来源通常包括：

- 自身 State 更新；
- 父组件更新导致子树继续处理；
- Props 变化；
- Context 值变化；
- 外部 Store 订阅快照变化；
- Key 改变导致组件身份重建。

组件函数重新执行不等于 DOM 一定发生变化。React 还会做 Reconciliation 和 Bailout，浏览器还要分别处理样式、布局和绘制。

### 定位方法

1. 用 Profiler 记录真实交互；
2. 查看组件更新原因和耗时；
3. 观察 Props、Context、Selector 引用是否稳定；
4. 检查高频 State 是否可以移动到更小子树；
5. 用浏览器 Performance 判断是不是长任务或布局成本。

## 25.12 如何定位 React 性能问题

### 标准回答

先用用户场景复现并测量，再区分网络、JavaScript、React Render、Commit 和浏览器 Paint。React 层面可以检查状态边界、列表规模、Memo 命中率、Selector 稳定性和 Context 更新范围。只有确认瓶颈后才选择 `memo`、虚拟列表、Transition、Deferred Value、代码分割或 Worker。

```tsx
<Profiler
  id="search-results"
  onRender={(id, phase, actualDuration) => {
    performance.measure(`${id}-${phase}`, {
      duration: actualDuration,
    });
  }}
>
  <SearchResults />
</Profiler>
```

上面的代码只是测量入口，完整调查还需要浏览器 Performance、Network 和目标设备数据。

## 25.13 如何设计流式 AI 对话页面

### 标准回答

我会把流式对话拆成四层：

1. **传输层**：Fetch Stream 或 SSE，负责字节读取、UTF-8 解码和事件边界；
2. **协议层**：定义 token、阶段、工具调用、确认、完成和错误事件；
3. **领域状态层**：按消息 ID 合并内容，记录 pending、streaming、complete、error；
4. **展示层**：消息列表、阶段指示器、工具卡片、停止和重试按钮。

每次请求都有 AbortController 和请求 ID，旧响应不能写入新会话。工具调用需要权限校验和用户确认，前端确认只能改善交互，服务端仍要验证权限和参数。

```ts
type AgentEvent =
  | { type: 'token'; messageId: string; text: string }
  | { type: 'tool_call'; callId: string; name: string; input: unknown }
  | { type: 'done'; messageId: string }
  | { type: 'error'; messageId: string; message: string };
```

## 25.14 面试中的回答边界

遇到源码题时，可以主动说明：

- React 18/19 的公开行为是什么；
- 当前版本大致通过什么数据结构实现；
- 哪些函数名和位图属于内部实现，可能变化；
- 这个结论是否受 Strict Mode、SSR、并发模式或渲染器影响。

这种表达比绝对地说“React 一定这样执行”更准确，也更接近真实项目排查方式。

## 25.15 本章小结

React 面试题最好围绕“问题—机制—边界—实践”回答。Fiber 解决可调度的树遍历，Key 维护列表身份，Hooks 依赖调用顺序，Effect 同步外部系统，Memo 需要测量，State 更新通过队列和优先级调度，性能问题要结合 React Profiler 和浏览器工具。面对流式 AI 场景，还要把传输协议、领域状态、取消竞态和权限边界一起讲清楚。

## 25.16 练习题与参考答案

### 练习题 1

用三句话解释 Fiber，不使用“虚拟 DOM 更快”作为结论。

**参考答案**：Fiber 是 React 的内部节点和工作单元，保存组件身份、State、子树和更新信息。它把递归树遍历拆开，使 Render 阶段可以暂停、恢复和重新安排。最终是否更快取决于工作量、优先级和浏览器主线程，而不是 Fiber 本身自动减少所有计算。

### 练习题 2

为什么随机 Key 会导致输入框内容丢失？

**参考答案**：每次 Render 都生成新 Key，React 无法把新节点与旧节点匹配，于是卸载旧组件并创建新组件。组件 State 和 DOM 输入状态随旧身份被销毁。

### 练习题 3

设计一个搜索优化方案，同时处理输入卡顿和旧响应覆盖。

**参考答案**：输入值紧急更新，结果查询用 Transition 或 Deferred Value；请求层做防抖、AbortController 和请求 ID 校验；结果组件按稳定 ID 渲染，必要时使用虚拟列表。

### 练习题 4

说明为什么前端隐藏“删除”按钮不等于实现权限控制。

**参考答案**：用户可以直接构造请求绕过界面。真正的权限必须在服务端根据身份、资源归属和权限策略验证，前端只负责减少误操作和改善体验。