import DefaultTheme from 'vitepress/theme';
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
  ...DefaultTheme,
  enhanceApp({ router }: { router: { onAfterRouteChange: (callback: () => void) => void } }) {
    router.onAfterRouteChange = renderMermaidDiagrams;
    renderMermaidDiagrams();
  },
};
