---
title: 第 24 章 从 setState 到页面更新的完整链路
outline: deep
---

# 第 24 章 从 `setState` 到页面更新的完整链路

前面几章分别介绍了 State、Fiber、Lane、Render、Commit 和 Effect。本章把它们串成一次完整的更新：用户点击按钮之后，React 如何接收事件、创建 Update、安排优先级、计算新的 Fiber 树，最后修改 DOM 并执行副作用。

这条链路是面试中最值得完整表达的一条主线，也是排查“为什么页面没有更新”“为什么旧请求覆盖新请求”“为什么输入卡顿”的基础。

> **版本说明**：下面的描述以 React 18/19 的 Fiber 架构和现代 `react-dom` 客户端为基础。内部函数名、Lane 位图和事件实现可能随小版本变化，源码视角中的伪代码用于帮助建立模型，不代表可以直接从业务代码调用。

## 本章学习目标

学习完本章，你应该能够：

1. 从一次点击开始描述 React 更新链路；
2. 区分事件、Update、Fiber、Lane 和 DOM 操作；
3. 解释 Render 阶段为什么可以被中断，Commit 阶段为什么需要保持一致；
4. 说明批量更新和 `startTransition` 在链路中的位置；
5. 区分 Layout Effect 和 Passive Effect 的执行时机；
6. 通过日志、Profiler 和最小实验验证更新过程；
7. 在面试中用一条连续因果链回答“setState 后发生了什么”。

## 24.1 生活化直觉：一张订单如何被处理

可以把一次 React 更新想成餐厅处理订单：

1. 用户点击按钮，相当于顾客下单；
2. 事件处理函数把订单写入前台系统；
3. Update 是一张待处理订单；
4. Lane 是订单的优先级；
5. Render 是后厨根据所有待处理订单计算新菜单状态；
6. Commit 是把已经确认的结果端到前台；
7. Layout Effect 是端上桌前的摆盘；
8. Passive Effect 是服务员稍后进行的清理和补货。

后厨计算过程可以重做或暂停，但已经端到前台的结果不能只更新一半。因此 React 把“计算新结果”和“应用结果”分成 Render 与 Commit 两个阶段。

## 24.2 最小可运行示例

```tsx
import { useEffect, useLayoutEffect, useState } from 'react';

export function Counter() {
  const [count, setCount] = useState(0);

  function handleClick() {
    setCount((current) => current + 1);
  }

  useLayoutEffect(() => {
    console.log('layout effect:', count);
    return () => console.log('layout cleanup:', count);
  }, [count]);

  useEffect(() => {
    console.log('passive effect:', count);
    return () => console.log('passive cleanup:', count);
  }, [count]);

  console.log('render:', count);

  return (
    <button onClick={handleClick}>
      点击次数：{count}
    </button>
  );
}
```

逐段看这段代码：

- `useState(0)` 在当前 Fiber 的 Hook 链中创建 State 记录；
- `handleClick` 由浏览器事件触发，调用 `setCount`；
- 函数式更新 `current => current + 1` 会在处理 Update 队列时读取最新状态；
- 组件函数再次执行，返回包含新文本的 React Element；
- `useLayoutEffect` 在 DOM 提交后、浏览器绘制前运行；
- `useEffect` 的回调在提交后由 React 调度执行；
- 清理函数对应旧依赖关系，在下一次相关 Effect 执行前或组件卸载时运行。

开发环境使用 Strict Mode 时，部分 Render 和 Effect 可能被额外执行来暴露不纯逻辑。不要用一次开发日志顺序推断所有生产场景。

## 24.3 第一步：事件处理函数调用 `setState`

浏览器先触发真实 DOM 事件，React 的事件系统把它转交给组件上的事件处理函数：

```text
click
  -> React 事件委托入口
  -> 找到当前 Fiber 上的 onClick
  -> 调用 handleClick
  -> setCount(action)
```

React 18 的事件系统通常把监听器集中在根节点附近，再根据 Fiber 树找到对应组件。事件委托减少了大量 DOM 监听器，但事件对象、优先级和插件细节属于内部实现。

事件处理函数应该描述用户意图：

