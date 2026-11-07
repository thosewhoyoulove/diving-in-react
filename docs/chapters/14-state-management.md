---
title: 第 14 章 React 状态管理
outline: deep
---

# 第 14 章 React 状态管理

状态管理不是“选一个最流行的库”，而是回答三个问题：

1. 这份数据由谁拥有？
2. 哪些组件需要读取或修改它？
3. 它的生命周期、来源和一致性要求是什么？

一个应用通常同时存在几类状态：

- **局部 UI 状态**：弹窗、输入框、选中项、折叠面板；
- **共享客户端状态**：购物车、权限、编辑器草稿、主题；
- **服务端状态**：列表、详情、缓存、分页和请求状态；
- **URL 状态**：搜索关键词、分页、筛选条件和路由参数；
- **表单状态**：字段值、校验结果、提交状态。

把不同来源的状态混在一个对象里，会让更新、缓存和错误恢复都变复杂。好的状态架构首先减少重复数据，再选择合适的共享机制。

## 本章学习目标

学习完本章，你应该能够：

1. 区分状态的所有权、作用域和生命周期；
2. 判断状态应该保留、派生、提升还是放入外部 Store；
3. 设计状态机而不是堆叠多个布尔值；
4. 选择 Props、Context、Reducer、外部 Store 或服务端缓存；
5. 处理服务端状态的缓存、失效和竞态；
6. 找到状态管理中的一致性和错误边界。

## 14.1 源码模型：一次状态更新如何传播

### 14.1.1 局部 State 的更新链路

```text
事件处理函数
  -> setState(action)
  -> 创建 Update
  -> 放入对应 Hook 的 update queue
  -> 请求某个 Lane
  -> 调度 Root
  -> Render 计算新状态
  -> Commit 更新 DOM
```

局部 State 的优势是作用域清晰：只有拥有它的 Fiber 和受影响的子树需要参与更新。状态越靠近使用它的组件，更新边界通常越小。

### 14.1.2 `useReducer` 把状态转换集中起来

```ts
type Update<S, A> = {
  action: A;
  next: Update<S, A> | null;
};

function dispatch<S, A>(action: A) {
  const update = { action, next: null };
  enqueueUpdate(queue, update);
  scheduleUpdateOnFiber(fiber, requestUpdateLane(fiber));
}

function processQueue<S, A>(state: S, reducer: (s: S, a: A) => S) {
  let nextState = state;
  for (const update of pendingUpdates) {
    nextState = reducer(nextState, update.action);
  }
  return nextState;
}
```

Reducer 不直接修改旧状态，而是根据旧状态和 Action 返回新状态。这个模型适合有明确事件和状态转换规则的业务。

### 14.1.3 外部 Store 的核心是订阅协议

React 连接外部 Store 时，需要知道两件事：如何读取当前快照，以及快照何时变化。`useSyncExternalStore` 体现了这一协议：

```ts
const value = useSyncExternalStore(
  store.subscribe,
  store.getSnapshot,
  store.getServerSnapshot,
);
```

React 可以在并发渲染中检查快照是否一致，避免组件读到混合版本的数据。一个简单 Store 大致需要：

```ts
type Listener = () => void;

function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<Listener>();

  return {
    getSnapshot: () => state,
    setState(next: T) {
      state = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
```

真实库还要提供选择器、批量更新、服务端快照和开发工具等能力。

## 14.2 先判断状态属于哪里

### 14.2.1 局部状态

```tsx
function FilterPanel() {
  const [expanded, setExpanded] = useState(false);
  const [keyword, setKeyword] = useState('');

  return (
    <section>
      <button onClick={() => setExpanded((value) => !value)}>
        {expanded ? '收起' : '展开'}
      </button>
      {expanded && (
        <input value={keyword} onChange={(event) => setKeyword(event.target.value)} />
      )}
    </section>
  );
}
```

这个状态只服务于面板，放在页面根部或全局 Store 会增加不必要的耦合。

### 14.2.2 通过 Props 提升状态

当两个兄弟组件需要共享同一状态时，提升到最近的共同父组件：

```tsx
function ProductPage() {
  const [keyword, setKeyword] = useState('');

  return (
    <>
      <SearchBox value={keyword} onChange={setKeyword} />
      <ProductList keyword={keyword} />
    </>
  );
}
```

Props 让依赖显式可见，适合组件层级有限、数据流单向的场景。

### 14.2.3 URL 状态

用户希望复制链接后仍能恢复的状态，通常应该进入 URL：

```tsx
function ProductSearch() {
  const [params, setParams] = useSearchParams();
  const keyword = params.get('q') ?? '';

  function updateKeyword(value: string) {
    setParams((current) => {
      if (value) current.set('q', value);
      else current.delete('q');
      current.set('page', '1');
      return current;
    });
  }

  return <SearchBox value={keyword} onChange={updateKeyword} />;
}
```

URL 状态有导航、编码、刷新和后退前进语义，不能简单等同于组件 State。

## 14.3 用状态机表达业务流程

多个布尔值很容易产生非法组合：

```tsx
const [loading, setLoading] = useState(false);
const [success, setSuccess] = useState(false);
const [error, setError] = useState<Error | null>(null);
```

它可能同时出现 `loading === true` 和 `success === true`。用联合类型表达互斥状态：

```ts
type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'success'; savedAt: number }
  | { status: 'error'; message: string };

type SaveAction =
  | { type: 'start' }
  | { type: 'success'; savedAt: number }
  | { type: 'failure'; message: string }
  | { type: 'reset' };

function saveReducer(state: SaveState, action: SaveAction): SaveState {
  switch (action.type) {
    case 'start':
      return { status: 'saving' };
    case 'success':
      return { status: 'success', savedAt: action.savedAt };
    case 'failure':
      return { status: 'error', message: action.message };
    case 'reset':
      return { status: 'idle' };
  }
}
```

