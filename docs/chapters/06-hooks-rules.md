---
title: 第 6 章 Hooks 的规则与本质
outline: deep
---

# 第 6 章 Hooks 的规则与本质

上一章我们从 `useState` 出发，看到 State 并不是保存在函数局部变量里，而是保存在 React 为组件维护的 Hook 记录中。

这一章继续追问几个更底层的问题：

- React 如何知道当前调用的是第几个 Hook？
- 为什么 Hook 不能写在条件判断、循环和嵌套函数中？
- `useState`、`useEffect`、`useRef` 为什么可以共存于同一个组件？
- 自定义 Hook 到底是怎样复用状态逻辑的？
- 为什么定时器、订阅和异步请求容易读到旧值？
- Hook 链表、闭包和 stale closure 之间有什么关系？

本章会使用源码中的概念名称，但会把它们放在可运行的 JavaScript 代码和实际业务场景中解释。React 内部实现会随着版本变化，源码片段用于建立模型，不代表可以直接复制到业务代码中。

## 本章学习目标

学习完本章，你应该能够：

1. 解释 Hooks 只能在顶层调用的原因；
2. 理解 Fiber 上 Hook 链表的基本结构；
3. 区分首次渲染和后续更新时的 Hook 处理过程；
4. 理解 `useState`、`useEffect`、`useRef` 如何共享 Hook 调用顺序；
5. 说明自定义 Hook 为什么能够复用逻辑但不会共享 State；
6. 识别 stale closure 的来源，并选择合适的修复方式；
7. 理解 Hooks 规则校验工具能检查什么、不能检查什么；
8. 设计边界清楚、依赖关系可靠的自定义 Hook；
9. 从源码入口追踪一次 Hook 调用；
10. 在表单、订阅、定时器和异步请求中避免常见 Hook 错误。

## 6.1 Hooks 解决了什么问题

### 6.1.1 组件逻辑需要多个“记忆位置”

一个真实组件通常同时需要保存多类信息：

```tsx
function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 请求用户信息
  }, []);

  return <input ref={inputRef} />;
}
```

React 至少需要为这个组件记住：

```text
第 1 个 Hook：user 的 State
第 2 个 Hook：loading 的 State
第 3 个 Hook：inputRef 的引用对象
第 4 个 Hook：Effect 的依赖和清理函数
```

这些信息都属于同一个函数组件，但它们的行为不同：

- `useState` 保存值，并在更新时触发重新渲染；
- `useRef` 保存一个稳定对象，修改 `.current` 通常不会触发重新渲染；
- `useEffect` 保存副作用描述，并在 Commit 相关阶段运行创建函数或清理函数；
- `useMemo` 保存计算结果和依赖数组；
- `useCallback` 保存函数引用和依赖数组。

### 6.1.2 Hook 是组件内部的一条逻辑记录

可以先用一个抽象结构理解 Hook：

```text
当前组件对应的 Fiber
└─ memoizedState
   └─ Hook 1
      └─ next → Hook 2
         └─ next → Hook 3
            └─ next → null
```

每个 Hook 节点负责保存一类 Hook 的运行时数据。

这条链表不是开发者写出来的，也不是 DOM 树。它是 React 在 Render 阶段为当前函数组件维护的内部数据结构。

### 6.1.3 调用顺序就是 Hook 的身份

在下面的组件中，Hook 身份可以用位置表示：

```tsx
function Editor() {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const previewRef = useRef<HTMLDivElement>(null);

  return null;
}
```

React 可以建立这样的对应关系：

```text
第 1 次 Hook 调用 → title
第 2 次 Hook 调用 → content
第 3 次 Hook 调用 → previewRef
```

下一次渲染时，只要调用顺序仍然相同，React 就能把已有记录对应回来：

```text
第 1 次 Hook 调用 → 读取原来的 title Hook
第 2 次 Hook 调用 → 读取原来的 content Hook
第 3 次 Hook 调用 → 读取原来的 previewRef Hook
```

React 不需要从变量名 `title`、`content` 或 `previewRef` 推断身份。变量名在运行时也不参与 Hook 匹配。

> Hook 的身份来自组件实例上的调用顺序，而不是来自变量名。

## 6.2 两条最重要的 Hooks 规则

React 官方把使用 Hooks 的基本要求概括成两条规则。

### 6.2.1 只在顶层调用 Hooks

Hook 应该直接写在函数组件或自定义 Hook 的顶层：

```tsx
function SearchPanel() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<Result | null>(null);

  return null;
}
```

这里的“顶层”表示每次组件执行时，Hook 都按照相同顺序到达。它不是指文件的最外层，也不是指必须写在所有普通语句之前。

下面这种写法会改变调用顺序：

```tsx
function SearchPanel({ enabled }: { enabled: boolean }) {
  if (enabled) {
    const [query] = useState('');
    console.log(query);
  }

  const [result] = useState<Result | null>(null);
  return null;
}
```

第一次渲染时：

```text
enabled = true
第 1 个 Hook → query
第 2 个 Hook → result
```

下一次渲染时：

```text
enabled = false
第 1 个 Hook → result
```

原来的第 2 个 Hook 被当成了第 1 个 Hook 使用，后续的状态和副作用就可能错位。

### 6.2.2 只在 React 函数中调用 Hooks

Hook 应该在以下两类函数中调用：

- React 函数组件；
- 自定义 Hook。

React 函数组件通常使用大写开头的函数名：

```tsx
function UserCard() {
  const [expanded, setExpanded] = useState(false);
  return null;
}
```

自定义 Hook 通常以 `use` 开头：

```tsx
function useOnlineStatus() {
  const [online, setOnline] = useState(false);
  return online;
}
```

普通工具函数不应该直接调用 Hook：

```tsx
// 错误：普通工具函数不属于组件或自定义 Hook
function getCurrentUser() {
  const [user] = useState<User | null>(null);
  return user;
}
```

正确方式是让工具函数接收数据：

```tsx
function getUserLabel(user: User | null) {
  return user ? user.name : '未登录';
}
```

如果逻辑确实需要 State、Effect 或其他 Hook，就把它设计成自定义 Hook：

```tsx
function useCurrentUser() {
  const [user, setUser] = useState<User | null>(null);
  return { user, setUser };
}
```

### 6.2.3 为什么自定义 Hook 名必须以 `use` 开头

`use` 前缀不仅是命名风格，还帮助工具识别函数的用途：

```tsx
function useDebouncedValue<T>(value: T, delay: number) {
  // 这里可以调用其他 Hook
  return value;
}
```

Lint 工具可以据此检查：

- 这个函数是否在合法位置调用了 Hook；
- Hook 是否位于条件分支或循环中；
- 组件是否把 Hook 放到了普通函数里。

如果一个函数内部调用了 Hook，却命名为 `createSomething` 或 `getSomething`，代码阅读者和静态检查工具都更难判断它的使用规则。

## 6.3 错误调用顺序会发生什么

### 6.3.1 条件调用

错误：

