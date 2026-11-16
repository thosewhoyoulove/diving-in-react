const STORAGE_KEY = 'diving-in-react:reading-v1';
const HANDLE = '__divingReading';

export type ReadingPlace = {
  path: string;
  hash: string;
  heading: string;
  chapter: string;
  index: number;
  total: number;
  updatedAt: number;
};

export type ReadingSnapshot = {
  path: string;
  latest: ReadingPlace | null;
  onChapter: boolean;
  onLatest: boolean;
  canResume: boolean;
  place: ReadingPlace | null;
  label: string;
};

type Store = {
  latestPath: string;
  pages: Record<string, ReadingPlace>;
};

type Mode = 'idle' | 'remembering' | 'locked' | 'following';

type Runtime = {
  abort: () => void;
  onPath: () => void;
};

const emptySnapshotValue: ReadingSnapshot = {
  path: '',
  latest: null,
  onChapter: false,
  onLatest: false,
  canResume: false,
  place: null,
  label: '',
};

let store: Store = { latestPath: '', pages: {} };
let snapshot: ReadingSnapshot = emptySnapshotValue;
let activePath = '';
let mode: Mode = 'idle';
let lockId = '';
let baselineId = '';
let initialScrollY = 0;
let userIntent = false;
let saveTimer = 0;
let setupTimer = 0;
let paintedId = '';
const listeners = new Set<(value: ReadingSnapshot) => void>();

export function emptySnapshot() {
  return emptySnapshotValue;
}

export function getSnapshot() {
  return snapshot;
}

export function subscribe(listener: (value: ReadingSnapshot) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function queueReadingSetup() {
  if (typeof window === 'undefined') {
    return;
  }

  scheduleSetup();
}

export function startReadingMemory() {
  if (typeof window === 'undefined') {
    return;
  }

  const host = window as unknown as Record<string, Runtime | undefined>;

  if (host[HANDLE]) {
    scheduleSetup();
    return;
  }

  store = readStore();
  const controller = new AbortController();
  const { signal } = controller;

  const runtime: Runtime = {
    abort: () => {
      controller.abort();
      window.clearTimeout(saveTimer);
      window.clearTimeout(setupTimer);
    },
    onPath: () => {
      flushSave();
      scheduleSetup();
    },
  };

  host[HANDLE] = runtime;
  ensureHistoryPatch(runtime);

  window.addEventListener('scroll', onScroll, { passive: true, signal });
  window.addEventListener('hashchange', onHashChange, { signal });
  window.addEventListener('popstate', () => scheduleSetup(), { signal });
  window.addEventListener('keydown', onKeyDown, { signal });
  window.addEventListener('wheel', noteIntent, { passive: true, signal });
  window.addEventListener('touchmove', noteIntent, { passive: true, signal });
  window.addEventListener('pagehide', flushSave, { signal });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushSave();
    }
  }, { signal });

  scheduleSetup();
}

export async function copyProgressLink() {
  const place = linkPlace();

  if (!place) {
    return false;
  }

  return copyText(toAbsoluteUrl(place.path, place.hash));
}

function linkPlace() {
  if (snapshot.canResume && snapshot.place) {
    return snapshot.place;
  }

  if (snapshot.onChapter && snapshot.place) {
    return snapshot.place;
  }

  return snapshot.latest;
}

function ensureHistoryPatch(runtime: Runtime) {
  const host = window as unknown as Record<string, Runtime | boolean | undefined>;

  host.__divingReadingOnPath = runtime;

  if (host.__divingReadingHistory) {
    return;
  }

  host.__divingReadingHistory = true;
  const pushState = history.pushState.bind(history);
  const replaceState = history.replaceState.bind(history);

  const notify = (before: string) => {
    if (location.pathname !== before) {
      (host.__divingReadingOnPath as Runtime | undefined)?.onPath();
    }
  };

  history.pushState = (data, unused, url) => {
    const before = location.pathname;
    pushState(data, unused, url);
    notify(before);
  };

  history.replaceState = (data, unused, url) => {
    const before = location.pathname;
    replaceState(data, unused, url);
    notify(before);
  };
}

