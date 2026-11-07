---
title: 第 29 章 React Compiler、自动记忆化与手动优化
outline: deep
---

# 第 29 章 React Compiler、自动记忆化与手动优化

React 性能优化长期依赖 `React.memo`、`useMemo` 和 `useCallback`。React Compiler 的目标是分析组件和 Hook 的数据依赖，在编译阶段自动插入必要的优化，减少开发者手工维护引用稳定性的负担。

Compiler 不是“所有组件自动变快”，也不是运行时魔法。它有输入条件、配置要求和语义边界。即使使用 Compiler，组件仍然要保持纯度，副作用仍要放在正确位置，数据结构和网络请求仍需要架构设计。

> **版本说明**：React Compiler 的可用方式、配置和支持范围会随 React 19 生态版本变化。以项目实际采用的官方文档和编译器版本为准，不要把实验性配置当作稳定 API。

## 本章学习目标

1. 理解 Memo 的成本和编译期优化的目标；
2. 区分引用稳定、计算缓存和组件 Bailout；
3. 解释 Compiler 需要纯组件和显式依赖的原因；
4. 识别 Compiler 无法解决的网络、数据量和主线程问题；
5. 在迁移时保留必要手动优化并验证收益；
6. 设计可被编译器安全分析的组件。

## 29.1 生活化直觉

手动 Memo 像每次做饭前自己写购物清单：能减少重复购买，但清单漏写一个依赖就会拿到旧材料。Compiler 像一个能分析食谱的助手，自动判断哪些材料没变，可以复用之前的准备结果。

但如果食谱本身在做饭时偷偷改库存、依赖外部随机数，助手就无法安全优化。编译器要求组件有可分析的输入和输出。

## 29.2 手动缓存回顾

```tsx
const Chart = memo(function Chart({ points }: { points: number[] }) {
  const path = useMemo(() => buildSvgPath(points), [points]);
  return <svg><path d={path} /></svg>;
});

function Dashboard({ data }: { data: number[] }) {
  const [tab, setTab] = useState('overview');
  const points = useMemo(() => normalize(data), [data]);
  const onSelect = useCallback((id: string) => selectItem(id), []);

  return <Chart points={points} onSelect={onSelect} />;
}
```

这里有三种不同优化：

- `useMemo` 缓存计算结果；
- `useCallback` 缓存函数引用；
- `memo` 尝试跳过组件 Render。

它们都增加了依赖维护和比较成本。依赖漏写会带来正确性问题，依赖总变化则没有性能收益。

## 29.3 编译器想解决什么

编译器可以分析组件读取了哪些值，以及某个子表达式是否能在输入不变时复用。概念模型如下：

```text
源码组件
  -> 编译器分析 Props、State、闭包和纯度
  -> 生成带缓存边界的代码
  -> 运行时根据输入变化复用计算
```

它仍然需要 React 能够观察到数据变化。直接改变对象内部字段、读取不可追踪的全局变量或调用不纯函数，都会让静态分析变得不可靠。

## 29.4 纯组件是优化基础

```tsx
function Price({ value }: { value: number }) {
  return <span>¥{value.toFixed(2)}</span>;
}
```

同样的输入得到同样的 React 结果，这样的组件更容易被优化。下面的代码有隐式副作用：

```tsx
let renderCount = 0;

function BadCounter() {
  renderCount += 1;
  document.title = String(renderCount);
  return <span>{renderCount}</span>;
}
```

Render 可能被重复、重试或丢弃，不能依赖执行次数完成业务操作。标题同步应放在 Effect 中，统计应放在明确的观测入口。

## 29.5 Compiler 不能代替架构优化

下面的问题不是自动 Memo 可以解决的：

- 一次性把十万条数据传给浏览器；
- 每个 token 都重新解析整个 Markdown 文档；
- 接口没有缓存和请求去重；
- 大量图片没有懒加载和尺寸；
- 单次计算阻塞主线程数百毫秒；
- Context 把每秒变化的数据传给整棵子树。

这些需要分页、虚拟列表、Worker、缓存、状态拆分和时间窗口更新。编译器只影响部分重复计算和组件工作。

## 29.6 业务代码：保留清晰数据边界

