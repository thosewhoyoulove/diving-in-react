---
title: 第 17 章 React 为什么会重新渲染
outline: deep
---

# 第 17 章 React 为什么会重新渲染

“组件重新渲染”至少可能指三件不同的事：

1. 函数组件函数再次执行；
2. Fiber 在 Render 阶段重新计算子树；
3. Commit 阶段真的修改了 DOM。

这三件事不是同一件事。父组件重新执行时，子组件函数可能也会执行；子组件函数执行后，DOM 仍可能因为 Props 结果相同而不变；`React.memo` 可能跳过子组件 Render，但 Context 或组件自身 State 变化仍然可以让它更新。

理解更新原因，才能选择拆分、缓存、选择器或状态移动，而不是盲目添加 `memo`。

## 本章学习目标

学习完本章，你应该能够：

1. 区分 Render、Commit 和 DOM 变更；
2. 列出组件重新执行的直接来源；
3. 解释 Props、State、Context 和外部 Store 如何触发更新；
4. 使用 Profiler 定位真正的更新原因；
5. 通过状态边界和组件拆分减少无效工作；
6. 识别 Strict Mode、Key 变化和开发工具带来的额外执行。

## 17.1 源码模型：从 Update 到子树 Render

### 17.1.1 Root 调度更新

```text
setState / dispatch / Context 变化
  -> 标记 Fiber 的 pendingLanes
  -> 向上找到 Root
  -> ensureRootIsScheduled
  -> renderRoot
  -> beginWork / completeWork
  -> commitRoot
```

React 不会因为一次 State 更新就直接调用 DOM API。它先建立一棵新的 Fiber 结果，比较新旧节点，再在 Commit 阶段执行必要的 Host 操作。

### 17.1.2 `beginWork` 决定是否继续子树

概念上可以简化为：

```ts
function beginWork(current: Fiber | null, workInProgress: Fiber) {
  if (current && propsAreEqual(current, workInProgress)) {
    if (!hasScheduledUpdateOrContext(workInProgress)) {
      return bailoutOnAlreadyFinishedWork(current, workInProgress);
    }
  }

  return updateComponent(workInProgress);
}
```

Bailout 不是“这个组件永远不执行”，而是当前条件下可以复用已有工作。自身 State、Context 依赖、Lane 或子树待处理更新都可能阻止 Bailout。

### 17.1.3 函数组件执行和 DOM 更新分离

```tsx
function Counter() {
  console.log('Counter function runs');
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
```

点击后函数会再次执行，因为它需要计算新的 Element。若最终生成的 DOM 属性与旧值一致，Commit 阶段可能没有对应 DOM 操作。调试时不要仅凭“函数执行日志”判断页面发生了大量 DOM 更新。

## 17.2 重新渲染的直接来源

### 17.2.1 自身 State 更新

```tsx
function SearchBox() {
  const [value, setValue] = useState('');
  return <input value={value} onChange={(event) => setValue(event.target.value)} />;
}
```

`setValue` 会安排拥有该 Hook 的 Fiber 更新。State 更新到相同值时，React 在某些路径上可以跳过后续工作，但不要把“相同值跳过”当作业务逻辑依赖。

### 17.2.2 父组件重新执行

```tsx
function Page() {
  const [tab, setTab] = useState('all');
  return (
    <>
      <button onClick={() => setTab('all')}>全部</button>
      <Header />
      <List tab={tab} />
    </>
  );
}
```

父组件更新时，默认会继续处理子树。`Header` 没有收到变化的 Props，但如果没有 Bailout 机制，它的函数也可能再次执行。可以通过组件拆分、稳定 Props 或 `memo` 让昂贵子树跳过。

### 17.2.3 Context 值变化

读取某个 Context 的组件订阅了该依赖。Provider 值改变时，即使中间父组件 Props 没变，消费者也会被标记更新：

```tsx
const ThemeText = memo(function ThemeText() {
  const { theme } = useTheme();
  return <span className={theme}>正文</span>;
});
```

`memo` 不会阻止 Context 变化传给组件。若 Context 更新过于频繁，应该拆 Context 或使用选择器方案。

### 17.2.4 外部 Store 快照变化

通过 `useSyncExternalStore` 订阅时，React 会比较新旧快照。若选择器结果或快照引用每次都不同，即使业务数据没有变化，也可能触发更新。

## 17.3 业务代码：定位一个频繁更新页面

```tsx
function Dashboard() {
  const [query, setQuery] = useState('');
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <main>
      <SearchInput value={query} onChange={setQuery} />
      <Clock seconds={seconds} />
      <Report query={query} />
    </main>
  );
}
```