function scheduleSetup() {
  window.clearTimeout(setupTimer);
  setupTimer = window.setTimeout(() => setupPage(0), 30);
}

function setupPage(attempt: number) {
  const path = currentPath();

  if ((!contentMatchesLocation(path) || !outlineReady(path)) && attempt < 30) {
    window.setTimeout(() => setupPage(attempt + 1), 50);
    return;
  }

  if (path !== activePath) {
    activePath = path;
    initMode(path);
    paintedId = '';
  }

  refresh();

  if (mode === 'locked') {
    window.setTimeout(nudgeLockedHeading, 900);
  }
}

function initMode(path: string) {
  userIntent = false;
  baselineId = '';
  initialScrollY = window.scrollY;
  const saved = store.pages[path];
  const hash = hashId();

  if (isChapterPath(path) && hash) {
    mode = 'locked';
    lockId = hash;
    return;
  }

  if (window.scrollY > 480) {
    mode = 'following';
    lockId = '';
    return;
  }

  if (isChapterPath(path) && saved?.hash) {
    mode = 'remembering';
    lockId = '';
    baselineId = headingAtReadingLine(getHeadings())?.id || '';
    return;
  }

  mode = 'idle';
  lockId = '';
}

function onHashChange() {
  const id = hashId();

  if (!id || !isChapterPath(currentPath())) {
    refresh();
    return;
  }

  mode = 'locked';
  lockId = id;
  userIntent = false;
  refresh();
}

function onScroll() {
  if (currentPath() !== activePath) {
    scheduleSetup();
    return;
  }

  if (mode === 'remembering' && Math.abs(window.scrollY - initialScrollY) > 240) {
    userIntent = true;
  }

  refresh();
}

function onKeyDown(event: KeyboardEvent) {
  const keys = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '];

  if (keys.includes(event.key)) {
    noteIntent();
  }
}

function noteIntent() {
  userIntent = true;

  if (mode === 'locked') {
    mode = 'following';
    lockId = '';
  }

  promote();
  refresh();
}

function promote() {
  const headings = getHeadings();
  const line = headingAtReadingLine(headings);

  if (mode === 'idle' && (line || (userIntent && window.scrollY > 320))) {
    mode = 'following';
    return;
  }

  if (mode === 'remembering' && userIntent && ((line?.id || '') !== baselineId || window.scrollY > 320)) {
    mode = 'following';
    return;
  }

  if (mode === 'locked' && lockId) {
    const target = document.getElementById(lockId);

    if (target && Math.abs(target.getBoundingClientRect().top - navOffset()) < 72) {
      mode = 'following';
      lockId = '';
    }
  }
}

function refresh() {
  promote();

  const path = currentPath();
  const onChapter = isChapterPath(path);
  const headings = onChapter ? getHeadings() : [];
  const saved = store.pages[path];
  const display = chooseHeading(headings, saved);
  const place = toPlace(display, headings, path);

  if (onChapter && mode !== 'remembering') {
    schedulePersist(place, path, headings);
  }

  if (mode === 'following') {
    syncHash(display?.id || '');
  }

  paintOutline(place);
  paintSidebar();

  const latest = store.latestPath ? store.pages[store.latestPath] || null : null;
  const canResume = mode === 'remembering' && Boolean(saved?.hash) && headings.some((heading) => heading.id === saved?.hash);

  snapshot = {
    path,
    latest,
    onChapter,
    onLatest: Boolean(latest && latest.path === path),
    canResume,
    place: canResume && saved ? saved : place,
    label: canResume ? '上次读到' : '读到',
  };

  document.documentElement.classList.toggle('reading-dock-on', Boolean(snapshot.place) && !canResume);
  listeners.forEach((listener) => listener(snapshot));
}

function chooseHeading(headings: HTMLElement[], saved?: ReadingPlace) {
  if (mode === 'locked' && lockId) {
    return headings.find((heading) => heading.id === lockId) || null;
  }

  if (mode === 'remembering' && saved?.hash) {
    return headings.find((heading) => heading.id === saved.hash) || null;
  }

  if (mode === 'following' || mode === 'idle') {
    return headingAtReadingLine(headings);
  }

  return null;
}

