---
title: 第 11 章 useEffect
outline: deep
---

# 第 11 章 `useEffect`

`useEffect` 是 React 中最容易被滥用、也最容易产生闭包和竞态问题的 API 之一。

很多代码把它理解成：

```text
组件渲染完成后执行一段代码
```

这个理解还不够准确。更准确的模型是：

> Effect 用来把 React 状态与 React 外部的系统同步，并在依赖变化或组件卸载时清理旧同步关系。

“外部系统”包括：

- 浏览器事件监听器；
- 定时器；
- WebSocket、SSE 和其他连接；
- DOM 或第三方 UI 库；
- 网络请求的状态同步；
- 页面标题、媒体播放、地图实例等浏览器对象。

如果一段代码只是根据 Props 和 State 计算一个值，通常不需要 Effect。如果一段代码由用户点击直接触发，也通常优先放在事件处理函数中。

## 本章学习目标

学习完本章，你应该能够：

1. 区分 Render、Commit 和 Effect 的执行阶段；
2. 解释 `useEffect` 的依赖数组和闭包关系；
3. 理解清理函数的执行时机；
4. 处理请求取消和竞态响应；
5. 区分 `useEffect`、`useLayoutEffect` 和 `useInsertionEffect`；
6. 识别 Effect 无限循环和重复订阅问题；
7. 判断一段逻辑是否真的需要 Effect；
8. 设计可重复同步、可清理的自定义 Hook；
9. 理解 Strict Mode 开发检查对 Effect 的影响；
10. 从源码入口理解 Effect 如何进入 Fiber 的副作用链。

## 11.1 Effect 解决什么问题

### 11.1.1 Render 只负责计算 UI

```tsx
function Profile({ user }: { user: User }) {
  const label = `${user.name}（${user.role}）`;
  return <h1>{label}</h1>;
}
```

`label` 可以由当前输入直接计算，不需要 Effect：

```tsx
const label = `${user.name}（${user.role}）`;
```

如果写成：

```tsx
const [label, setLabel] = useState('');

useEffect(() => {
  setLabel(`${user.name}（${user.role}）`);
}, [user]);
```

就增加了一次状态同步和一次额外 Render，还可能在首次显示时得到旧的空字符串。

### 11.1.2 Effect 同步外部系统

```tsx
function DocumentTitle({ title }: { title: string }) {
  useEffect(() => {
    document.title = title;
  }, [title]);

  return null;
}
```

这里存在明确的外部系统：浏览器的 `document.title`。当 `title` 改变时，Effect 负责把新值同步出去。

### 11.1.3 事件处理函数与 Effect

按钮点击触发的动作应该写在事件处理函数中：

```tsx
function SaveButton({ form }: { form: FormState }) {
  function handleClick() {
    saveForm(form);
  }

  return <button onClick={handleClick}>保存</button>;
}
```

不要把“用户点击保存”写成：

```tsx
useEffect(() => {
  if (shouldSave) {
    saveForm(form);
  }
}, [shouldSave, form]);
```

如果保存的原因就是点击，事件处理函数更直接，也更容易避免重复保存。

### 11.1.4 Effect 的判断问题

写 Effect 前先问：

```text
这段代码是否要和 React 外部的系统同步？
```

如果答案是“否”，优先考虑：

```text
普通变量
派生计算
事件处理函数
useMemo
useReducer
```

## 11.2 Effect 的执行阶段

### 11.2.1 组件函数执行

```text
Render 阶段
  ↓
执行函数组件
  ↓
调用 useEffect
  ↓
记录 Effect 描述和依赖
```

调用 `useEffect` 时，回调通常不会在这一行立即执行。React 先把它记录到当前 Fiber 的 Hook 数据中。

### 11.2.2 DOM Commit

```text
Render 完成
  ↓
Commit Mutation
  ↓
DOM 插入、更新、删除
```

Effect 需要等待 React 完成对应的提交，才能和新的 UI 状态对应起来。

### 11.2.3 Passive Effect

普通 `useEffect` 属于 Passive Effect。React 会在提交后安排它运行：

```text
Commit 完成
  ↓
浏览器获得绘制机会或进入后续任务
  ↓
运行 Effect 创建函数
```

