---
title: 第 27 章 React 19 的 Actions 与乐观更新
outline: deep
---

# 第 27 章 React 19 的 Actions 与乐观更新

React 19 把表单提交、异步状态和乐观更新提供了更明确的组合方式。这里的 Action 可以理解为“由 React 管理生命周期的异步更新函数”：它可以进入 pending 状态，成功后更新结果，失败后显示错误，并与表单提交状态连接起来。

本章重点讨论 `useActionState`、`useFormStatus` 和 `useOptimistic`。这些 API 适合交互型异步流程，但不能替代服务端校验、请求取消和权限控制。

> **版本说明**：这些 API 以 React 19 的公开能力为基础。React 18 项目需要使用自己的 pending State、Reducer 或数据请求库实现类似模式。

## 本章学习目标

1. 理解 Action 与普通事件处理函数的区别；
2. 使用 `useActionState` 管理提交结果和错误；
3. 使用 `useFormStatus` 让表单按钮读取提交状态；
4. 使用 `useOptimistic` 让界面先显示用户预期结果；
5. 处理重复提交、失败回滚和竞态；
6. 说明 React 19 新 API 的适用边界。

## 27.1 生活化直觉

普通异步提交像是你把材料交给柜台后，自己拿着纸条记录“是否提交中”。React 19 的 Action 像柜台给你一个完整回执：正在处理、成功结果和错误信息都在同一个流程里。

乐观更新则像点餐后先把菜显示在“已下单”列表中，等后端确认。如果服务端拒绝，再把临时记录撤回并提示原因。它提高反馈速度，但必须设计回滚和重新同步。

## 27.2 `useActionState` 最小示例

```tsx
import { useActionState } from 'react';

type FormState = {
  ok: boolean;
  message: string;
};

async function saveProfile(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, message: '姓名不能为空' };

  const response = await fetch('/api/profile', {
    method: 'POST',
    body: JSON.stringify({ name }),
    headers: { 'content-type': 'application/json' },
  });

  if (!response.ok) return { ok: false, message: '保存失败' };
  return { ok: true, message: '保存成功' };
}

export function ProfileForm() {
  const [state, formAction, pending] = useActionState(saveProfile, {
    ok: false,
    message: '',
  });

  return (
    <form action={formAction}>
      <label>
        姓名
        <input name="name" />
      </label>
      <button disabled={pending}>{pending ? '保存中…' : '保存'}</button>
      {state.message && <p role="status">{state.message}</p>}
    </form>
  );
}
```

代码中的 `formAction` 可以作为 `<form action>` 使用，React 会把 FormData 传给 Action，并返回新的状态。`pending` 表示该 Action 处于进行中。真实项目仍需处理网络超时、字段级错误、离开页面和服务端响应格式。

### 逐段解释

- `previous` 是上一次 Action 状态，可用于保留旧错误或结果；
- `FormData` 来自表单控件的 `name` 字段；
- `formAction` 是 React 返回的提交入口，不是普通的 API 请求函数；
- `pending` 只代表当前 Action 的 pending 状态，不等于服务端已经成功；
- 服务端错误应该转成用户可理解的状态，而不是在 UI 中吞掉异常。

## 27.3 `useFormStatus` 与子组件边界

`useFormStatus` 只能在 Form 的后代组件中读取最近表单的状态：

```tsx
import { useFormStatus } from 'react-dom';

function SubmitButton() {
  const { pending, data, method } = useFormStatus();

  return (
    <button type="submit" disabled={pending}>
      {pending ? '提交中…' : method === 'post' ? '提交' : '发送'}
    </button>
  );
}

function CommentForm({ action }: { action: (data: FormData) => void }) {
  return (
    <form action={action} method="post">
      <textarea name="content" required />
      <SubmitButton />
    </form>
  );
}
```

如果在 `<form>` 自身组件中调用 `useFormStatus`，它读取不到当前正在提交的表单，因为 Hook 读取的是父级 Form 上下文。把提交按钮拆成子组件是必要的结构边界。

## 27.4 `useOptimistic` 的业务代码