function schedulePersist(place: ReadingPlace | null, path: string, headings: HTMLElement[]) {
  if (mode === 'remembering' || mode === 'idle' || !isChapterPath(path)) {
    return;
  }

  const write = () => {
    if (mode === 'locked') {
      const locked = headings.find((heading) => heading.id === lockId);

      if (locked) {
        writePage(toPlace(locked, headings, path));
      }

      return;
    }

    if (mode === 'following' && (place || window.scrollY > 320)) {
      writePage(place ?? chapterStart(path, headings.length));
    }
  };

  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(write, 350);
}

function flushSave() {
  window.clearTimeout(saveTimer);

  if (mode !== 'following' || !isChapterPath(activePath)) {
    return;
  }

  const headings = getHeadings();
  const line = headingAtReadingLine(headings);
  writePage(line ? toPlace(line, headings, activePath) : chapterStart(activePath, headings.length));
}

function writePage(place: ReadingPlace | null) {
  if (!place) {
    return;
  }

  store.pages[place.path] = place;
  store.latestPath = place.path;
  persistStore();
  snapshot = {
    ...snapshot,
    latest: place,
    onLatest: place.path === currentPath(),
  };
  listeners.forEach((listener) => listener(snapshot));
}

function chapterStart(path: string, total: number): ReadingPlace {
  return {
    path,
    hash: '',
    heading: '本章开头',
    chapter: chapterTitle(),
    index: 0,
    total,
    updatedAt: Date.now(),
  };
}

function toPlace(heading: HTMLElement | null, headings: HTMLElement[], path: string): ReadingPlace | null {
  if (!heading || !path) {
    return null;
  }

  const index = headings.findIndex((item) => item.id === heading.id);

  return {
    path,
    hash: heading.id,
    heading: headingText(heading),
    chapter: chapterTitle(),
    index: index + 1,
    total: headings.length,
    updatedAt: Date.now(),
  };
}

function paintOutline(place: ReadingPlace | null) {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.VPDocAsideOutline .outline-link'));

  if (!place?.hash) {
    links.forEach((link) => {
      link.classList.remove('reading-outline-read', 'reading-outline-current', 'reading-outline-unread');
    });
    paintedId = '';
    return;
  }

  const currentIndex = links.findIndex((link) => linkHash(link) === place.hash);

  links.forEach((link, index) => {
    link.classList.toggle('reading-outline-read', currentIndex >= 0 && index < currentIndex);
    link.classList.toggle('reading-outline-current', index === currentIndex);
    link.classList.toggle('reading-outline-unread', currentIndex >= 0 && index > currentIndex);
  });

  if (currentIndex >= 0 && paintedId !== place.hash) {
    paintedId = place.hash;
    const current = links[currentIndex];
    const container = scrollableParent(current);

    if (container) {
      const containerBox = container.getBoundingClientRect();
      const linkBox = current.getBoundingClientRect();

      if (linkBox.top < containerBox.top + 8 || linkBox.bottom > containerBox.bottom - 8) {
        container.scrollTop += linkBox.top - containerBox.top - container.clientHeight / 2 + current.offsetHeight / 2;
      }
    }
  }
}

function paintSidebar() {
  const latestPath = store.latestPath;

  document.querySelectorAll<HTMLAnchorElement>('.VPSidebarItem a.link').forEach((link) => {
    const path = normalizePath(new URL(link.href, location.origin).pathname);
    const current = link.closest('.VPSidebarItem')?.classList.contains('is-active');
    const marked = Boolean(latestPath) && path === latestPath && !current;
    link.classList.toggle('reading-sidebar-current', marked);
  });
}

function nudgeLockedHeading() {
  if (mode !== 'locked' || !lockId || currentPath() !== activePath) {
    return;
  }

  const target = document.getElementById(lockId);

  if (!target || Math.abs(target.getBoundingClientRect().top - navOffset()) < 72) {
    return;
  }

  const root = document.documentElement;
  const previous = root.style.scrollBehavior;
  root.style.scrollBehavior = 'auto';
  target.scrollIntoView({ block: 'start', behavior: 'auto' });
  root.style.scrollBehavior = previous;
  promote();
  refresh();
}