具体时间还会受到交互来源、同步刷新、浏览器调度和 React 版本影响。不要把它简化成永远严格的“下一帧之后”。稳定的行为模型是：它不属于组件 Render 的纯计算过程，而是在提交后的副作用阶段运行。

### 11.2.4 清理旧 Effect

当依赖变化时，React 通常会先清理上一个 Effect，再建立新的同步关系：

```text
旧依赖对应的 cleanup
  ↓
DOM 或相关提交完成
  ↓
新依赖对应的 setup
```

组件卸载时，也需要清理最后一次 Effect 创建的资源。

## 11.3 `useEffect` 的基本结构

### 11.3.1 没有依赖数组

```tsx
useEffect(() => {
  recordRender();
});
```

这表示每次组件提交后都可能重新同步。它适合极少数确实需要每次提交的场景，普通业务中很容易造成重复工作。

### 11.3.2 空依赖数组

```tsx
useEffect(() => {
  const connection = connect();
  return () => connection.disconnect();
}, []);
```

它表示 Effect 不依赖组件 Render 中变化的输入，通常在挂载后建立一次，在卸载时清理。

空数组不是“永远只执行一次”的通用承诺。开发环境 Strict Mode 可能额外执行一次 setup/cleanup 检查；如果组件真的卸载再挂载，也会重新执行。

### 11.3.3 指定依赖

```tsx
useEffect(() => {
  const connection = connect(roomId);
  return () => connection.disconnect();
}, [roomId]);
```

`roomId` 变化时，旧连接需要清理，新连接需要建立。

### 11.3.4 返回清理函数

```tsx
useEffect(() => {
  const timer = window.setInterval(refresh, 5000);

  return () => {
    window.clearInterval(timer);
  };
}, [refresh]);
```

清理函数应与 setup 创建的资源成对出现：

```text
addEventListener → removeEventListener
setInterval → clearInterval
connect → disconnect
observe → unobserve
```

## 11.4 依赖数组的真实含义

### 11.4.1 依赖描述同步输入

```tsx
useEffect(() => {
  connection.send({ roomId, token });
}, [connection, roomId, token]);
```

依赖数组描述 Effect 代码读取的、会随渲染变化的输入。当输入变化时，React 需要重新建立同步关系。

它不是一个“回调执行次数配置”：

```text
[]     → 不依赖变化的输入
[a]    → a 变化时重新同步
[a, b] → a 或 b 变化时重新同步
```

### 11.4.2 漏写依赖会产生旧闭包

```tsx
function UserPanel({ userId }: { userId: string }) {
  useEffect(() => {
    fetchUser(userId);
  }, []);

  return null;
}
```

如果 `userId` 改变，Effect 不会重新建立，代码可能一直使用首次 Render 捕获的旧值。

修复：

```tsx
useEffect(() => {
  fetchUser(userId);
}, [userId]);
```

### 11.4.3 依赖不是越少越好

错误倾向：

```tsx
useEffect(() => {
  saveDraft(form, userId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

先问清楚：

```text
form 改变后是否应该保存？
userId 改变后是否应该保存？
只在提交动作发生时保存，还是自动保存？
```

如果只在点击提交时保存，就把逻辑放进事件函数；如果是自动保存，就让 Effect 依赖真实输入，并配合防抖和取消策略。

### 11.4.4 对象依赖的引用变化

```tsx
function Room({ roomId }: { roomId: string }) {
  const options = { roomId };

  useEffect(() => {
    connect(options);
    return () => disconnect(options);
  }, [options]);

  return null;
}
```

`options` 每次 Render 都可能是新对象，因此 Effect 可能每次都重新运行。可以把对象放进 Effect：

```tsx
useEffect(() => {
  const options = { roomId };
  connect(options);
  return () => disconnect(options);
}, [roomId]);
```

或者只有在确实需要稳定对象时使用 `useMemo`。

### 11.4.5 函数依赖的引用变化

```tsx
function Page({ id }: { id: string }) {
  function load() {
    return fetch(`/api/items/${id}`);
  }

  useEffect(() => {
    load();
  }, [load]);

  return null;
}
```

`load` 每次 Render 都是新函数，Effect 会反复同步。通常可以把函数移进 Effect：

```tsx
useEffect(() => {
  function load() {
    return fetch(`/api/items/${id}`);
  }

  load();
}, [id]);
```

如果函数需要作为稳定 API 传递给子组件或外部系统，再考虑 `useCallback`。

## 11.5 清理函数的生命周期

### 11.5.1 依赖改变

```tsx
useEffect(() => {
  const subscription = subscribe(roomId, onMessage);
  return () => subscription.unsubscribe();
}, [roomId, onMessage]);
```

当 `roomId` 或 `onMessage` 变化时：

```text
清理旧订阅
建立新订阅
```

### 11.5.2 组件卸载

```text
组件从 Fiber 树删除
  ↓