```tsx
function AddButton({ onAdd }: { onAdd: () => void }) {
  return <button onClick={onAdd}>新增</button>;
}
```

不要在 Render 阶段直接调用 `setState`：

```tsx
// 错误：每次 Render 都触发更新，可能形成无限循环
if (count === 0) setCount(1);
```

某些受控场景允许在特殊条件下调整状态，但业务代码应优先把更新放在事件、Effect 或明确的外部 Store 回调中。

## 24.4 第二步：创建 Update 并加入队列

调用 `setCount` 时，React 不会立刻把组件函数执行结果写入 DOM，而是创建一条 Update：

```ts
type Update<S> = {
  lane: Lane;
  action: S | ((previous: S) => S);
  next: Update<S> | null;
};

function dispatchSetState<S>(fiber: Fiber, queue: UpdateQueue<S>, action: S) {
  const lane = requestUpdateLane(fiber);
  const update = { lane, action, next: null };
  enqueueUpdate(queue, update, lane);
  scheduleUpdateOnFiber(fiber, lane);
}
```

这段伪代码省略了 eager state、Render Phase Update、并发队列和开发检查，但保留了三个关键事实：

1. 更新属于某个 Hook 的队列；
2. 更新带有优先级信息；
3. 入队后要通知 Root 安排工作。

多个函数式更新会按队列顺序计算：

```tsx
setCount((value) => value + 1);
setCount((value) => value + 1);
```

如果写成 `setCount(count + 1)`，两个表达式可能都捕获同一次 Render 中的 `count`，因此得到同一个目标值。函数式更新适合依赖前一个状态的连续操作。

## 24.5 第三步：选择 Lane 并调度 Root

### 24.5.1 Lane 表示更新优先级

React 18/19 使用 Lane 模型表示更新类别。可以把它理解为一组带有语义的优先级通道：

```text
离散输入更新：点击、键盘输入
连续输入更新：拖拽、滚动
默认更新：普通 State 更新
Transition：可以延后处理的非紧急更新
Idle：更低优先级工作
```

Lane 不是简单的“数字越小越优先”。React 还需要记录哪些 Lane 已挂起、正在处理、等待重试或被延迟。

### 24.5.2 `startTransition` 的位置

```tsx
function SearchPage() {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleChange(value: string) {
    setInput(value);
    startTransition(() => {
      setQuery(value);
    });
  }

  return (
    <>
      <input value={input} onChange={(event) => handleChange(event.target.value)} />
      {isPending && <span>正在更新结果…</span>}
      <ResultList query={query} />
    </>
  );
}
```

输入框的 `input` 更新需要快速反馈，`query` 更新可以延后。Transition 不会减少 `ResultList` 的计算量，也不是防抖；它告诉 React 这部分更新可以让位给更紧急的工作。

### 24.5.3 Scheduler 与 Fiber 的分工

```text
Scheduler：什么时候继续做工作
Fiber：具体做哪些组件和节点工作
React DOM：如何把最终结果应用到浏览器
```

Scheduler 负责任务安排和让出执行机会，Fiber 把树遍历拆成可保存的工作单元，Reconciler 根据新旧树计算变化，Host Config 负责 DOM 操作。它们协作，但职责不同。

## 24.6 第四步：Render 阶段计算新树

Render 阶段从 Root 开始遍历 Fiber：

```text
renderRoot
  -> prepareFreshStack
  -> workLoopConcurrent 或 workLoopSync
  -> performUnitOfWork
  -> beginWork
  -> completeWork
  -> 得到 workInProgress 树
```

### 24.6.1 `beginWork`

`beginWork` 会根据 Fiber 类型执行不同工作：

- 函数组件：执行函数，读取 Hook，生成子 Element；
- Host Component：处理 `<div>`、`<button>` 等宿主节点；
- Provider：传播 Context；
- Memo 组件：比较 Props，条件允许时 Bailout；
- Suspense：处理已完成内容或 fallback。

组件函数返回的仍然是 React Element。React 会把 Element 与现有 Fiber 联系起来，形成新的工作树。

### 24.6.2 `completeWork`

