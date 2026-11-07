---
title: 第 23 章 React 源码阅读方法
outline: deep
---

# 第 23 章 React 源码阅读方法

阅读 React 源码的目标不是背函数名，而是回答一个具体问题：

> 某个用户行为发生后，React 如何从入口走到最终结果？

例如“点击按钮后为什么页面更新”“Effect 为什么在这里执行”“Transition 为什么可以被打断”。先提出行为问题，再沿着调用链寻找证据，比从几百万行文件中随机浏览更有效。

本章不会把内部函数当成稳定 API，而是建立一套可重复的阅读方法：确定版本、找到入口、记录数据结构、跟踪状态转换、验证假设，并把源码结论和公开行为分开。

## 本章学习目标

学习完本章，你应该能够：

1. 根据 React 版本定位对应源码；
2. 从公开 API 追踪到源码入口；
3. 识别 Fiber、Hook、Update、Lane 和 Effect 等关键数据结构；
4. 使用搜索、断点和日志建立调用链；
5. 区分源码事实、推断和实验结果；
6. 避免把内部实现当作长期稳定契约。

## 23.1 源码模型：从问题到调用链

### 23.1.1 先写出最小问题

不要从“React 源码怎么读”开始，而要把问题具体化：

```text
问题：点击 setCount 后，为什么组件重新执行？

入口：button click
API：setCount
对象：Hook update queue
调度：requestUpdateLane
Render：updateReducer / beginWork
提交：commitRoot
结果：Host text 更新
```

这张路径图告诉你应该搜索哪些关键词，也提醒你不要在暂时无关的 Server Components 或 DevTools 代码中迷路。

### 23.1.2 源码仓库的分层

React 仓库通常可以按职责粗略划分：

```text
packages/react             # createElement、Hooks 等公开运行时 API
packages/react-reconciler # Fiber、Render、Commit、调度和事件关联
packages/react-dom        # DOM Host Config、客户端入口和浏览器实现
packages/scheduler         # 调度器和任务优先级
fixtures / scripts         # 示例、构建和开发脚本
```

文件路径和函数名会随版本变化，因此阅读时要先锁定 Git Tag 或提交。当前仓库的 `main` 可能包含尚未发布的实现，不能直接用来解释某个已部署版本的行为。

### 23.1.3 使用行为实验建立证据

```tsx
function Probe() {
  const [value, setValue] = useState(0);

  console.log('render', value);

  useLayoutEffect(() => {
    console.log('layout effect', value);
    return () => console.log('layout cleanup', value);
  }, [value]);

  useEffect(() => {
    console.log('passive effect', value);
    return () => console.log('passive cleanup', value);
  }, [value]);

  return <button onClick={() => setValue((current) => current + 1)}>{value}</button>;
}
```

先记录 Render、Layout Effect、Passive Effect 和清理函数的顺序，再去源码中寻找对应路径。实验结果帮助你判断哪些源码分支与问题相关。

## 23.2 从 Hook 入口开始

### 23.2.1 公开 Hook 如何找到 Dispatcher

Hook 不能在脱离 React 的普通函数中运行。概念上的入口是：

```ts
function resolveDispatcher() {
  const dispatcher = ReactSharedInternals.H;
  if (dispatcher === null) {
    throwInvalidHookError();
  }
  return dispatcher;
}

export function useState<S>(initialState: S) {
  const dispatcher = resolveDispatcher();
  return dispatcher.useState(initialState);
}
```

阅读时可以沿这条链继续追踪：

```text
useState
  -> resolveDispatcher
  -> HooksDispatcherOnMount / OnUpdate
  -> mountState / updateState
  -> Hook.memoizedState
  -> dispatchSetState
```

开发环境、服务端渲染和并发渲染可能使用不同 Dispatcher。不要只读一个 `useState` 实现就认为所有场景完全相同。

### 23.2.2 Hook 链表和 Fiber

```ts
type Hook = {
  memoizedState: unknown;
  baseState: unknown;
  baseQueue: unknown;
  queue: unknown;
  next: Hook | null;
};
```

关键问题是“当前 Hook 对应哪个节点”。React 依赖调用顺序遍历 Hook 链表，所以条件调用会让后续 Hook 错位：

```tsx
// 错误：第二次 Render 可能让 Hook 节点对应关系改变
if (enabled) useState(false);
useEffect(() => {}, []);
```

源码阅读应该把链表结构和 Hooks 规则联系起来，而不是只记住“不能条件调用”。

## 23.3 追踪 State 更新

### 23.3.1 Update 记录了什么

可以把 State 更新抽象成：

```ts
type Update<S> = {
  lane: Lane;
  action: S | ((previous: S) => S);
  next: Update<S> | null;
};
```

调用 `setCount(1)` 和 `setCount((count) => count + 1)` 都会创建 Update，但 Action 形态不同。多个更新在同一批次中会按队列顺序计算：

```tsx
setCount((value) => value + 1);
setCount((value) => value + 1);
```

函数式更新分别读取队列中的最新中间结果，因此最终加二。源码阅读要关注队列如何合并、跳过和保留不同 Lane 的 Update。

### 23.3.2 Lane 为什么影响执行顺序

```text
Update
  -> requestUpdateLane(fiber)
  -> root.pendingLanes |= lane
  -> getNextLanes(root)
  -> renderRoot(root, lanes)
```