执行相关 Effect 清理
  ↓
释放连接、监听器、定时器和资源
```

### 11.5.3 开发环境重复检查

Strict Mode 的开发检查可能表现为：

```text
setup
cleanup
setup
```

这不是生产环境中普通更新的固定行为，而是帮助发现：

- 清理函数缺失；
- setup 不是幂等的；
- 订阅重复注册；
- 全局资源没有正确释放。

正确的 Effect 应该能够安全地经历建立和清理。

### 11.5.4 清理函数不能返回 Promise

错误：

```tsx
useEffect(async () => {
  const data = await loadData();
  setData(data);
}, []);
```

Effect setup 应返回清理函数或 `undefined`，不能直接返回 Promise。正确写法：

```tsx
useEffect(() => {
  let active = true;

  async function load() {
    const data = await loadData();
    if (active) {
      setData(data);
    }
  }

  load();

  return () => {
    active = false;
  };
}, []);
```

更好的网络请求实现还应使用 `AbortController`。

## 11.6 请求、取消与竞态

### 11.6.1 竞态是怎样产生的

```tsx
useEffect(() => {
  fetch(`/api/users/${userId}`)
    .then((response) => response.json())
    .then(setUser);
}, [userId]);
```

用户快速切换：

```text
userId = A → 发出请求 A
userId = B → 发出请求 B
请求 B 先返回
请求 A 后返回
```

如果没有保护，旧请求 A 可能覆盖新用户 B 的数据。

### 11.6.2 使用 AbortController

```tsx
function useUser(userId: string) {
  const [state, setState] = useState<UserState>(initialState);

  useEffect(() => {
    const controller = new AbortController();

    setState({ data: null, loading: true, error: null });

    fetch(`/api/users/${userId}`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`请求失败：${response.status}`);
        }
        return response.json() as Promise<User>;
      })
      .then((data) => {
        setState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name === 'AbortError') {
          return;
        }

        setState({
          data: null,
          loading: false,
          error: error instanceof Error ? error : new Error('请求失败'),
        });
      });

    return () => controller.abort();
  }, [userId]);

  return state;
}
```

取消请求可以减少无效网络和解析工作，但也要确认服务端和请求库是否真的支持取消。

### 11.6.3 active 标记

```tsx
useEffect(() => {
  let active = true;

  loadData().then((data) => {
    if (active) {
      setData(data);
    }
  });

  return () => {
    active = false;
  };
}, [key]);
```

它可以防止旧回调提交结果，但不一定取消底层请求。实际项目中可以同时使用 active 标记和 AbortController。

### 11.6.4 请求序列号

```tsx
const requestIdRef = useRef(0);

useEffect(() => {
  const requestId = ++requestIdRef.current;

  loadData().then((data) => {
    if (requestId === requestIdRef.current) {
      setData(data);
    }
  });
}, [query]);
```

序列号适合无法取消的异步操作，但仍要考虑旧任务的资源消耗。

## 11.7 `useEffect`、`useLayoutEffect` 和 `useInsertionEffect`

### 11.7.1 `useEffect`

适合：

```text
网络请求状态同步
事件订阅
定时器
日志和非阻塞分析
页面标题
```

```tsx
useEffect(() => {
  document.title = title;
}, [title]);
```

### 11.7.2 `useLayoutEffect`

`useLayoutEffect` 在 DOM 提交后、浏览器绘制前的布局相关阶段运行。适合：

```text
读取 DOM 尺寸
同步测量位置
在绘制前修正布局
```

```tsx
function Tooltip() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const nextHeight = ref.current?.getBoundingClientRect().height ?? 0;
    setHeight(nextHeight);
  }, []);

  return <div ref={ref} data-height={height}>提示</div>;
}
```

它会阻塞浏览器绘制，不能当成普通 `useEffect` 的替代品。

### 11.7.3 服务端渲染注意事项

服务端没有布局和 DOM，直接使用 `useLayoutEffect` 可能产生警告。需要兼容 SSR 时，可以根据环境选择：

```tsx
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;
```

具体框架可能已经提供对应工具。

### 11.7.4 `useInsertionEffect`

`useInsertionEffect` 主要为 CSS-in-JS 库在 DOM 变更前插入样式提供更早的时机。业务组件通常不需要使用它：

```text
普通外部同步 → useEffect
布局测量 → useLayoutEffect
样式注入库内部 → useInsertionEffect
```

它受到更多限制，不能用来访问已经更新的 DOM，也不应作为普通副作用 API。

## 11.8 避免 Effect 无限循环

### 11.8.1 Effect 更新自己的依赖

```tsx
function Component() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(count + 1);
  }, [count]);

  return <p>{count}</p>;
}
```

循环是：

```text
count 改变
  ↓