```tsx
function Dashboard({ showDetails }: { showDetails: boolean }) {
  const [summary] = useState('summary');

  if (showDetails) {
    const [details] = useState('details');
    console.log(details);
  }

  const [footer] = useState('footer');
  return null;
}
```

当 `showDetails` 从 `true` 变为 `false` 时，调用序列会从：

```text
useState(summary)
useState(details)
useState(footer)
```

变成：

```text
useState(summary)
useState(footer)
```

React 只能看到第 2 次调用的位置发生了变化。它不会知道“footer 应该跳过 details 的位置”。

正确方式是始终调用 Hook，把条件放在 Hook 内部或返回结果的使用处：

```tsx
function Dashboard({ showDetails }: { showDetails: boolean }) {
  const [summary] = useState('summary');
  const [details] = useState('details');
  const [footer] = useState('footer');

  return showDetails ? `${summary} ${details}` : `${summary} ${footer}`;
}
```

也可以把条件下沉到独立组件：

```tsx
function Dashboard({ showDetails }: { showDetails: boolean }) {
  return (
    <>
      <Summary />
      {showDetails ? <Details /> : null}
      <Footer />
    </>
  );
}
```

这样 `Details` 是否存在不会改变 `Dashboard` 自己的 Hook 顺序。

### 6.3.2 循环调用

错误：

```tsx
function List({ items }: { items: Item[] }) {
  return (
    <ul>
      {items.map((item) => {
        const [selected] = useState(false);
        return <li key={item.id}>{selected ? '已选' : item.name}</li>;
      })}
    </ul>
  );
}
```

当数组长度变化时，Hook 调用次数也会变化：

```text
items 有 2 项 → 调用 2 次 useState
items 有 3 项 → 调用 3 次 useState
```

而且每一项的状态应该跟随每个列表项的组件身份，而不是跟随一次 `map` 执行。

正确方式是拆成子组件：

```tsx
function ListItem({ item }: { item: Item }) {
  const [selected, setSelected] = useState(false);

  return (
    <li>
      <button type="button" onClick={() => setSelected((value) => !value)}>
        {selected ? '已选' : item.name}
      </button>
    </li>
  );
}

function List({ items }: { items: Item[] }) {
  return (
    <ul>
      {items.map((item) => (
        <ListItem key={item.id} item={item} />
      ))}
    </ul>
  );
}
```

每个 `ListItem` 都有自己的 Fiber 和自己的 Hook 链表，列表长度变化不会把所有项的 Hook 混在同一个组件里。

### 6.3.3 嵌套函数调用 Hook

错误：

```tsx
function Form() {
  function renderError() {
    const [message] = useState('输入错误');
    return <p>{message}</p>;
  }

  return <div>{renderError()}</div>;
}
```

`renderError` 是普通嵌套函数。它何时调用、调用几次、是否在条件分支中调用，都可能发生变化，React 无法把它当作一个稳定的组件边界。

可以改为组件：

```tsx
function ErrorMessage() {
  const [message] = useState('输入错误');
  return <p>{message}</p>;
}

function Form() {
  return (
    <div>
      <ErrorMessage />
    </div>
  );
}
```

也可以把 Hook 放回外层组件：

```tsx
function Form() {
  const [message] = useState('输入错误');

  function renderError() {
    return <p>{message}</p>;
  }

  return <div>{renderError()}</div>;
}
```

这里 `renderError` 只读取已经得到的值，本身不再调用 Hook。

### 6.3.4 组件直接调用

错误：

```tsx
function Page() {
  return <Panel />;
}
```

这是正常的组件调用。

下面是另一种写法：

```tsx
function Page() {
  return Panel();
}
```

它看起来也能返回 JSX，但它把 `Panel` 当成普通函数直接执行了。这样做会让 `Panel` 的 Hook 运行在 `Page` 当前的执行上下文中，破坏组件边界和状态身份。

如果 `Panel` 是组件，应使用 JSX：

```tsx
function Page() {
  return <Panel />;
}
```

如果它只是一个纯计算函数，就不要在其中调用 Hook：

```tsx
function createPanelTitle(user: User) {
  return `${user.name} 的面板`;
}
```

## 6.4 Hook 链表的运行模型

### 6.4.1 Fiber 上保存第一个 Hook

对于函数组件，Fiber 的 `memoizedState` 可以理解为指向第一个 Hook：

```text
fiber.memoizedState
  ↓
Hook 1 → Hook 2 → Hook 3 → null
```

一个简化版 Hook 节点可以写成：

```ts
type Hook = {
  memoizedState: unknown;
  baseState: unknown;
  baseQueue: unknown;
  queue: unknown;
  next: Hook | null;
};
```

这些字段不是每一种 Hook 都以相同方式使用：

- `useState` 会把当前状态和更新队列放在相关字段中；
- `useReducer` 也会保存状态和队列；
- `useRef` 的 `memoizedState` 通常是稳定的 `{ current }` 对象；
- `useMemo` 会保存计算值和依赖数组；
- `useEffect` 会保存 Effect 描述和依赖信息。

`next` 把多个 Hook 串成一条链表。

### 6.4.2 Render 阶段维护两个指针

React 在执行函数组件时，需要同时处理当前 Fiber 上已有的 Hook 链表和本次渲染要生成的 Hook 链表。可以用两个指针理解：

```text
currentHook  → 当前已提交 Fiber 上的旧 Hook
workInProgressHook → 正在构建的新 Hook
```

首次渲染时：

```text
旧链表：通常没有可复用的 Hook
新链表：按调用顺序创建 Hook 1、Hook 2、Hook 3
```

更新渲染时：

```text
旧链表：Hook 1 → Hook 2 → Hook 3
新链表：按同样顺序读取并克隆或复用对应记录
```

组件函数每调用一次 Hook，React 的当前 Dispatcher 就会把指针移动到下一个位置。

### 6.4.3 伪代码表示 Hook 读取

下面是帮助理解的伪代码：

```ts
let currentHook: Hook | null = null;
let workInProgressHook: Hook | null = null;

function mountWorkInProgressHook() {
  const hook: Hook = {
    memoizedState: null,
    baseState: null,
    baseQueue: null,
    queue: null,
    next: null,
  };

  if (workInProgressHook === null) {
    currentlyRenderingFiber.memoizedState = hook;
  } else {
    workInProgressHook.next = hook;
  }

  workInProgressHook = hook;
  return hook;
}

function updateWorkInProgressHook() {
  const nextCurrentHook = currentHook?.next ?? null;
  const hook = cloneHook(currentHook);

  if (workInProgressHook === null) {
    currentlyRenderingFiber.memoizedState = hook;
  } else {
    workInProgressHook.next = hook;
  }

  currentHook = nextCurrentHook;
  workInProgressHook = hook;
  return hook;
}
```

这不是 React 的完整实现，但它表达了三个核心事实：

1. Hook 记录按调用顺序创建或读取；
2. 每个 Hook 通过 `next` 连接到下一个 Hook；
3. 调用顺序变化会导致旧记录和新调用错位。

### 6.4.4 Dispatcher 选择 Mount 或 Update