这个页面每秒更新一次时，`SearchInput` 和 `Report` 也可能参与 Render。可以把时钟状态移动到 `Clock` 内部：

```tsx
function Clock() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  return <time>{seconds}s</time>;
}
```

状态边界改变后，时钟每秒更新只影响自身子树。这个设计通常比在根组件上为所有子组件添加缓存更清晰。

## 17.4 Props 身份和组件类型

### 17.4.1 新对象会让浅比较失败

```tsx
const settings = { dense: true };
return <Table settings={settings} />;
```

如果这行在组件 Render 内，`settings` 每次都是新引用。对于 `memo(Table)`，浅比较会将其视为变化。可以传原始字段、使用 `useMemo`，或让 Table 自己从更小的 Props 计算配置。

### 17.4.2 内联函数的真实影响

```tsx
<Row onRemove={() => remove(row.id)} />
```

内联函数本身不一定是问题。只有当子组件是昂贵的、被 `memo` 包裹且函数身份确实导致重复 Render 时，才需要考虑 `useCallback`。对很小的组件，缓存函数可能增加复杂度而没有可见收益。

### 17.4.3 Key 变化会重置身份

```tsx
<Editor key={documentId} documentId={documentId} />
```

`documentId` 改变时，React 会把它当作新组件处理，旧 State 被卸载，新 State 从头初始化。Key 是身份的一部分，不能用随机数让列表“强制刷新”：

```tsx
// 错误：每次 Render 都会重置输入和副作用
<Item key={Math.random()} />
```

## 17.5 Profiler 与更新原因

使用 React DevTools Profiler 时重点观察：

- Commit 次数和每次 Commit 的耗时；
- 哪些组件实际耗时最高；
- 某次更新由 State、Props、Context 还是父组件传播；
- Render 耗时和 Commit 耗时分别是多少；
- 优化前后真实交互是否改善。

也可以给关键组件加受控日志：

```tsx
function useWhyDidYouRender(name: string, values: Record<string, unknown>) {
  const previous = useRef(values);

  useEffect(() => {
    const changes = Object.entries(values).filter(
      ([key, value]) => !Object.is(previous.current[key], value),
    );
    if (changes.length) console.log(name, changes);
    previous.current = values;
  });
}
```

日志 Hook 只应在开发调试中使用，避免把敏感数据输出到生产环境。

## 17.6 常见错误边界

### 错误一：把函数执行次数当作 DOM 更新次数

Render 可能被中断、重试或因为父组件传播而重新执行。需要结合 Profiler 和浏览器 Performance 面板判断真实成本。

### 错误二：所有组件都加 `React.memo`

`memo` 会增加比较和维护成本；如果 Props 总在变化，或者组件本身非常轻量，可能没有收益。优化应围绕测量结果。

### 错误三：用随机 Key 修复状态问题

随机 Key 会让组件频繁卸载和重建，导致输入丢失、Effect 重跑和资源重复创建。应修复真正的身份字段。

### 错误四：用 `useEffect` 同步可以直接计算的值

这会增加一次更新，并把依赖同步问题引入页面。派生值优先在 Render 中计算，昂贵时再使用 `useMemo`。

### 错误五：忽略 Strict Mode 的开发行为

开发环境 Strict Mode 可能重复执行部分 Render 和 Effect 以暴露不纯逻辑。不要通过全局标记掩盖问题，应保证 Effect 可以清理、Render 没有不可逆副作用。

### 错误六：选择器返回不稳定快照

外部 Store 的 `getSnapshot` 如果每次都创建新对象，React 会认为快照一直变化。应返回稳定的快照引用，并在底层状态真正变化时替换它。

## 17.7 练习题

1. 区分“组件函数执行”“Fiber Render”和“DOM Commit”，分别给出可观察证据。
2. 找出一个每秒更新的页面，把频繁变化的 State 移到最小合理子树。
3. 解释 `React.memo` 为什么不能阻止组件自身 State 和 Context 更新。
4. 设计一个列表 Key 方案，处理服务端排序、插入和删除。
5. 使用 Profiler 记录一次输入交互，判断瓶颈在 Render 还是 Commit。
6. 让一个外部 Store 的快照保持引用稳定，并测试没有业务变化时不会重复更新。

## 本章小结

重新渲染是 React 重新计算结果的过程，DOM 更新只是 Commit 的一部分。更新来源包括自身 State、父组件传播、Props、Context 和外部 Store。定位问题时应先确认更新来源和真实耗时，再通过状态边界、组件拆分、稳定引用或选择器减少工作。