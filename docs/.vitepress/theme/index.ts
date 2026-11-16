import { h, nextTick } from 'vue';
import DefaultTheme from 'vitepress/theme';
import ReadingMemory from './ReadingMemory.vue';
import { startReadingMemory } from './reading-progress';
import './custom.css';

function renderMermaidDiagrams() {
  if (typeof window === 'undefined') {
    return;
  }

  window.requestAnimationFrame(() => {
    void import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
      });

      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>('.mermaid:not([data-processed])'),
      );

      if (nodes.length > 0) {
        return mermaid.run({ nodes });
      }
    });
  });
}

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'nav-bar-content-after': () => h(ReadingMemory, { variant: 'nav' }),
      'home-hero-after': () => h(ReadingMemory, { variant: 'home' }),
      'doc-before': () => h(ReadingMemory, { variant: 'banner' }),
      'aside-outline-before': () => h(ReadingMemory, { variant: 'outline' }),
      'layout-bottom': () => h(ReadingMemory, { variant: 'dock' }),
    });
  },
  enhanceApp({ router }: { router: { onAfterRouteChange?: (to: string) => void } }) {
    if (typeof window === 'undefined') {
      return;
    }

    const previous = router.onAfterRouteChange;

    router.onAfterRouteChange = (to: string) => {
      previous?.(to);
      renderMermaidDiagrams();
      void nextTick(() => {
        startReadingMemory();
      });
    };

    renderMermaidDiagrams();
    startReadingMemory();
  },
};