组件执行时，React 会根据当前是否存在可复用的 Hook 记录，选择不同的 Dispatcher：

```text
首次渲染
  ↓
HooksDispatcherOnMount
  ↓
mountState、mountEffect、mountRef

后续渲染
  ↓
HooksDispatcherOnUpdate
  ↓
updateState、updateEffect、updateRef
```

开发环境还会有用于额外校验的 Dispatcher，例如检查 Hook 顺序是否发生变化。

可以用简化对象表示：

```ts
const HooksDispatcherOnMount = {
  useState: mountState,
  useEffect: mountEffect,
  useRef: mountRef,
};

const HooksDispatcherOnUpdate = {
  useState: updateState,
  useEffect: updateEffect,
  useRef: updateRef,
};
```

因此，开发者写的 `useState` 并不是直接执行同一个固定函数。它会通过当前 Dispatcher 进入挂载或更新路径。

### 6.4.5 `renderWithHooks` 是重要入口

从源码阅读角度，可以先记住这条入口：

```text
updateFunctionComponent
  ↓
renderWithHooks
  ↓
执行函数组件
  ↓
组件内部调用 useState、useEffect、useRef
  ↓
Dispatcher 分发到 mount 或 update 实现
```

可以把 `renderWithHooks` 理解为一个运行环境准备器，它负责：

- 设置当前正在渲染的 Fiber；
- 重置或准备 Hook 指针；
- 设置当前 Hooks Dispatcher；
- 执行函数组件；
- 完成 Hook 链表的切换和检查。

具体函数名、文件路径和字段可能随着 React 版本和构建产物变化。阅读源码时应先确认所看的分支和版本。

## 6.5 `useState`、`useEffect` 和 `useRef` 如何共存

### 6.5.1 它们共享调用顺序

```tsx
function ChatRoom() {
  const [messages, setMessages] = useState<Message[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = `${messages.length} 条消息`;
  }, [messages.length]);

  return <input ref={inputRef} />;
}
```

React 可以把这段代码看成：

```text
Hook 1：State，memoizedState = messages
Hook 2：Ref，memoizedState = { current: ... }
Hook 3：Effect，memoizedState = Effect 描述
```

Hook 的具体类型不由链表节点的 `next` 字段表示，而是由当前调用的 Hook API 和对应 Dispatcher 逻辑决定。

### 6.5.2 `useState` 保存会影响视图的值

```tsx
const [count, setCount] = useState(0);
```

调用 `setCount` 会：

```text
创建 Update
  ↓
加入 State Hook 的更新队列
  ↓
调度当前 Fiber 更新
  ↓
下一轮 Render 计算 State
```

State 的变化会参与下一次 UI 计算。

### 6.5.3 `useRef` 保存稳定对象

```tsx
const inputRef = useRef<HTMLInputElement>(null);
```

多次渲染之间，`inputRef` 对象本身保持稳定：

```text
Render 1 → ref 对象 A
Render 2 → ref 对象 A
Render 3 → ref 对象 A
```

修改：

```tsx
inputRef.current?.focus();
```

通常不会因为 `.current` 改变而自动触发重新渲染。它适合保存：

- DOM 节点；
- 定时器 ID；
- 最近一次值；
- 不需要直接显示在 UI 中的可变对象。

### 6.5.4 `useEffect` 保存副作用描述

```tsx
useEffect(() => {
  const connection = connect(roomId);
  return () => connection.disconnect();
}, [roomId]);
```

Effect 的依赖数组决定 React 是否需要在新的依赖值下重新安排 Effect。组件执行阶段主要计算和记录描述，Effect 的创建函数和清理函数会在 React 的相应提交流程中运行。

不要把 `useEffect` 理解成“组件函数执行到这里就立即执行回调”。函数渲染、DOM 提交、Effect 执行属于不同阶段。

### 6.5.5 三种 Hook 的选择

可以按下面的问题选择：

```text
这个值变化后需要重新计算 UI 吗？
  是 → useState 或 useReducer
  否 ↓
这个值需要在多次渲染间保持同一个对象吗？
  是 → useRef
  否 ↓
这是与外部系统同步的副作用吗？
  是 → useEffect 或其他 Effect API
  否 → 先考虑普通变量或普通函数
```

不要因为“数据会变化”就全部放入 State。需要触发 UI 更新、参与渲染输出，才是使用 State 的重要理由。

## 6.6 自定义 Hook 的本质

### 6.6.1 自定义 Hook 是函数逻辑的组合

自定义 Hook 本身不是一种新的运行时对象。它通常只是一个调用其他 Hook 的函数：

```tsx
function useCounter(initialValue = 0) {
  const [count, setCount] = useState(initialValue);

  const increment = () => {
    setCount((value) => value + 1);
  };

  const decrement = () => {
    setCount((value) => value - 1);
  };

  return { count, increment, decrement };
}
```

组件使用它：

```tsx
function CounterPanel() {
  const { count, increment, decrement } = useCounter(10);

  return (
    <div>
      <p>{count}</p>
      <button type="button" onClick={decrement}>-</button>
      <button type="button" onClick={increment}>+</button>
    </div>
  );
}
```

调用链可以展开成：

```text
CounterPanel
  ↓
useCounter
  ↓
useState
```

React 最终仍然需要按照稳定顺序记录 `useCounter` 内部调用的每个 Hook。

### 6.6.2 自定义 Hook 复用逻辑，不共享 State

两个组件分别调用同一个自定义 Hook：

```tsx
function LeftCounter() {
  const { count, increment } = useCounter();
  return <button onClick={increment}>左侧：{count}</button>;
}

function RightCounter() {
  const { count, increment } = useCounter();
  return <button onClick={increment}>右侧：{count}</button>;
}
```

它们复用的是代码和行为，拥有的是两份独立 State：

```text
LeftCounter Fiber
└─ useCounter 的 Hook 链表
   └─ count = 0

RightCounter Fiber
└─ useCounter 的 Hook 链表
   └─ count = 0
```

点击左侧按钮不会直接改变右侧计数。要共享数据，需要使用：

- 共同父组件提升 State；
- Context；
- 外部 Store；
- URL、服务端缓存或其他共享数据源。

### 6.6.3 自定义 Hook 不需要返回固定格式

自定义 Hook 可以返回值、对象、数组或行为函数：

```tsx
function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
```

```tsx
function useToggle(initialValue = false) {
  const [value, setValue] = useState(initialValue);
  return [value, () => setValue((current) => !current)] as const;
}
```

```tsx
function useUserQuery(userId: string) {
  const [state, setState] = useState({
    data: null as User | null,
    loading: true,
    error: null as Error | null,
  });

  return state;
}
```

关键是接口要表达业务意图，内部 Hook 的细节不必暴露给调用方。

### 6.6.4 自定义 Hook 的边界

一个好的自定义 Hook 通常有明确的责任：

```text
输入：依赖、配置和事件
处理：状态、订阅、请求或副作用
输出：UI 所需数据和稳定操作
```

例如：

```tsx
function useDebouncedValue<T>(value: T, delay: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}
```

