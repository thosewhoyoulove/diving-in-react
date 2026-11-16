<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { onContentUpdated, withBase } from 'vitepress';
import {
  copyProgressLink,
  emptySnapshot,
  getSnapshot,
  queueReadingSetup,
  subscribe,
  type ReadingPlace,
  type ReadingSnapshot,
} from './reading-progress';

const props = defineProps<{
  variant: 'nav' | 'home' | 'banner' | 'outline' | 'dock';
}>();

if (props.variant === 'outline') {
  onContentUpdated(() => {
    queueReadingSetup();
  });
}

const snapshot = ref<ReadingSnapshot>(emptySnapshot());
const copied = ref(false);
let stop = () => {};
let copiedTimer = 0;

onMounted(() => {
  snapshot.value = getSnapshot();
  stop = subscribe((next) => {
    snapshot.value = next;
  });
});

onUnmounted(() => {
  stop();
  window.clearTimeout(copiedTimer);
});

const latest = computed(() => snapshot.value.latest);
const place = computed(() => snapshot.value.place);
const showNav = computed(() => props.variant === 'nav' && latest.value && !snapshot.value.onLatest);
const showHome = computed(() => props.variant === 'home' && latest.value);
const showBanner = computed(() => {
  if (props.variant !== 'banner' || !latest.value || snapshot.value.path === '/') {
    return false;
  }

  if (snapshot.value.onChapter) {
    return snapshot.value.canResume;
  }

  return true;
});
const showOutline = computed(() => props.variant === 'outline' && snapshot.value.onChapter && place.value);
const showDock = computed(() => props.variant === 'dock' && place.value && !snapshot.value.canResume);

const cardPlace = computed(() => {
  if (snapshot.value.canResume && place.value) {
    return place.value;
  }

  return latest.value;
});

function placeHref(item: ReadingPlace | null) {
  if (!item) {
    return withBase('/');
  }

  const hash = item.hash ? `#${encodeURIComponent(item.hash)}` : '';
  return withBase(`${item.path}${hash}`);
}

async function onCopy() {
  copied.value = await copyProgressLink();
  window.clearTimeout(copiedTimer);
  copiedTimer = window.setTimeout(() => {
    copied.value = false;
  }, 1600);
}
</script>

<template>
  <a
    v-if="showNav && latest"
    class="reading-nav"
    :href="placeHref(latest)"
    :title="`${latest.chapter} · ${latest.heading}`"
  >
    继续阅读
  </a>

  <section v-else-if="showHome && cardPlace" class="reading-home" aria-label="继续阅读">
    <div class="reading-card">
      <div>
        <p class="reading-card__eyebrow">继续阅读</p>
        <h2>{{ cardPlace.chapter }}</h2>
        <p class="reading-card__place">上次停在「{{ cardPlace.heading }}」</p>
        <p v-if="cardPlace.total" class="reading-card__meta">本节 {{ cardPlace.index }} / {{ cardPlace.total }}</p>
      </div>
      <div class="reading-card__actions">
        <a class="reading-button primary" :href="placeHref(cardPlace)">接着读</a>
        <button class="reading-button" type="button" @click="onCopy">{{ copied ? '已复制' : '复制链接' }}</button>
      </div>
      <p class="reading-card__note">换一台设备时，打开这条链接就会回到同一小节。</p>
    </div>
  </section>

  <aside v-else-if="showBanner && cardPlace" class="reading-banner" aria-label="阅读位置">
    <div>
      <p class="reading-banner__label">{{ snapshot.canResume ? '上次读到' : '继续阅读' }}</p>
      <p class="reading-banner__place">
        <template v-if="snapshot.canResume">「{{ cardPlace.heading }}」</template>
        <template v-else>{{ cardPlace.chapter }} · {{ cardPlace.heading }}</template>
      </p>
    </div>
    <div class="reading-card__actions">
      <a class="reading-button primary" :href="placeHref(cardPlace)">{{ snapshot.canResume ? '回到这里' : '接着读' }}</a>
      <button class="reading-button" type="button" @click="onCopy">{{ copied ? '已复制' : '复制链接' }}</button>
    </div>
  </aside>

  <div v-else-if="showOutline && place" class="reading-outline">
    <p class="reading-outline__label">{{ snapshot.label }} <span v-if="place.total">{{ place.index }} / {{ place.total }}</span></p>
    <p class="reading-outline__title">{{ place.heading }}</p>
    <button class="reading-outline__copy" type="button" @click="onCopy">{{ copied ? '已复制' : '复制进度链接' }}</button>
  </div>

  <div v-else-if="showDock && place" class="reading-dock">
    <p>{{ snapshot.label }} {{ place.index }}/{{ place.total }} {{ place.heading }}</p>
    <button type="button" @click="onCopy">{{ copied ? '已复制' : '复制链接' }}</button>
  </div>
</template>