```tsx
type RowProps = {
  id: string;
  name: string;
  selected: boolean;
  onSelect: (id: string) => void;
};

function Row({ id, name, selected, onSelect }: RowProps) {
  return (
    <button aria-pressed={selected} onClick={() => onSelect(id)}>
      {name}
    </button>
  );
}

function Table({ rows, selectedId, onSelect }: {
  rows: { id: string; name: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      {rows.map((row) => (
        <Row
          key={row.id}
          id={row.id}
          name={row.name}
          selected={row.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
```

即使未来由 Compiler 自动处理缓存，这种 Props 设计仍然有价值：依赖显式、数据边界清楚、组件容易测试。不要为了“让编译器优化”把所有数据包装成复杂闭包。

## 29.7 迁移策略

迁移到 Compiler 时可以分阶段：

1. 固定 React、构建工具和 Compiler 版本；
2. 开启编译器诊断，收集不支持或语义风险；
3. 先选择纯度高、性能问题明确的页面；
4. 运行组件测试和端到端测试；
5. 用 Profiler 比较真实交互；
6. 删除明显冗余的手动 Memo，但保留有文档和测量依据的优化；
7. 逐步扩大范围并监控线上错误。

编译器带来的变化应通过代码评审解释，避免团队误以为所有 `useMemo` 都可以机械删除。

## 29.8 常见错误和错误边界

### 错误一：把 Compiler 当作性能保证

编译器可以优化某些可分析路径，但不承诺解决全部瓶颈。仍要测量 Render、Commit、网络和浏览器主线程。

### 错误二：使用不纯 Render 逃避规则

全局写入、随机数、Date、DOM 访问和可变共享对象都会破坏纯度。编译器不应被迫猜测这些行为的意图。

### 错误三：手动 Memo 和编译器同时叠加

大量重复缓存会增加代码复杂度和调试难度。应以诊断和 Profiler 为依据，逐个验证是否保留。

### 错误四：依赖错误仍然存在

Compiler 可能降低手工依赖的数量，但 Effect 的外部同步依赖仍必须正确。不能把编译器当作 stale closure 的安全网。

### 错误五：编译器配置和插件版本不一致

构建失败或开发、生产结果不一致时，先检查 React、Compiler、Babel/Vite 插件和 Node 版本矩阵。

## 29.9 性能和架构考虑

- 先减少数据量和更新范围，再处理引用稳定；
- 使用稳定 ID 和不可变更新帮助编译器判断变化；
- 用边界清晰的组件替代巨大组件；
- 把外部副作用放在 Effect、事件或数据层；
- 使用 Profiler 和真实设备验证编译前后结果。

## 29.10 面试重点：标准回答

> React Compiler 的目标是把部分手动 Memo 优化交给编译阶段分析，但它依赖组件纯度、可追踪的数据依赖和兼容的构建配置。它可以减少某些 `memo`、`useMemo` 和 `useCallback` 的手工维护，但不能替代虚拟列表、请求缓存、代码分割、Worker 和状态架构。是否删除现有手动优化要结合版本、诊断、测试和实际性能数据。

## 29.11 面试官追问

1. 为什么纯度对编译器重要？
2. Compiler 能否解决 Context 高频更新？
3. `useMemo` 是否应该全部删除？
4. 如何验证编译器没有改变组件行为？
5. 为什么一个计算已经被 Memo 了，页面仍然卡顿？

## 29.12 练习题与参考答案

### 练习题 1

列出三个 Compiler 无法解决的性能瓶颈。

**参考答案**：网络请求过多、一次渲染大量 DOM、单次 CPU 计算阻塞主线程。它们分别需要缓存/去重、虚拟列表或分页、Worker 或任务拆分。

### 练习题 2

找出一个不纯组件并重构。

**参考答案**：把 Render 中的 DOM 修改、全局写入和随机数移到 Effect 或事件中；让组件只根据 Props、State 和 Context 计算 UI。

### 练习题 3

如何决定保留还是删除 `useCallback`？

**参考答案**：确认它是否作为稳定 Props 传给昂贵的 Memo 子组件、是否作为 Effect 依赖、是否通过 Profiler 证明有收益。没有这些条件时，优先保持代码简单。

## 29.13 本章小结

React Compiler 是自动化性能优化工具，不是性能架构本身。纯组件、清晰数据流和正确依赖是编译器能安全工作的基础。迁移时要锁定版本、运行诊断、验证行为和测量收益，不能把手动优化或大型系统架构问题一概交给编译器。