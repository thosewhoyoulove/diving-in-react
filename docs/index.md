---
layout: home
hero:
  name: 深入浅出 React
  text: 从直觉、机制到源码
  tagline: 面向有前端经验的开发者，系统理解 React 18/19、Fiber、Hooks、并发渲染、状态管理与性能优化。
  actions:
    - theme: brand
      text: 开始阅读
      link: /chapters/01-why-react
    - theme: alt
      text: 查看完整目录
      link: /guide/
features:
  - title: 先建立直觉
    details: 用生活化语言和最小代码理解 React 为什么这样设计。
  - title: 再解释机制
    details: 从组件执行、状态更新、Fiber 和调度过程理解运行时行为。
  - title: 最后深入源码
    details: 以 React 18/19 实际实现为基础，区分官方行为与源码细节。
---

<script setup>
import { onMounted } from 'vue'

onMounted(() => {
  document.title = '深入浅出 React'
})
</script>

<div class="book-intro">
  <p class="book-intro__lead">一套为复杂业务和高级面试准备的 React 运行机制学习路线。</p>
  <div class="book-intro__grid">
    <div>
      <span>36</span>
      <small>个章节</small>
    </div>
    <div>
      <span>10</span>
      <small>个知识部分</small>
    </div>
    <div>
      <span>1</span>
      <small>个综合项目</small>
    </div>
  </div>
</div>