状态机的价值是把允许的状态和转换写出来，UI 只需要根据 `status` 渲染。

## 14.4 服务端状态与客户端状态

### 14.4.1 请求数据不应该被复制成多份

```tsx
const { data, isLoading, error } = useQuery({
  queryKey: ['products', { page, keyword }],
  queryFn: () => fetchProducts({ page, keyword }),
});
```

服务端状态库通常负责：

- 根据 Key 缓存结果；
- 去重并发请求；
- 重新获取和失效；
- 保留旧数据以减少闪烁；
- 管理加载、错误和重试。

如果把同一份接口数据同时放进 Context、Redux 和组件 State，更新时就需要同步三份副本，最终很容易出现过期数据。

### 14.4.2 派生数据应在读取处计算

```tsx
const completedCount = todos.filter((todo) => todo.completed).length;
```

除非计算成本确实很高，否则不要额外保存 `completedCount`。重复存储意味着必须在每个新增、删除、批量更新路径中同步它。

## 14.5 选择方案的决策模型

可以按下面的问题逐层判断：

1. 只有一个组件使用吗？使用局部 State。
2. 只有兄弟组件共享吗？提升到最近共同父组件。
3. 一棵子树需要稳定依赖吗？考虑 Context。
4. 多个不相邻区域频繁读写吗？考虑外部 Store。
5. 数据来自服务器吗？优先使用服务端状态缓存。
6. 状态需要出现在链接中吗？放进 URL。
7. 状态转换是否有很多事件和非法组合？使用 Reducer 或状态机。

Redux、Zustand、Jotai 等库都能解决一部分问题，但库本身不能替代状态分类。选择时还要评估调试工具、团队熟悉度、服务端渲染、持久化和测试方式。

## 14.6 业务代码：可编辑订单

```tsx
type OrderLine = {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
};

type OrderAction =
  | { type: 'quantityChanged'; productId: string; quantity: number }
  | { type: 'lineRemoved'; productId: string }
  | { type: 'reset'; lines: OrderLine[] };

function orderReducer(lines: OrderLine[], action: OrderAction) {
  switch (action.type) {
    case 'quantityChanged':
      return lines.map((line) =>
        line.productId === action.productId
          ? { ...line, quantity: Math.max(1, action.quantity) }
          : line,
      );
    case 'lineRemoved':
      return lines.filter((line) => line.productId !== action.productId);
    case 'reset':
      return action.lines;
  }
}

function OrderEditor({ initialLines }: { initialLines: OrderLine[] }) {
  const [lines, dispatch] = useReducer(orderReducer, initialLines);
  const total = lines.reduce(
    (sum, line) => sum + line.quantity * line.unitPrice,
    0,
  );

  return (
    <form>
      {lines.map((line) => (
        <div key={line.productId}>
          <span>{line.name}</span>
          <input
            type="number"
            min="1"
            value={line.quantity}
            onChange={(event) => dispatch({
              type: 'quantityChanged',
              productId: line.productId,
              quantity: Number(event.target.value),
            })}
          />
          <button type="button" onClick={() => dispatch({
            type: 'lineRemoved',
            productId: line.productId,
          })}>
            删除
          </button>
        </div>
      ))}
      <strong>合计：¥{total.toFixed(2)}</strong>
    </form>
  );
}
```

这里把订单行作为唯一可编辑源，合计作为派生值。提交接口返回最终订单后，再用服务端结果替换本地草稿，避免把本地假设当成事实。

## 14.7 常见错误边界

### 错误一：全局 Store 解决局部问题

全局状态会增加读写路径和测试准备成本。先确定共享范围，再决定是否外置。

### 错误二：把服务器缓存当作普通客户端状态

服务器数据有缓存时间、失效、重试和权限变化等语义。简单地 `useEffect + useState` 可以完成一次请求，但复杂页面很快需要额外处理缓存一致性和重复请求。

### 错误三：可变对象直接修改

```tsx
order.lines[0].quantity = 3;
setOrder(order);
```

引用没有变化，依赖引用比较的组件可能跳过更新。应创建新的数组和对象：

```tsx
setOrder((current) => ({
  ...current,
  lines: current.lines.map((line, index) =>
    index === 0 ? { ...line, quantity: 3 } : line,
  ),
}));
```

### 错误四：派生状态出现多个来源

同时保存 `selectedIds` 和完整 `selectedItems`，删除商品时就必须同步两者。保留最小源数据，其他内容通过选择器或计算得到。

### 错误五：多个布尔值表达一个流程

上传流程、支付流程和登录流程都容易出现互斥状态。使用联合类型或 Reducer，给失败、重试、取消和完成建立明确转换。

## 14.8 练习题

1. 把一个包含 `isLoading`、`isSuccess`、`error` 的请求组件重构成联合状态。
2. 为购物车判断状态归属：商品列表、购物车数量、折扣码、结算结果分别应该放在哪里？说明理由。
3. 设计一个 URL 筛选状态，要求刷新、复制链接和浏览器后退都能恢复。
4. 找出一份重复保存的派生数据，并改为读取时计算。
5. 编写一个带缓存失效策略的 `useResource` Hook，至少处理成功、失败、取消和重新获取。
6. 比较 Context 和外部 Store 在更新粒度、调试、测试和服务端渲染方面的差异。

## 本章小结

状态管理的核心是明确数据来源和生命周期。局部状态优先留在局部，跨树依赖可以使用 Context，复杂转换可以使用 Reducer，服务器数据应按缓存和失效语义管理，用户可分享的状态应进入 URL。减少重复状态，比盲目引入更大的 Store 更能降低复杂度。