调用方只需要知道：输入一个变化中的值，得到一个延迟后的值。定时器的创建、清理和 State 管理由 Hook 负责。

## 6.7 闭包与 stale closure

### 6.7.1 闭包会保存创建时能看到的变量

JavaScript 函数会捕获它创建时所在作用域中的变量：

```tsx
function createLogger(value: number) {
  return () => {
    console.log(value);
  };
}

const log = createLogger(1);
log(); // 1
```

React 函数组件每次渲染都会重新执行，因此每次执行都产生新的局部变量和新的函数：

```text
Render 1
  count = 0
  handleClick_1 捕获 count = 0

Render 2
  count = 1
  handleClick_2 捕获 count = 1
```

`handleClick_1` 不会自动变成 `handleClick_2`。

### 6.7.2 定时器中的旧值

```tsx
function Counter() {
  const [count, setCount] = useState(0);

  function scheduleLog() {
    setTimeout(() => {
      console.log(count);
    }, 1000);
  }

  return <button onClick={scheduleLog}>{count}</button>;
}
```

如果点击时 `count` 是 0，随后又点击了增加按钮，1 秒后这个定时器仍可能输出 0。因为回调属于点击时创建的那次渲染。

如果需求是“基于当前状态增加”，可以使用函数式更新：

```tsx
setTimeout(() => {
  setCount((value) => value + 1);
}, 1000);
```

但如果需求是“读取稍后时刻的最新值”，函数式更新不一定适合，因为它只用于计算下一状态。此时可以使用 Ref 保存最新值。

### 6.7.3 用 Ref 读取最新值

```tsx
function Counter() {
  const [count, setCount] = useState(0);
  const countRef = useRef(count);

  useEffect(() => {
    countRef.current = count;
  }, [count]);

  function logLater() {
    setTimeout(() => {
      console.log('稍后读取：', countRef.current);
    }, 1000);
  }

  return (
    <div>
      <p>{count}</p>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        增加
      </button>
      <button type="button" onClick={logLater}>
        延迟读取
      </button>
    </div>
  );
}
```

这个模式的关键是：

- State 负责驱动画面；
- Ref 保存可以被异步回调读取的最新引用；
- Ref 的更新本身不会触发渲染。

如果要求“状态变化时立即同步写入 Ref”，也可以在计算下一值时同时写入，但要明确这属于手动同步：

```tsx
function increment() {
  setCount((current) => {
    const next = current + 1;
    countRef.current = next;
    return next;
  });
}
```

实际代码还要考虑多个更新、并发渲染和是否允许在更新函数中执行额外副作用。更稳妥的通用做法通常是使用 Effect 同步 Ref，或者使用专门封装好的 Hook。

### 6.7.4 Effect 中的旧值

下面的 Effect 只在挂载时执行：

```tsx
useEffect(() => {
  console.log('当前用户：', user);
}, []);
```

如果 `user` 后续变化，这个 Effect 不会自动重新创建，因此它捕获的可能是初始值。

如果 Effect 的逻辑依赖 `user`，应把它写入依赖数组：

```tsx
useEffect(() => {
  console.log('当前用户：', user);
}, [user]);
```

依赖数组描述的是 Effect 代码读取的响应式值。它不是一个“想运行几次就写几个值”的配置列表。

### 6.7.5 事件处理函数与 Effect 的区别

事件处理函数通常响应用户触发的具体动作：

```tsx
function handleSubmit() {
  saveDraft(form);
}
```

Effect 通常用于把组件状态同步到外部系统：

```tsx
useEffect(() => {
  const subscription = subscribe(roomId, handleMessage);
  return () => subscription.unsubscribe();
}, [roomId, handleMessage]);
```

如果一段逻辑只由点击、提交、拖拽等明确交互触发，优先写在事件处理函数中。不要为了“让代码自动运行”而把所有业务逻辑都塞进 Effect。

## 6.8 依赖数组和稳定性

### 6.8.1 依赖是重新同步的条件

```tsx
useEffect(() => {
  const connection = createConnection(serverUrl, roomId);
  connection.connect();

  return () => connection.disconnect();
}, [serverUrl, roomId]);
```

当 `serverUrl` 或 `roomId` 改变时，React 需要清理旧连接，并创建新连接。

如果漏写 `roomId`：

```tsx
useEffect(() => {
  const connection = createConnection(serverUrl, roomId);
  connection.connect();
  return () => connection.disconnect();
}, [serverUrl]);
```

Effect 可能继续使用旧的 `roomId`，导致显示的房间和实际连接的房间不一致。

### 6.8.2 对象和函数依赖的引用变化

依赖数组使用的是引用比较语义。下面的对象每次组件执行都可能是新引用：

```tsx
const options = { roomId, serverUrl };

useEffect(() => {
  connect(options);
  return () => disconnect(options);
}, [options]);
```

即使字段值相同，`options` 的引用也可能变化，导致 Effect 反复执行。

可以把创建对象的逻辑放进 Effect，并依赖原始值：

```tsx
useEffect(() => {
  const options = { roomId, serverUrl };
  connect(options);
  return () => disconnect(options);
}, [roomId, serverUrl]);
```

或者使用 `useMemo` 保持对象引用，但只有在对象确实需要作为稳定输入传递时才这样做：

```tsx
const options = useMemo(
  () => ({ roomId, serverUrl }),
  [roomId, serverUrl],
);
```

### 6.8.3 `useCallback` 不是自动修复闭包

```tsx
const handleSave = useCallback(() => {
  save(form);
}, [form]);
```

这段代码会让函数引用在 `form` 不变时保持稳定，但闭包仍然捕获依赖数组对应的 `form`。

如果漏掉 `form`：

```tsx
const handleSave = useCallback(() => {
  save(form);
}, []);
```

就可能得到稳定但过时的函数。稳定引用和最新数据是两个不同问题：

```text
useCallback 解决：函数引用是否变化
依赖数组解决：闭包中的值何时更新
useRef 解决：异步代码如何读取一个稳定容器中的最新值
```

不要为了消除某次重新渲染而随意删除依赖。

## 6.9 Hooks 规则的静态检查

### 6.9.1 ESLint 能检查调用结构

React 项目通常会启用 Hooks 相关的 ESLint 规则。它可以发现：

```tsx
if (enabled) {
  useState(0);
}
```

也可以发现：

```tsx
function helper() {
  useEffect(() => {}, []);
}
```

常见规则包括：

```text
react-hooks/rules-of-hooks
react-hooks/exhaustive-deps
```

第一条主要检查 Hook 调用位置和顺序风险，第二条主要检查 Effect 等 Hook 的依赖是否完整。

### 6.9.2 静态检查不是运行时证明

Lint 工具不能证明业务逻辑一定正确。例如下面代码结构合法，但可能有竞态：

```tsx
useEffect(() => {
  fetch(`/api/users/${userId}`)
    .then((response) => response.json())
    .then(setUser);
}, [userId]);
```

如果 `userId` 快速变化，旧请求可能晚于新请求返回，并覆盖新用户数据。需要额外的取消或请求序列控制：