```tsx
import { useOptimistic, useState } from 'react';

type Comment = { id: string; text: string; pending?: boolean };

function Comments({ initial }: { initial: Comment[] }) {
  const [comments, setComments] = useState(initial);
  const [optimistic, addOptimistic] = useOptimistic(
    comments,
    (current, next: Comment) => [...current, next],
  );

  async function addComment(formData: FormData) {
    const text = String(formData.get('text') ?? '').trim();
    if (!text) return;

    const temporary = {
      id: crypto.randomUUID(),
      text,
      pending: true,
    };
    addOptimistic(temporary);

    const response = await fetch('/api/comments', {
      method: 'POST',
      body: JSON.stringify({ text }),
      headers: { 'content-type': 'application/json' },
    });

    if (!response.ok) throw new Error('评论失败');
    const saved = await response.json() as Comment;
    setComments((current) => [...current, saved]);
  }

  return (
    <>
      <form action={addComment}>
        <input name="text" />
        <button>发表评论</button>
      </form>
      <ul>
        {optimistic.map((comment) => (
          <li key={comment.id} aria-busy={comment.pending}>
            {comment.text}{comment.pending ? '（发送中）' : ''}
          </li>
        ))}
      </ul>
    </>
  );
}
```

乐观 State 是临时视图，真实 State 仍由服务端结果确认。失败时 Action 结束，React 会回到真实 State；如果业务需要持久显示错误，应额外建模错误状态。

## 27.5 源码视角：Action 仍然通过更新调度

从机制上看，React 并没有跳过更新链路：

```text
form action
  -> 创建 Action 任务
  -> 标记 pending
  -> 执行异步函数
  -> 处理成功或失败结果
  -> 安排 React 更新
  -> Render / Commit
```

React 19 的新 API 帮助组织异步状态和上下文，但网络请求依然是外部系统。Action 内部的异步函数不是事务，多个 Action 之间仍可能发生竞态。

## 27.6 常见错误和错误边界

### 错误一：把 pending 当作成功

pending 只表示请求还没有完成。按钮可以禁用，但成功提示必须等待服务端响应。

### 错误二：乐观更新没有回滚策略

支付、库存和权限等操作不能只显示成功。失败时要撤销临时视图，重新请求真实数据，并保留用户可操作的重试入口。

### 错误三：重复点击产生多个写操作

禁用按钮只能减少普通点击，不能替代服务端幂等键。写接口要根据用户操作 ID 去重。

### 错误四：把所有异步逻辑都放进 Action

简单表单适合 Action；长时间订阅、复杂缓存、轮询和跨页面任务应由专门的数据层或外部 Store 管理。

### 错误五：忽略服务端错误结构

Action 返回的错误要区分字段校验、权限失败、网络失败和系统故障，否则用户无法恢复。

## 27.7 性能和架构考虑

- 让 pending 状态只影响提交按钮和相关结果区域；
- 大型表单不要因为一个字段变化重新渲染整页；
- 乐观列表使用稳定临时 ID，服务端结果回来后正确替换；
- 对高频提交加幂等键和节流；
- 需要缓存失效的请求交给数据层，而不是每个 Action 手动同步所有副本。

## 27.8 面试重点：标准回答

> React 19 的 Action API 把异步表单提交的 pending、成功结果和错误状态组织在一起。`useActionState` 返回状态和提交函数，`useFormStatus` 让表单后代读取 pending，`useOptimistic` 允许先展示预期结果。它们仍然通过 React 的更新调度进入 Render 和 Commit，不能替代服务端校验、请求取消和幂等设计。

## 27.9 面试官追问

1. `useFormStatus` 为什么要放在表单子组件里？
2. 乐观更新失败后如何恢复真实数据？
3. React 19 Action 和 Redux Thunk 的职责有什么区别？
4. 一个表单同时提交两次时，如何保证结果顺序？
5. React 18 项目如何实现类似 pending 和 optimistic UI？

## 27.10 练习题与参考答案

### 练习题 1

把一个 `isSubmitting`、`error`、`result` 三个 State 的表单重构成联合状态或 `useActionState`。

**参考答案**：将状态建模为 idle、pending、success、error 四种互斥状态，提交函数只负责触发 Action，UI 根据状态渲染按钮、错误和结果。

### 练习题 2

实现评论乐观更新，要求失败后显示“发送失败”和重试按钮。

**参考答案**：临时评论带 `pending` 和临时 ID，真实 State 只保存服务端成功结果；失败时保存失败记录或错误映射，重试时沿用幂等键，成功后用服务端评论替换临时记录。

### 练习题 3

说明为什么乐观更新不适合直接确认支付成功。

**参考答案**：支付结果涉及服务端扣款、库存和风控，前端不能把预测结果当成事实。可以乐观显示“正在提交”，但最终成功必须以服务端确认和订单状态为准。

## 27.11 本章小结

React 19 的 Actions 让异步表单、pending 状态和乐观更新拥有更清晰的组合方式。它们减少了重复的 UI 状态代码，但不会消除网络竞态、服务端校验、权限和幂等问题。正确的设计是让 React 管理交互状态，让服务端决定真实结果。