Effect 执行
  ↓
setCount
  ↓
count 改变
```

如果业务确实需要初始化一次，可以使用惰性初始化：

```tsx
const [count] = useState(() => calculateInitialCount());
```

### 11.8.2 Effect 派生 State

错误：

```tsx
const [fullName, setFullName] = useState('');

useEffect(() => {
  setFullName(`${firstName} ${lastName}`);
}, [firstName, lastName]);
```

推荐：

```tsx
const fullName = `${firstName} ${lastName}`;
```

### 11.8.3 对象依赖导致循环

```tsx
const options = { enabled };

useEffect(() => {
  setState(read(options));
}, [options]);
```

如果 `setState` 触发 Render，`options` 又被创建为新对象，Effect 可能每次都运行。应缩小依赖到原始字段或把对象创建放进 Effect。

## 11.9 Effect 与事件的边界

### 11.9.1 事件是过去发生的动作

```tsx
function handleBuy() {
  logPurchase(product.id);
  addToCart(product);
}
```

这个逻辑由点击触发，使用事件处理函数可以保留动作原因。

### 11.9.2 Effect 是状态与外部系统的同步

```tsx
useEffect(() => {
  analytics.setUser(user.id);
  return () => analytics.clearUser();
}, [user.id]);
```

这个逻辑由组件和 `user.id` 的同步关系驱动，而不是某一个具体点击。

### 11.9.3 不要把事件拆成多个 State 再由 Effect 触发

错误倾向：

```tsx
const [submitted, setSubmitted] = useState(false);

function handleSubmit() {
  setSubmitted(true);
}

useEffect(() => {
  if (submitted) {
    sendForm(form);
  }
}, [submitted, form]);
```

更直接：

```tsx
function handleSubmit() {
  sendForm(form);
}
```

只有当“提交状态”本身需要和外部系统持续同步时，Effect 才有独立价值。

## 11.10 Effect 中的闭包和最新回调

### 11.10.1 订阅回调捕获旧 Props

```tsx
useEffect(() => {
  const unsubscribe = store.subscribe(() => {
    onChange(value);
  });

  return unsubscribe;
}, []);
```

如果 `onChange` 或 `value` 后续变化，订阅回调仍可能使用初始值。

### 11.10.2 把依赖写全

```tsx
useEffect(() => {
  const unsubscribe = store.subscribe(() => {
    onChange(value);
  });

  return unsubscribe;
}, [onChange, value]);
```

如果重新订阅成本很高，可以使用稳定监听器和 Ref 保存最新回调：

```tsx
const onChangeRef = useRef(onChange);

useEffect(() => {
  onChangeRef.current = onChange;
}, [onChange]);

