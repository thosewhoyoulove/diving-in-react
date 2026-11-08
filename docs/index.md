---
layout: home
hero:
  name: 深入浅出 React
  text: 从直觉、机制到源码
  tagline: 面向有前端经验的开发者，系统理解 React 18/19、Fiber、Hooks、并发渲染、状态管理与性能优化。
  image:
    light: /update-stages-light.svg
    dark: /update-stages-dark.svg
    alt: React 从更新触发到浏览器绘制的流程示意图
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
  <div class="book-intro__header">
    <p class="book-intro__eyebrow">React / 运行模型</p>
    <h2>把页面行为还原成运行模型。</h2>
    <p class="book-intro__lead">从组件执行到 Fiber 调度，从状态更新到线上性能，把每天都在使用的 React 拆成可以观察、解释和迁移的工程知识。</p>
  </div>

  <div class="book-intro__panel" aria-label="React 更新流程">
    <div class="book-intro__panel-top">
      <span>更新流程</span>
      <span>React 18 / 19</span>
    </div>
    <div class="book-intro__flow">
      <span>触发更新</span>
      <b>→</b>
      <span>Render</span>
      <b>→</b>
      <span>Commit</span>
      <b>→</b>
      <span>浏览器绘制</span>
    </div>
  </div>

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