```tsx
useEffect(() => {
  const controller = new AbortController();
  let active = true;

  async function loadUser() {
    const response = await fetch(`/api/users/${userId}`, {
      signal: controller.signal,
    });
    const data: User = await response.json();

    if (active) {
      setUser(data);
    }
  }

  loadUser().catch((error: unknown) => {
    if ((error as { name?: string }).name !== 'AbortError' && active) {
      setError(error as Error);
    }
  });

  return () => {
    active = false;
    controller.abort();
  };
}, [userId]);
```

规则检查保证代码更符合 Hook 的调用模型，业务正确性仍然需要通过状态机、取消策略和测试来验证。

### 6.9.3 不要用注释压掉依赖警告

下面的做法会隐藏真实问题：

```tsx
// eslint-disable-next-line react-hooks/exhaustive-deps
useEffect(() => {
  connect(roomId);
}, []);
```

如果确实只需要初始化一次，应明确设计这个 Effect 的输入，或者把初始化放到模块级、事件处理函数或专门的数据层。删除警告之前，先回答：

```text
这个 Effect 读取了哪些值？
这些值变化后，外部系统是否需要重新同步？
如果不需要，为什么？
```

## 6.10 常见自定义 Hook 实例

### 6.10.1 `useOnlineStatus`

一个订阅浏览器在线状态的 Hook：

```tsx
function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
    }

    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
```

使用：

```tsx
function SaveButton() {
  const isOnline = useOnlineStatus();

  return (
    <button type="button" disabled={!isOnline}>
      {isOnline ? '保存' : '等待网络'}
    </button>
  );
}
```

这个 Hook 的责任边界很清楚：订阅浏览器网络状态，并向组件返回当前状态。

### 6.10.2 `useEventListener`

可以把事件订阅进一步抽象：

```tsx
function useEventListener<K extends keyof WindowEventMap>(
  eventName: K,
  handler: (event: WindowEventMap[K]) => void,
) {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const listener = (event: WindowEventMap[K]) => {
      handlerRef.current(event);
    };

    window.addEventListener(eventName, listener as EventListener);
    return () => {
      window.removeEventListener(eventName, listener as EventListener);
    };
  }, [eventName]);
}
```

这个实现把两个问题分开：

- 事件类型变化时，重新建立浏览器订阅；
- 回调函数变化时，只更新 Ref，不反复添加和移除事件监听器。

这种模式适合高频变化的回调，但应避免把 Ref 当成所有闭包问题的默认答案。先判断外部订阅是否真的需要稳定监听器。

### 6.10.3 `useAsync`

可以把异步状态抽象为有限状态：

```tsx
type AsyncState<T> =
  | { status: 'idle'; data: null; error: null }
  | { status: 'pending'; data: null; error: null }
  | { status: 'success'; data: T; error: null }
  | { status: 'error'; data: null; error: Error };
```

使用 `useReducer` 管理状态转换：

```tsx
type AsyncAction<T> =
  | { type: 'start' }
  | { type: 'success'; data: T }
  | { type: 'error'; error: Error };

function asyncReducer<T>(
  state: AsyncState<T>,
  action: AsyncAction<T>,
): AsyncState<T> {
  switch (action.type) {
    case 'start':
      return { status: 'pending', data: null, error: null };
    case 'success':
      return { status: 'success', data: action.data, error: null };
    case 'error':
      return { status: 'error', data: null, error: action.error };
  }
}
```

自定义 Hook：

```tsx
function useAsync<T>(load: () => Promise<T>) {
  const [state, dispatch] = useReducer(asyncReducer<T>, {
    status: 'idle',
    data: null,
    error: null,
  });

  const run = useCallback(async () => {
    dispatch({ type: 'start' });

    try {
      const data = await load();
      dispatch({ type: 'success', data });
      return data;
    } catch (error) {
      const normalizedError = error instanceof Error
        ? error
        : new Error('请求失败');
      dispatch({ type: 'error', error: normalizedError });
      throw normalizedError;
    }
  }, [load]);

  return { ...state, run };
}
```

这个例子还暴露了一个设计问题：如果 `load` 每次渲染都是新函数，`run` 也会随之变化。调用方可以使用 `useCallback`，或者 Hook 内部只接收稳定的请求参数并自行创建请求逻辑。

## 6.11 真实场景：表单 Hook

### 6.11.1 把字段更新封装起来

```tsx
type ProfileForm = {
  name: string;
  email: string;
};

function useProfileForm(initialValue: ProfileForm) {
  const [form, setForm] = useState(initialValue);

  function updateField<K extends keyof ProfileForm>(
    key: K,
    value: ProfileForm[K],
  ) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function reset() {
    setForm(initialValue);
  }

  const isValid = form.name.trim().length > 0
    && form.email.includes('@');

  return {
    form,
    updateField,
    reset,
    isValid,
  };
}
```

调用方：

```tsx
function ProfileEditor() {
  const {
    form,
    updateField,
    reset,
    isValid,
  } = useProfileForm({ name: '', email: '' });

  return (
    <form>
      <input
        value={form.name}
        onChange={(event) => updateField('name', event.target.value)}
      />
      <input
        value={form.email}
        onChange={(event) => updateField('email', event.target.value)}
      />
      <button type="submit" disabled={!isValid}>
        保存
      </button>
      <button type="button" onClick={reset}>
        重置
      </button>
    </form>
  );
}
```

### 6.11.2 Hook 需要处理初始值变化吗

上面的 Hook 只把 `initialValue` 用作第一次 State 初始化和 `reset` 的目标。如果父组件后续传入了新对象，已有表单不会自动覆盖。

这是一个需要明确的产品决策：

```text
initialValue 是“只在首次挂载时使用”的初始值？
还是“外部数据变化后，表单也要重置”的同步值？
```

如果确实要同步外部值，可以显式提供方法：

```tsx
function useProfileForm(initialValue: ProfileForm) {
  const [form, setForm] = useState(initialValue);

  function replaceForm(nextValue: ProfileForm) {
    setForm(nextValue);
  }

  return { form, replaceForm };
}
```

调用方在加载新用户后主动执行 `replaceForm`，比隐藏在 Effect 中自动覆盖用户正在编辑的内容更容易理解。

## 6.12 真实场景：SSE 和异步消息

### 6.12.1 订阅对象必须清理

```tsx
function useMessageStream(url: string) {
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    const source = new EventSource(url);

    function handleMessage(event: MessageEvent<string>) {
      const message = JSON.parse(event.data) as Message;
      setMessages((current) => [...current, message]);
    }

    source.addEventListener('message', handleMessage);

    return () => {
      source.removeEventListener('message', handleMessage);
      source.close();
    };
  }, [url]);

  return messages;
}
```

这里有三个关键点：

1. `url` 变化时，旧连接需要关闭；
2. 每条消息使用函数式更新，避免快速消息到达时覆盖旧数组；
3. 清理函数必须移除监听器并关闭连接。

### 6.12.2 防止旧请求覆盖新请求

