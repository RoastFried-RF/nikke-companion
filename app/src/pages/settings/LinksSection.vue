<script setup lang="ts">
// 설정 > 다른 도구(P-033 — 도구 링크): 커뮤니티 도구 목록(이름 · 한 줄 설명 · 주소)과 「이 앱이 하지 않는 것」.
// 목록은 앱에 든 문서다(lib/links.ts — 출처는 모음집 글). 누르면 **기본 브라우저**로 연다: 화면이 넘기는 것은 목록의 id뿐이고
// (주소가 아니다), 이 화면에는 주소를 적는 칸도 바깥으로 가는 링크(a 태그)도 없다 — 목록에 없는 주소를 열 길이 없다.
// 이 앱은 그 사이트들의 내용을 가져오지 않는다. 주소는 글자로만 보인다(브라우저가 열리지 않을 때 직접 적어 열 수 있게).
import { ref } from 'vue';
import { errorMessage } from '../../lib/backend';
import { openLink, TOOL_LINKS } from '../../lib/links';
import StatusPill from '../../ui/StatusPill.vue';

const book = TOOL_LINKS;
/** 방금 연 도구의 이름. */
const opened = ref('');
const error = ref('');
/** 여는 중인 도구의 id(연달아 누르는 것을 막는다). */
const opening = ref('');

async function open(id: string): Promise<void> {
  if (opening.value) return;
  opening.value = id;
  error.value = '';
  opened.value = '';
  try {
    opened.value = (await openLink(id)).name;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    opening.value = '';
  }
}
</script>

<template>
  <div class="links" data-testid="settings-links">
    <section class="nk-card" aria-label="다른 도구" data-testid="links-card">
      <div class="nk-row">
        <h2 class="nk-subtitle">다른 도구</h2>
        <span class="nk-muted">커뮤니티에서 만든 니케 도구 {{ book.links.length }}개 — 누르면 기본 브라우저로 연다</span>
      </div>
      <p class="nk-muted" data-testid="links-source">
        출처: {{ book.source.where }} 「{{ book.source.title }}」{{ book.source.checked_at ? ` — ${book.source.checked_at}에 직접 열어 본 것만 담았다` : '' }}.
        이 앱은 이 사이트들의 내용을 가져오지 않는다. 한 줄 설명은 그날 열어 본 기록을 줄인 것이라 지금과 다를 수 있다.
      </p>
      <p v-if="opened" class="nk-note" role="status" data-testid="links-opened">{{ opened }} — 기본 브라우저로 열었다.</p>
      <p v-if="error" class="nk-error" role="alert" data-testid="links-error"><strong>열지 못했다.</strong> {{ error }}</p>

      <ul class="links__list" data-testid="links-list">
        <li v-for="link in book.links" :key="link.id" class="links__item" :data-link="link.id" data-testid="link-item">
          <div class="links__text">
            <strong data-testid="link-name">{{ link.name }}</strong>
            <span data-testid="link-description">{{ link.description }}</span>
            <span class="links__url" data-testid="link-url">{{ link.url }}</span>
          </div>
          <StatusPill
            v-if="link.basis === 'category'"
            label="설명은 분류만"
            tone="neutral"
            detail="열어 본 기록에 이 도구의 기능이 자세히 남아 있지 않아 분류 한마디만 적었다"
            data-testid="link-basis"
          />
          <button type="button" class="nk-btn" :disabled="opening !== ''" :title="`${link.name}을(를) 기본 브라우저로 연다`" data-testid="link-open" @click="open(link.id)">
            브라우저로 열기
          </button>
        </li>
      </ul>
    </section>

    <!-- 이 앱이 하지 않는 것: 왜 하지 않는지와 대신 쓸 도구. 접지 않는다. -->
    <section class="nk-card" aria-label="이 앱이 하지 않는 것" data-testid="links-unsupported">
      <div class="nk-row">
        <h2 class="nk-subtitle">이 앱이 하지 않는 것</h2>
        <span class="nk-muted">아래는 이 앱에 없다 — 해당 도구를 쓴다</span>
      </div>
      <ul class="links__list">
        <li v-for="topic in book.not_supported" :key="topic.id" class="links__item" :data-topic="topic.id" data-testid="unsupported-item">
          <div class="links__text">
            <div class="nk-row">
              <strong data-testid="unsupported-topic">{{ topic.topic }}</strong>
              <StatusPill label="지원하지 않음" tone="unknown" data-testid="unsupported-pill" />
            </div>
            <span data-testid="unsupported-reason">{{ topic.reason }}</span>
          </div>
          <div class="links__go">
            <button
              v-for="link in topic.links"
              :key="link.id"
              type="button"
              class="nk-btn nk-btn--quiet"
              :disabled="opening !== ''"
              :title="`${link.name}을(를) 기본 브라우저로 연다`"
              :data-link="link.id"
              data-testid="unsupported-open"
              @click="open(link.id)"
            >
              {{ link.name }} 열기
            </button>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.links {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-4);
  min-height: 0;
}

.links__list {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.links__item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--nk-space-3);
  padding: var(--nk-space-3) var(--nk-space-4);
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-md);
  background: var(--nk-surface-raised);
}

.links__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--nk-space-2);
  min-width: calc(var(--nk-tile-lg) * 2);
}

.links__url {
  color: var(--nk-text-faint);
  font-size: var(--nk-font-sm);
  overflow-wrap: anywhere;
  user-select: text;
}

.links__go {
  display: flex;
  flex-wrap: wrap;
  gap: var(--nk-space-2);
}
</style>