Lane 不是简单的数字优先级，它还携带更新是否已选择、是否被挂起、是否需要重试等信息。阅读某个 Lane 函数时，要同时看它如何被设置、合并、移除和重新安排。

## 23.4 追踪 Render 和 Commit

### 23.4.1 Render 阶段

```text
renderRoot
  -> prepareFreshStack
  -> workLoopSync / workLoopConcurrent
  -> performUnitOfWork
  -> beginWork
  -> completeUnitOfWork
  -> completeWork
```

`beginWork` 主要处理组件更新和子节点协调，`completeWork` 处理 Host 节点完成、冒泡 flags 和生成必要的实例信息。并发模式下，工作循环可能在多个单元之间暂停。

### 23.4.2 Commit 阶段

```text
commitRoot
  -> before mutation effects
  -> mutation effects
  -> layout effects
  -> passive effects 调度
```

Commit 一般不会像 Render 那样被任意中断，因为它需要把一组结果一致地应用到宿主环境。阅读 DOM 更新时，要区分 Render 阶段决定了什么和 Commit 阶段实际做了什么。

### 23.4.3 用 flags 找待提交工作

```ts
type Fiber = {
  flags: Flags;
  subtreeFlags: Flags;
  child: Fiber | null;
  sibling: Fiber | null;
  return: Fiber | null;
};
```

源码版本不同，副作用标记和遍历方式可能变化。阅读时重点理解“为什么这棵子树会在 Commit 被访问”，不要把某个标志位名称当成永久 API。

## 23.5 业务代码：建立源码探针

```tsx
function RenderProbe({ name, children }: {
  name: string;
  children: ReactNode;
}) {
  const renderCount = useRef(0);
  renderCount.current += 1;

  useEffect(() => {
    performance.mark(`${name}-commit-${renderCount.current}`);
  });

  return (
    <section data-render-count={renderCount.current}>
      {children}
    </section>
  );
}
```

这个探针不等于 React 内部日志，但可以把用户可见行为和源码阅读连接起来：哪些更新导致组件执行、哪些更新产生 Commit、哪些行为只发生在开发环境。

更深层的实验可以使用 React DevTools Profiler 的 `onRender` 回调：

```tsx
<Profiler
  id="report"
  onRender={(id, phase, actualDuration, baseDuration) => {
    console.log({ id, phase, actualDuration, baseDuration });
  }}
>
  <Report />
</Profiler>
```

实验代码要和生产代码隔离，避免把调试信息、敏感数据和性能开销带到线上。

## 23.6 有效的源码阅读流程

可以按以下顺序处理一个问题：

1. **锁定版本**：确认 React、React DOM 和构建产物版本；
2. **复现行为**：写最小组件，去掉路由、网络和第三方库；
3. **观察结果**：记录 Render、Commit、Effect、DOM 和调度顺序；
4. **搜索入口**：从公开 API、报错文本或事件名开始；
5. **画调用链**：记录函数、数据结构和分支条件；
6. **缩小源码**：只保留与问题相关的路径；
7. **验证假设**：改变一个变量，看行为是否随之变化；
8. **写出边界**：说明开发环境、Strict Mode、SSR 和并发模式差异。

阅读结论最好包含三层：

```text
官方保证：用户可以依赖什么
当前实现：这个版本大致如何完成
实验限制：在哪些环境下观察到，哪些情况未验证
```

## 23.7 常见错误边界

### 错误一：直接阅读最新主分支并下结论

源码会变化，内部函数可能重命名、移动或删除。解释线上行为时，先锁定对应的 React 版本和构建产物。

### 错误二：把内部字段当作公开 API

Fiber 字段、Lane 位图、Dispatcher 和 flags 都是实现细节。它们适合学习和调试，不适合在业务代码中直接依赖。

### 错误三：只看函数名，不看调用上下文

同一个函数可能在 Mount、Update、重试、服务端或开发检查路径中以不同方式调用。要看调用者、输入数据和返回值如何流动。

### 错误四：把一次日志当成通用规律

Strict Mode、浏览器调度、批量更新和并发渲染都会影响日志顺序。一次实验只能说明一个条件下的结果，结论必须写清前提。

### 错误五：修改源码后没有重新构建

React 的源码包经过 Feature Flag、编译和打包。只改源码文件但运行旧构建产物，会让调试结果与阅读内容不一致。

### 错误六：忽略 Host Config

要理解 DOM 行为，不能只看 reconciler。节点创建、属性更新、事件和文本处理还依赖 `react-dom` 的 Host Config。

## 23.8 练习题

1. 从 `useState` 入口追踪到 Update 入队，画出至少八个节点的调用链。
2. 用最小组件观察一次 State 更新中 Render、Commit 和 Effect 的顺序。
3. 解释为什么条件调用 Hook 会让 Hook 链表错位。
4. 比较同步 Render 和并发 Render 在工作循环上的差异。
5. 为一个 `React.memo` 组件建立实验，验证 Bailout 何时发生、何时被 Context 打破。
6. 选择一个 React 版本，记录一份“公开行为、源码实现、实验限制”三栏笔记。

## 本章小结

高效阅读 React 源码需要从行为问题出发，锁定版本，建立最小实验，再沿数据结构和调用链验证假设。源码可以解释当前实现，但不能替代公开 API 契约。把官方保证、版本实现和实验条件分开，是避免错误结论的关键。