function syncHash(id: string) {
  if (hashId() === id) {
    return;
  }

  const next = `${location.pathname}${location.search}${id ? `#${encodeURIComponent(id)}` : ''}`;
  history.replaceState(history.state, '', next);
}

function outlineReady(path: string) {
  if (!isChapterPath(path) || !document.querySelector('.VPDoc .aside')) {
    return true;
  }

  return document.querySelectorAll('.VPDocAsideOutline .outline-link').length > 0;
}

function contentMatchesLocation(path: string) {
  if (path === '/') {
    return Boolean(document.querySelector('.VPHome'));
  }

  if (isChapterPath(path)) {
    const active = document.querySelector<HTMLAnchorElement>('.VPSidebarItem.is-active > .item > a.link');

    if (!active || !document.querySelector('.vp-doc h1')) {
      return false;
    }

    return normalizePath(new URL(active.href, location.origin).pathname) === path;
  }

  return Boolean(document.querySelector('.vp-doc h1, .VPHome'));
}

function getHeadings() {
  return Array.from(document.querySelectorAll<HTMLElement>('.vp-doc h2, .vp-doc h3')).filter((heading) => heading.id);
}

function headingAtReadingLine(headings: HTMLElement[]) {
  const line = navOffset() + 12;
  let current: HTMLElement | null = null;

  for (const heading of headings) {
    if (heading.getBoundingClientRect().top <= line) {
      current = heading;
    } else {
      break;
    }
  }

  return current;
}

function headingText(heading: HTMLElement) {
  const clone = heading.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.header-anchor').forEach((node) => node.remove());
  return clone.textContent?.replace(/\s+/g, ' ').trim() || '';
}

function chapterTitle() {
  const heading = document.querySelector<HTMLElement>('.vp-doc h1');
  return heading ? headingText(heading) : document.title;
}

function navOffset() {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--vp-nav-height');
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed + 24 : 92;
}

function scrollableParent(element: HTMLElement) {
  let parent = element.parentElement;

  while (parent && parent !== document.body && parent !== document.documentElement) {
    const style = getComputedStyle(parent);
    const scrolls = /(auto|scroll)/.test(style.overflowY);

    if (scrolls && parent.scrollHeight > parent.clientHeight + 8) {
      return parent;
    }

    parent = parent.parentElement;
  }

  return null;
}

function linkHash(link: HTMLAnchorElement) {
  const raw = link.getAttribute('href') || '';
  const id = raw.startsWith('#') ? raw.slice(1) : '';

  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

export function currentPath() {
  return normalizePath(location.pathname);
}

function normalizePath(pathname: string) {
  let path = pathname;
  const base = import.meta.env.BASE_URL;

  if (base !== '/' && path.startsWith(base)) {
    path = `/${path.slice(base.length)}`;
  }

  path = path.replace(/\.html$/, '').replace(/\/index$/, '');

  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  return path || '/';
}

function isChapterPath(path: string) {
  return path.startsWith('/chapters/');
}

function hashId() {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : '';

  if (!raw) {
    return '';
  }

  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function toAbsoluteUrl(path: string, hash: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const hashPart = hash ? `#${encodeURIComponent(hash)}` : '';
  return `${location.origin}${base}${path}${hashPart}`;
}

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return { latestPath: '', pages: {} };
    }

    const parsed = JSON.parse(raw) as Store;

    if (!parsed || typeof parsed !== 'object' || typeof parsed.pages !== 'object') {
      return { latestPath: '', pages: {} };
    }

    return {
      latestPath: typeof parsed.latestPath === 'string' ? parsed.latestPath : '',
      pages: parsed.pages,
    };
  } catch {
    return { latestPath: '', pages: {} };
  }
}

function persistStore() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // 隐私模式或存储满了时，阅读位置只留在当前页面的链接上。
  }
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.append(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    return copied;
  }
}