```tsx
function useSearchResults(query: string) {
  const [state, setState] = useState({
    data: [] as Result[],
    loading: false,
    error: null as Error | null,
  });

  useEffect(() => {
    if (!query.trim()) {
      setState({ data: [], loading: false, error: null });
      return;
    }

    const controller = new AbortController();
    let active = true;

    setState((current) => ({
      ...current,
      loading: true,
      error: null,
    }));

    fetch(`/api/search?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`请求失败：${response.status}`);
        }
        return response.json() as Promise<Result[]>;
      })
      .then((data) => {
        if (active) {
          setState({ data, loading: false, error: null });
        }
      })
      .catch((error: unknown) => {
        if (active && (error as { name?: string }).name !== 'AbortError') {
          setState({
            data: [],
            loading: false,
            error: error instanceof Error ? error : new Error('搜索失败'),
          });
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [query]);

  return state;
}
```

这里的 `active` 变量属于当前 Effect 执行创建的闭包。清理旧 Effect 时把它设置为 `false`，可以阻止旧请求的回调提交结果。

对于更复杂的请求缓存、重试、去重和分页，通常应使用专门的数据请求库或服务端缓存方案。自定义 Hook 适合封装明确范围内的同步和状态转换。

## 6.13 源码阅读：从 `useState` 追踪到 Hook 链表

### 6.13.1 公共 API 只是入口

业务代码写的是：

```tsx
const [count, setCount] = useState(0);
```

阅读源码时，可以沿着以下方向寻找：

```text
react 包导出的 useState
  ↓
resolveDispatcher()
  ↓
当前 Dispatcher.useState
  ↓
mountState 或 updateState
  ↓
mountWorkInProgressHook 或 updateWorkInProgressHook
```

`resolveDispatcher` 的意义是：公共 Hook API 不直接决定当前是首次渲染还是后续更新，而是从当前 React 渲染上下文中取得 Dispatcher。

### 6.13.2 首次渲染路径

首次调用 `useState` 的简化路径：

```text
renderWithHooks
  ↓
设置 Mount Dispatcher
  ↓
useState(initialState)
  ↓
mountState
  ↓
mountStateImpl
  ↓
创建 Hook
  ↓
保存初始 memoizedState
  ↓
创建 queue
  ↓
创建 dispatch
  ↓
返回 [state, dispatch]
```

队列大致包含：

```text
queue
├─ pending：待处理更新
├─ dispatch：提交更新的函数
├─ lanes：相关优先级信息
└─ lastRenderedReducer：状态处理函数
```

不同 React 版本的具体字段可能不同，应以目标版本源码为准。

### 6.13.3 更新渲染路径

更新时：

```text
renderWithHooks
  ↓
设置 Update Dispatcher
  ↓
useState(initialState)
  ↓
updateState
  ↓
updateReducer
  ↓
updateWorkInProgressHook
  ↓
读取待处理更新
  ↓
根据当前渲染优先级处理队列
  ↓
保存新的 memoizedState
  ↓
返回 [state, dispatch]
```

`useState` 的更新实现和 `useReducer` 共享大量机制。可以把 `useState` 理解为使用内置基础 Reducer 的一种简化状态 API：

```ts
function basicStateReducer<S>(
  state: S,
  action: S | ((state: S) => S),
): S {
  return typeof action === 'function'
    ? (action as (state: S) => S)(state)
    : action;
}
```

### 6.13.4 调用 Setter 的路径

调用：

```tsx
setCount((value) => value + 1);
```

可以沿着这条简化链路理解：

```text
dispatchSetState
  ↓
requestUpdateLane
  ↓
创建 Update
  ↓
将 Update 加入并发更新队列
  ↓
标记 Fiber 和 Root 的更新
  ↓
scheduleUpdateOnFiber
  ↓
进入调度和 Render
```

在并发模式下，更新可能经过更多队列和优先级处理。理解 Hook 链表时，先抓住“创建记录、加入队列、调度 Fiber、下一轮读取”这条主线即可。

### 6.13.5 为什么源代码不能直接当成 API 文档

源码中的函数名和字段适合回答“React 大致如何实现”，但不适合直接作为业务契约：

- 内部字段可能在小版本中改变；
- 开发环境和生产环境路径不同；
- React Compiler、并发特性和新 API 可能增加新的处理层；
- 构建产物可能经过压缩和分支裁剪。

阅读源码时，应把稳定的行为模型和容易变化的实现细节分开记录。

## 6.14 常见错误与修复方式

### 6.14.1 把 Hook 放进条件分支

错误：

```tsx
if (user) {
  useEffect(() => {
    loadProfile(user.id);
  }, [user]);
}
```

修复：

```tsx
useEffect(() => {
  if (!user) {
    return;
  }

  loadProfile(user.id);
}, [user]);
```

### 6.14.2 省略依赖数组中的业务输入

错误：

```tsx
useEffect(() => {
  fetchUser(userId);
}, []);
```

修复：

```tsx
useEffect(() => {
  fetchUser(userId);
}, [userId]);
```

### 6.14.3 把派生值存入 State

错误：

```tsx
const [firstName, setFirstName] = useState('Lin');
const [lastName, setLastName] = useState('Chen');
const [fullName, setFullName] = useState('Lin Chen');
```

推荐：

```tsx
const [firstName, setFirstName] = useState('Lin');
const [lastName, setLastName] = useState('Chen');
const fullName = `${firstName} ${lastName}`;
```

### 6.14.4 为了引用稳定而过度使用 `useCallback`

错误倾向：

```tsx
const handleChange = useCallback((value: string) => {
  setValue(value);
}, []);
```

如果这个函数只在当前组件内部使用，并没有传给需要引用比较的子组件或 Hook，`useCallback` 可能只增加阅读成本。

可以直接写：

```tsx
function handleChange(value: string) {
  setValue(value);
}
```

优化 Hook 应该有明确目的，例如减少 `memo` 子组件的无效更新、稳定 Effect 依赖或满足外部订阅接口。

### 6.14.5 用 Ref 逃避所有依赖问题

错误倾向：

```tsx
const valueRef = useRef(value);
valueRef.current = value;

useEffect(() => {
  externalSystem.connect(() => {
    console.log(valueRef.current);
  });
}, []);
```

这种写法有时有效，但会让代码绕过普通依赖关系。使用前要确认：

- 外部订阅确实应该只建立一次；
- 回调读取最新值是需求；
- Ref 的同步时机符合业务要求；
- 清理逻辑不会读取错误的连接或配置。

### 6.14.6 在 Render 阶段执行副作用

错误：

```tsx
function Component() {
  document.title = '页面标题';
  sendAnalyticsEvent();
  return null;
}
```

Render 可能因为并发、优先级变化或开发环境检查而执行多次，不能把需要执行一次或需要清理的副作用直接放在组件函数体中。

可以根据行为类型选择：

```tsx
useEffect(() => {
  document.title = '页面标题';
}, []);
```

用户点击触发的统计则更适合写进事件处理函数：

```tsx
function handleClick() {
  sendAnalyticsEvent();
  setOpen(true);
}
```

## 6.15 设计可靠 Hook 的方法

### 6.15.1 先确定外部系统

写 Effect 或自定义 Hook 前，先明确它同步的外部系统：

```text
浏览器事件 → addEventListener / removeEventListener
网络连接 → connect / disconnect
定时器 → setTimeout / clearTimeout
DOM API → 创建或测量 / 清理或更新
服务端请求 → 请求 / 取消或忽略过期响应
```

如果找不到要同步的外部系统，可能只需要普通计算或事件处理函数，而不需要 Effect。

### 6.15.2 输入和输出要明确

例如 `useDebouncedValue`：

```text
输入：value、delay
内部：timer、清理、延迟提交 State
输出：debouncedValue
```

例如 `useOnlineStatus`：

```text
输入：无
内部：浏览器 online/offline 订阅
输出：isOnline
```

边界越清楚，依赖数组和清理责任越容易验证。

### 6.15.3 把状态转换写成可检查的模型

对于复杂业务，先列出状态：

```text
idle → loading → success
idle → loading → error
success → loading
error → loading
```

再决定使用多个 `useState` 还是 `useReducer`。如果多个 State 必须一起变化，`useReducer` 通常更容易保证状态转换完整：

```tsx
type State =
  | { status: 'idle'; data: null }
  | { status: 'loading'; data: null }
  | { status: 'success'; data: Data }
  | { status: 'error'; data: null; error: Error };
```

### 6.15.4 让返回的操作具有稳定语义

自定义 Hook 返回的函数是否需要稳定引用，应由调用方的使用方式决定：

```tsx
function useToggle(initialValue = false) {
  const [value, setValue] = useState(initialValue);

  const toggle = useCallback(() => {
    setValue((current) => !current);
  }, []);

  return { value, toggle };
}
```

这里 `toggle` 使用函数式更新，不依赖当前 `value`，因此可以使用空依赖数组。稳定性来自明确的依赖分析，而不是机械地给所有函数加 `useCallback`。

### 6.15.5 让清理函数与创建函数成对出现

```tsx
useEffect(() => {
  const timer = window.setInterval(refresh, interval);

  return () => {
    window.clearInterval(timer);
  };
}, [refresh, interval]);
```

可以把每个 Effect 检查成一组问题：

```text
创建了什么资源？
资源属于哪个依赖版本？
依赖变化时如何销毁旧资源？
组件卸载时是否能完整清理？
异步回调返回后，结果是否仍然有效？
```

## 6.16 React 18/19 与 Hooks 的注意事项

### 6.16.1 Strict Mode 开发检查

在开发环境的 Strict Mode 下，React 可能对某些初始化逻辑和 Effect 执行进行额外检查，以帮助发现不纯的 Render 和缺少清理的问题。

因此，以下代码必须能够安全地重复初始化和清理：

```tsx
useEffect(() => {
  const connection = connect(roomId);

  return () => {
    connection.disconnect();
  };
}, [roomId]);
```

如果重复执行导致重复订阅，通常说明清理函数不完整，或者 Effect 承担了不应承担的全局一次性初始化。

### 6.16.2 并发渲染要求 Render 保持纯净

Render 阶段可能被暂停、重新开始或放弃。组件函数和 Hook 的计算部分应尽量保持纯净：

```tsx
function Price({ value }: { value: number }) {
  const formatted = formatPrice(value);
  return <span>{formatted}</span>;
}
```

不要在 Render 阶段：

- 修改外部模块变量；
- 写入 DOM；
- 发起不可取消的请求；
- 注册事件监听器；
- 修改其他组件的 State。

需要与外部系统同步时，应使用合适的 Effect 或事件处理函数。

### 6.16.3 React 19 的新 API 不改变基础规则

React 19 增加了 Actions、表单相关能力和其他新 API。无论使用哪种 API，Hook 的基本模型仍然成立：

- Hook 需要在合法的组件或自定义 Hook 中调用；
- Hook 的调用顺序需要稳定；
- Render 应保持纯净；
- 与外部系统同步需要处理生命周期和清理。

新 API 可以减少部分手动状态管理，但不会让条件 Hook、循环 Hook 或直接修改 State 变得安全。

## 6.17 官方行为、源码细节与工程结论

### 官方行为

可以依赖的行为模型包括：

- Hooks 只能在函数组件或自定义 Hook 的顶层调用；
- Hook 调用顺序需要在渲染之间保持一致；
- 自定义 Hook 复用逻辑，但每次调用拥有独立状态；
- `useState` 和 `useReducer` 的状态更新会触发组件更新；
- `useRef` 在多次渲染间返回稳定对象，修改 `.current` 通常不会触发渲染；
- Effect 需要根据依赖同步外部系统，并在清理函数中释放资源。

### 源码视角

阅读 React Hooks 实现时，可以先关注：

- `renderWithHooks`；
- `resolveDispatcher`；
- `HooksDispatcherOnMount`；
- `HooksDispatcherOnUpdate`；
- `mountWorkInProgressHook`；
- `updateWorkInProgressHook`；
- `mountState`；
- `updateState`；
- `updateReducer`；
- `mountEffect`；
- `updateEffect`；
- Fiber 的 `memoizedState`；
- Hook 的 `memoizedState`、`queue` 和 `next`。

这些名字帮助建立调用链，具体实现应以当前 React 版本源码为准。

### 工程结论

- Hook 顺序稳定是 React 能够复用内部记录的前提；
- 组件边界决定 State 和 Hook 链表的归属；
- 自定义 Hook 适合抽离状态逻辑、订阅和请求管理；
- 闭包中的值属于创建它的那次渲染；
- 函数式更新适合基于最新 State 计算下一 State；
- Ref 适合保存不直接驱动 UI 的稳定可变值；
- 依赖数组应描述真实的数据和外部同步关系；
- 清理函数应和订阅、定时器、连接、请求等资源成对设计；
- `useMemo` 和 `useCallback` 需要有明确的引用稳定目的；
- Render 代码应保持纯净，副作用应放在正确的生命周期边界。

## 6.18 面试重点：Hooks 的规则与本质

### 为什么 Hooks 不能写在条件判断中？

> React 会把函数组件对应的 Hook 记录按调用顺序连接在 Fiber 上。第一次渲染和后续渲染需要以相同顺序读取这些记录。如果 Hook 写在条件、循环或可能改变执行次数的嵌套函数中，调用位置就会变化，React 会把原本属于不同 Hook 的状态和副作用错位匹配。因此 Hooks 必须在组件或自定义 Hook 的顶层调用。

### React 如何区分多个 `useState`？

> React 不依赖变量名区分它们，而是依赖当前组件 Fiber 上的 Hook 链表和调用顺序。第一个 `useState` 对应第一个 Hook 节点，第二个 `useState` 对应第二个 Hook 节点。每次渲染按相同顺序读取，才能把记录对应回来。

### 自定义 Hook 是否共享 State？

> 自定义 Hook 复用的是逻辑代码。每个组件调用它时，内部 Hook 记录仍然挂在各自组件的 Fiber 上，因此每次调用拥有独立 State。要共享状态，需要提升 State、使用 Context、外部 Store 或其他共享数据源。

### 什么是 stale closure？

> stale closure 指异步回调、Effect 或事件函数捕获了某次旧渲染中的变量，之后即使组件产生了新渲染，旧函数仍然读取旧值。解决方式取决于需求：基于最新 State 计算时使用函数式更新；需要异步读取最新值时可以使用 Ref；Effect 依赖外部值时补全依赖并正确清理；用户交互触发的逻辑则放在事件处理函数中。

### `useRef` 和 `useState` 有什么区别？

> `useState` 的变化会进入 React 更新流程并参与下一次 UI 计算；`useRef` 返回一个跨渲染稳定的对象，修改 `.current` 通常不会触发重新渲染。需要显示到界面上的数据通常使用 State，需要保存 DOM、定时器 ID 或异步回调要读取的最新引用时可以使用 Ref。

### 为什么组件应该使用 `<Panel />`，而不是 `Panel()`？

> JSX 会让 React 为 `Panel` 建立独立的组件元素和 Fiber 身份，Panel 内部的 Hook 也会属于 Panel 自己。直接调用 `Panel()` 会把它当成普通函数执行，可能把内部 Hook 混入父组件的调用序列，破坏组件边界和状态归属。

### `useEffect` 的依赖数组应该怎么写？

> 依赖数组应该包含 Effect 代码读取并且会随渲染变化的值。它描述的是外部系统何时需要重新同步，而不是简单控制回调执行次数。依赖变化时，React 应先清理旧 Effect，再建立使用新依赖的 Effect。应根据真实逻辑处理依赖，而不是通过删除依赖警告来隐藏闭包或同步问题。

## 6.19 本章小结

1. Hook 是 React 为函数组件保存状态和副作用信息的内部记录；
2. 多个 Hook 通过 `next` 连接成挂在 Fiber 上的链表；
3. React 主要依靠 Hook 调用顺序识别每个 Hook 的身份；
4. 条件、循环和不稳定的嵌套调用会改变 Hook 顺序；
5. 首次渲染和后续更新会经过不同的 Mount、Update Dispatcher；
6. `useState`、`useEffect`、`useRef` 共用同一套调用顺序模型；
7. 自定义 Hook 复用逻辑，但每个组件调用拥有独立状态；
8. 闭包捕获的是创建它的那次渲染中的值；
9. 函数式更新、依赖数组和 Ref 分别解决不同类型的旧值问题；
10. Effect 应该同步外部系统，并提供与资源对应的清理函数；
11. Render 阶段需要保持纯净，不能随意执行副作用；
12. `useMemo` 和 `useCallback` 应该服务于明确的依赖和引用稳定需求。

可以把本章浓缩成一句话：

> Hooks 的本质是一组按调用顺序挂在组件 Fiber 上的运行时记录；稳定的调用顺序让 React 能够复用这些记录，而闭包和依赖关系决定了每次渲染中的逻辑是否能够看到正确的数据。

## 6.20 练习题与参考答案

### 练习 1：找出错误的 Hook 调用

下面代码有什么问题？

```tsx
function Panel({ enabled }: { enabled: boolean }) {
  if (enabled) {
    useEffect(() => {
      console.log('enabled');
    }, []);
  }

  const [count, setCount] = useState(0);
  return <button onClick={() => setCount((value) => value + 1)}>{count}</button>;
}
```

**参考答案：** `useEffect` 写在条件分支中。当 `enabled` 改变时，Hook 调用顺序发生变化，后面的 `useState` 可能被当成不同位置的 Hook。应该始终调用 Effect，把条件放进 Effect 内部：

```tsx
useEffect(() => {
  if (!enabled) {
    return;
  }

  console.log('enabled');
}, [enabled]);
```

### 练习 2：为什么两个组件的计数互不影响？

```tsx
function useCounter() {
  const [count, setCount] = useState(0);
  return { count, increment: () => setCount((value) => value + 1) };
}

function A() {
  const counter = useCounter();
  return <button onClick={counter.increment}>{counter.count}</button>;
}

function B() {
  const counter = useCounter();
  return <button onClick={counter.increment}>{counter.count}</button>;
}
```

**参考答案：** `A` 和 `B` 是两个不同的组件 Fiber。它们各自拥有自己的 Hook 链表，因此调用同一个自定义 Hook 只复用了逻辑，不会共享内部 State。

### 练习 3：修复 stale closure

```tsx
function Counter() {
  const [count, setCount] = useState(0);

  function addLater() {
    setTimeout(() => {
      setCount(count + 1);
    }, 1000);
  }

  return <button onClick={addLater}>{count}</button>;
}
```

要求：无论 1 秒内点击多少次，都让每个定时器各增加一次。

**参考答案：** 使用函数式更新：

```tsx
setTimeout(() => {
  setCount((value) => value + 1);
}, 1000);
```

这里要解决的是“基于当前状态计算下一状态”，因此函数式更新比读取定时器创建时的 `count` 更合适。

### 练习 4：选择 State 还是 Ref

以下数据分别更适合使用什么？

```text
输入框中要显示的文本
setInterval 返回的定时器 ID
当前是否展开菜单
异步回调需要读取的最新连接对象
```

**参考答案：**

```text
输入框中要显示的文本 → useState
定时器 ID → useRef
当前是否展开菜单 → useState
异步回调需要读取的最新连接对象 → useRef，或根据连接生命周期使用 Effect 管理
```

判断标准是：数据变化是否需要触发 UI 重新计算，以及数据是否需要在多次渲染间保持稳定引用。

### 练习 5：补全 Effect 依赖

```tsx
function Room({ roomId }: { roomId: string }) {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const connection = connect(roomId);
    connection.onChange(setConnected);
    return () => connection.disconnect();
  }, []);

  return <p>{connected ? '已连接' : '未连接'}</p>;
}
```

**参考答案：** Effect 读取了 `roomId`，因此至少应依赖 `roomId`：

```tsx
}, [roomId]);
```

同时要确认 `connect`、`onChange` 和 `disconnect` 的 API 是否稳定，以及清理函数是否能够移除订阅并关闭连接。

### 练习 6：面试表达

请用不超过 1 分钟回答“Hooks 为什么必须按顺序调用”。

**参考答案：**

> React 会把函数组件的 Hook 记录按调用顺序挂在对应 Fiber 上。第一次渲染时，第一个 Hook 创建第一个记录，第二个 Hook 创建第二个记录；后续渲染时 React 再按同样顺序读取这些记录。React 不依赖变量名识别 Hook。如果 Hook 放在条件、循环或不稳定的嵌套函数中，调用次数或位置就会变化，状态和 Effect 会错位。因此 Hooks 必须在组件或自定义 Hook 的顶层按固定顺序调用。

---

下一章将进入 **Fiber 的工作机制**，重点回答：

```text
为什么 React 需要 Fiber？
Fiber 节点保存了哪些信息？
Render 和 Commit 为什么要分开？
React 如何把组件树转换成可调度的工作单元？
```