`completeWork` 从子节点回到父节点，完成宿主实例和副作用标记的整理：

```text
子 Fiber 完成
  -> 冒泡 subtreeFlags
  -> 准备 Host 节点更新
  -> 回到 return 指针指向的父 Fiber
```

如果 Render 发现更高优先级工作到达，并发模式可以暂停当前树，把尚未完成的工作保留到之后继续。因为此时还没有把结果应用到真实 DOM，所以暂停不会留下半棵新树。

## 24.7 第五步：Commit 阶段应用结果

当 Render 得到可提交的工作树后，React 进入 Commit：

```text
commitRoot
  -> Before Mutation
  -> Mutation
  -> Layout
  -> Passive Effect 调度
```

### 24.7.1 Mutation 阶段

Mutation 阶段执行插入、删除、文本更新和属性更新：

```tsx
// 逻辑结果，不是实际内部 API
oldText = '点击次数：0';
newText = '点击次数：1';
// React DOM 更新对应的文本节点
```

React 不会因为组件函数再次执行就把整棵 DOM 重建。Reconciliation 根据类型、Key 和 Props 识别可复用节点，只提交必要变化。

### 24.7.2 Layout Effect

DOM 已经完成本次提交，但浏览器通常还没有绘制，React 运行 Layout Effect：

```tsx
useLayoutEffect(() => {
  const rect = ref.current?.getBoundingClientRect();
  // 根据新 DOM 尺寸同步调整视觉结果
}, [value]);
```

适合测量布局或避免视觉闪烁，但执行时间过长会阻塞绘制。服务端渲染时不能直接依赖浏览器 DOM。

### 24.7.3 Passive Effect

`useEffect` 属于 Passive Effect。React 在 Commit 后安排它们执行：

```tsx
useEffect(() => {
  const connection = connect(roomId);
  return () => connection.disconnect();
}, [roomId]);
```

当依赖改变时，旧清理函数先断开旧连接，再建立新连接；组件卸载时执行最终清理。Effect 不应该被当作“每次组件显示后都执行的生命周期函数”，它表达的是与外部系统同步。

## 24.8 批量更新的执行过程

```tsx
function Form() {
  const [name, setName] = useState('');
  const [submitted, setSubmitted] = useState(false);

  async function submit() {
    setName('已提交');
    setSubmitted(true);
  }

  return <button onClick={() => void submit()}>{name}</button>;
}
```

React 18 对更多异步边界中的更新进行自动批量处理，但具体批量边界仍受渲染器、更新来源和 `flushSync` 等因素影响。批量的重点是减少重复 Render/Commit，不是让两个 State 合并成一个变量。

如果确实需要同步读取刚提交的 DOM，可以使用 `flushSync`，但它会降低并发调度空间：

```tsx
flushSync(() => {
  setOpen(true);
});
inputRef.current?.focus();
```

`flushSync` 应限制在少数需要同步布局的交互中，不能作为普通更新方式。

## 24.9 业务场景：保存表单并刷新列表

```tsx
type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'success'; id: string }
  | { status: 'error'; message: string };

function Editor({ onSaved }: { onSaved: (id: string) => void }) {
  const [title, setTitle] = useState('');
  const [state, setState] = useState<SaveState>({ status: 'idle' });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setState({ status: 'saving' });

    try {
      const response = await fetch('/api/articles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) throw new Error('保存失败');
      const article = await response.json() as { id: string };
      setState({ status: 'success', id: article.id });
      onSaved(article.id);
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input value={title} onChange={(event) => setTitle(event.target.value)} />
      <button disabled={state.status === 'saving'}>保存</button>
      {state.status === 'error' && <p role="alert">{state.message}</p>}
    </form>
  );
}
```

业务上还需要处理重复提交、页面离开、请求取消和服务端返回的字段错误。React 更新链路只能保证 State 到 UI 的计算，不能自动保证网络请求的业务一致性。

## 24.10 常见错误和错误写法

### 错误一：认为 `setState` 直接修改变量

在当前 Render 中，`count` 仍然是这次函数执行捕获的值。调用 Setter 只是安排下一次 Render：