useEffect(() => {
  return store.subscribe(() => {
    onChangeRef.current(valueRef.current);
  });
}, []);
```

这种模式应封装在明确的 Hook 中，并验证订阅生命周期和最新值同步时机。

### 11.10.3 Effect Event 的设计方向

较新的 React API 还在探索把“事件逻辑”和“Effect 反应性”分开。相关 API 的目标是让 Effect 中的非反应性事件读取最新值，而不让每次回调变化都重新建立外部订阅。

使用具体 API 时应以当前 React 版本官方文档为准，不要为了绕过依赖警告自行复制未稳定的内部模式。

## 11.11 复杂订阅的自定义 Hook

### 11.11.1 `useWindowEvent`

```tsx
function useWindowEvent<K extends keyof WindowEventMap>(
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

这个 Hook 把：

```text
订阅生命周期
回调最新值
```

分成两个 Effect 管理。

### 11.11.2 `useInterval`

```tsx
function useInterval(callback: () => void, delay: number | null) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) {
      return;
    }

    const timer = window.setInterval(() => {
      callbackRef.current();
    }, delay);

    return () => window.clearInterval(timer);
  }, [delay]);
}
```

使用：

```tsx
useInterval(() => {
  setSeconds((value) => value + 1);
}, running ? 1000 : null);
```

### 11.11.3 `useConnection`

```tsx
function useConnection(roomId: string) {
  const [status, setStatus] = useState<'offline' | 'online'>('offline');

  useEffect(() => {
    const connection = createConnection(roomId);

    connection.onOpen(() => setStatus('online'));
    connection.onClose(() => setStatus('offline'));
    connection.connect();

    return () => {
      connection.disconnect();
    };
  }, [roomId]);

  return status;
}
```

它的边界是：输入一个房间 ID，管理连接生命周期，返回连接状态。

## 11.12 Effect 与服务端渲染

### 11.12.1 Effect 不在服务端执行

服务端渲染的主要职责是生成 HTML。普通 Effect 需要浏览器提交和客户端运行，因此不会在服务端执行。

这意味着：

```tsx
useEffect(() => {
  loadData();
}, []);
```

不能作为服务端生成首屏数据的唯一来源。

### 11.12.2 SSR 数据应使用框架或服务端加载机制

如果首屏需要数据，通常应使用：

```text
服务端组件
路由 loader
服务端数据获取
预取缓存
框架提供的 async 数据 API
```

Effect 更适合客户端挂载后的同步和交互数据更新。

### 11.12.3 Hydration 期间的差异

如果服务端 HTML 和客户端首次 Render 不一致，会产生 Hydration 问题：

```tsx
function Clock() {
  return <time>{new Date().toLocaleTimeString()}</time>;
}
```

服务端和客户端时间可能不同。把某些浏览器专属变化放到 Effect 可以避免首次 HTML 直接依赖浏览器状态，但还要设计加载占位和用户体验。

## 11.13 源码阅读：Effect 如何进入 Fiber

### 11.13.1 Hook API 到 Dispatcher

```text
useEffect(create, deps)
  ↓
resolveDispatcher()
  ↓
currentDispatcher.useEffect
  ↓
mountEffect 或 updateEffect
```

首次调用和后续更新会经过不同路径。

### 11.13.2 Mount Effect

简化过程：

```text
mountEffect
  ↓
创建 Hook 节点
  ↓
创建 Effect 描述
  ↓
保存 create 和 deps
  ↓
给 Fiber 添加 Passive 标记
```

### 11.13.3 Update Effect

更新时：

```text
读取旧 Hook
  ↓
比较新旧 deps
  ↓
依赖相同 → 可以复用或跳过执行
依赖不同 → 标记需要重新执行
```

依赖比较通常使用类似 `Object.is` 的逐项比较语义。

### 11.13.4 Effect 链表

除了 Hook 链表，Fiber 还需要组织 Effect：

```text
Fiber
├─ memoizedState → Hook 链表
└─ updateQueue   → Effect 链表或相关队列
```

不同版本的字段和链表组织方式可能改变。核心模型是：Render 记录 Effect，Commit 相关阶段再执行 setup 和 cleanup。

### 11.13.5 Commit Passive Effects

可以关注这些源码入口：

```text
commitRoot
flushPassiveEffects
commitPassiveUnmountEffects
commitPassiveMountEffects
```

它们帮助回答：

```text
旧 Effect 何时清理？
新 Effect 何时建立？
卸载子树时如何清理？
```

## 11.14 官方行为、源码细节与工程结论

### 官方行为

- Effect 用来同步外部系统；
- Effect setup 在组件提交后运行；
- 依赖改变时，旧 Effect 会被清理并根据新依赖重新同步；
- 组件卸载时执行清理；
- Render 代码不应执行副作用；
- `useLayoutEffect` 适合提交后、绘制前的布局同步；
- Effect 不用于计算可以直接从 Props 和 State 得到的值。

### 源码视角

可以关注：

```text
mountEffect
updateEffect
mountEffectImpl
updateEffectImpl
pushSimpleEffect
HookHasEffect
Passive
Layout
flushPassiveEffects
```

这些名字用于源码导航，具体字段和执行阶段要以目标 React 版本为准。

### 工程结论

- 先找外部系统，再决定是否使用 Effect；
- 依赖数组应表达真实同步输入；
- 清理函数必须和资源创建成对设计；
- 请求需要取消、忽略旧响应或使用请求 ID；
- 派生数据不要通过 Effect 写回 State；
- 事件动作优先写在事件处理函数中；
- `useLayoutEffect` 会阻塞绘制，应限制使用范围；
- Strict Mode 重复检查能帮助发现不完整清理；
- SSR 首屏数据不能只依赖客户端 Effect。

## 11.15 面试重点

### `useEffect` 什么时候执行？

> `useEffect` 在 Render 阶段只记录副作用描述，组件完成 Commit 后，React 在 Passive Effect 阶段运行 setup。依赖变化时会先清理上一轮 Effect，再建立使用新依赖的 Effect；卸载时执行最后一次清理。

### 为什么 Effect 依赖数组不能随意省略？

> Effect 回调会捕获创建它的那次 Render 中的变量。漏写依赖会让回调继续使用旧闭包，外部系统可能不同步。依赖数组应该包含 Effect 读取的、会随 Render 变化的输入。

### `useEffect` 和 `useLayoutEffect` 有什么区别？

> `useEffect` 属于提交后的 Passive Effect，适合订阅、请求和非布局副作用；`useLayoutEffect` 在 DOM 提交后、浏览器绘制前运行，适合读取布局并同步修正，但会阻塞绘制，应该谨慎使用。

### 为什么不能把 Effect 写成 async 函数？

> Effect setup 的返回值需要是清理函数或 undefined，而 async 函数返回 Promise。应在 Effect 内部定义 async 函数并调用，再用 AbortController 或 active 标记处理取消和过期响应。

### Effect 如何处理请求竞态？

> 依赖变化时为每次请求创建 AbortController，在清理函数中取消旧请求；同时忽略 AbortError。对于无法取消的任务，可以用 active 标记、请求序列号或响应 ID，只允许最新请求提交结果。

## 11.16 本章小结

1. Effect 的核心职责是把 React 与外部系统同步；
2. Render 阶段记录 Effect，Commit 后执行相关 setup；
3. 依赖数组描述 Effect 的响应式输入；
4. 依赖变化时要清理旧同步关系，再建立新关系；
5. Effect 回调会捕获创建它的那次 Render 的闭包；
6. 派生值、事件动作和普通计算通常不需要 Effect；
7. 网络请求需要取消或处理过期响应；
8. `useLayoutEffect` 适合布局测量，但会阻塞绘制；
9. Strict Mode 可以帮助发现缺少清理和不可重复 setup；
10. SSR 首屏数据不能只依赖客户端 Effect。

> `useEffect` 不是“组件更新后执行任意代码”的入口，而是一个带有依赖和清理生命周期的外部同步机制。

## 11.17 练习题与参考答案

### 练习 1：下面的代码是否需要 Effect？

```tsx
const fullName = `${firstName} ${lastName}`;
```

**答案：** 不需要。它是由已有数据直接计算的派生值。

### 练习 2：修复 async Effect

```tsx
useEffect(async () => {
  const data = await load();
  setData(data);
}, []);
```

**答案：**

```tsx
useEffect(() => {
  const controller = new AbortController();

  async function run() {
    const data = await load({ signal: controller.signal });
    setData(data);
  }

  run();
  return () => controller.abort();
}, []);
```

### 练习 3：面试表达

请说明为什么 Effect 需要清理函数。

**答案：** Effect 可能建立事件监听器、定时器、连接或请求。依赖变化和组件卸载时，旧资源如果不清理，就会产生重复订阅、内存泄漏、旧回调继续更新 State 和请求竞态。清理函数让 setup 和资源生命周期成对出现。

---

下一章将讲解 `useRef`、`useMemo` 与 `useCallback`，重点分析稳定引用和手动缓存的真实边界。