```tsx
setCount(count + 1);
console.log(count); // 当前 Render 的 count
```

### 错误二：把 Render 当作提交

Render 可能被打断、重试或丢弃。不要在组件函数中发请求、写 DOM、写全局变量或执行不可逆副作用。

### 错误三：在 Effect 中无条件设置依赖状态

```tsx
useEffect(() => {
  setValue(compute(value));
}, [value]);
```

如果 `compute` 每次返回新值或依赖关系不正确，可能形成循环。能在 Render 中计算的值，不要用 Effect 复制一份 State。

### 错误四：把 Transition 当作防抖

Transition 只改变 React 更新优先级，输入停止后仍可能没有等待时间。减少请求应使用防抖、取消或服务端缓存。

## 24.11 源码验证方式

可以通过三层证据验证更新链路：

1. **组件日志**：记录 Render 和 Effect；
2. **React DevTools Profiler**：观察 Commit 次数、耗时和更新来源；
3. **浏览器 Performance**：观察事件、长任务、Layout、Paint 和网络。

源码阅读时，从 `dispatchSetState`、`scheduleUpdateOnFiber`、`renderRoot`、`beginWork`、`completeWork` 和 `commitRoot` 这些概念入口开始，再根据当前 React 版本寻找对应实现。函数名可能变化，但“入队—调度—计算—提交”的结构是主线。

## 24.12 面试重点：标准回答

> 用户触发事件后，事件处理函数调用 State Setter。React 为这次更新创建 Update，放入对应 Hook 的更新队列，并根据更新来源分配 Lane，再从 Fiber Root 调度工作。Render 阶段 React 遍历 Fiber，执行组件、处理 Hook 和 Reconciliation，构建新的 workInProgress 树，这个阶段在并发模式下可以被中断和重做。得到一致结果后进入 Commit，React 执行 DOM 插入、删除和属性更新，然后运行 Layout Effect，并在之后调度 Passive Effect。`setState` 是安排更新，不是立即修改当前 Render 中的变量。

## 24.13 面试官可能继续追问

1. 为什么 Render 可以中断，Commit 不应该随意中断？
2. 多个 `setState` 为什么有时只触发一次 Commit？
3. `startTransition` 具体改变了哪一部分优先级？
4. `useEffect` 的清理函数在下一次更新的哪个阶段运行？
5. 如果旧请求在新请求之后返回，React 会自动阻止它吗？
6. Fiber 和 Scheduler 的职责如何区分？

## 24.14 练习题与参考答案

### 练习题 1

解释下面代码最终显示什么：

```tsx
setCount(count + 1);
setCount(count + 1);
```

**参考答案**：两个 Update 都捕获当前 Render 的 `count`，如果当前是 0，它们通常都把目标值设为 1，结果是 1。改成两个函数式更新后，第二个会读取第一个更新后的中间状态，结果是 2。

### 练习题 2

为什么不能在 Render 阶段发起保存请求？

**参考答案**：Render 可能被中断、重试或最终丢弃，副作用可能执行多次或执行了却没有对应提交。保存请求应该放在事件处理函数、Effect 或专门的数据层中，并处理取消和重复提交。

### 练习题 3

设计一个搜索框：输入必须立即显示，结果列表可以延后更新。

**参考答案**：用两个 State 保存输入和查询值，输入 State 直接更新，查询 State 放进 `startTransition`；如果还要减少网络请求，再额外使用防抖、请求取消或缓存。

### 练习题 4

如何判断一次卡顿发生在 React Render 还是浏览器 Paint？

**参考答案**：用 React Profiler 查看组件 Render/Commit 耗时，再用浏览器 Performance 查看 JavaScript、Layout、Paint 和长任务。两者要结合，不能只看组件日志。

## 本章小结

`setState` 到页面更新不是一次同步赋值，而是一条由事件、Update、Lane、调度、Fiber Render、Commit 和 Effect 组成的链路。Render 负责计算可提交结果，Commit 负责一致地应用结果，Layout Effect 和 Passive Effect 位于不同的提交后阶段。掌握这条主线，才能把 React 的各个概念组织成可用于调试和面试的完整解释。