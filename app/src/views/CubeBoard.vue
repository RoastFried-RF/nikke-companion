<script setup lang="ts">
// 큐브 비교의 그림(P-031): 「이 편성에 맞는 큐브」(니케마다 가장 좋았던 큐브와 함께 끼웠을 때의 총딜)와 니케별로 바꿔 본 줄들.
// 받은 결과(src/core/efficiency.mjs의 compareCubes)를 그리기만 한다. 보유 큐브를 모른다는 것, 상한 때문에 보지 못한 큐브,
// 계산하지 못한 큐브, 지원하지 않는 큐브는 접힌 구획 밖이다.
import { damageUnit, signedPercent } from '../lib/format';
import type { CubeNikke, CubeReport, NikkeInfo } from '../types';
import DetailsFold from '../ui/DetailsFold.vue';
import NikkeTile from '../ui/NikkeTile.vue';
import StatusPill from '../ui/StatusPill.vue';

defineProps<{ report: CubeReport; info: (name: string) => NikkeInfo }>();

/** 니케마다 먼저 보이는 줄 수. 나머지는 접어 둔다. */
const SHOWN = 3;
const rate = (x: number | null): string => (x === null ? '–' : signedPercent(x));
const tone = (gain: number): string => (gain > 0 ? 'ok' : gain < 0 ? 'error' : 'neutral');
const currentNote = (n: CubeNikke): string =>
  n.current.source === 'default' ? '계정에 적혀 있지 않아 계산 도구의 기본 큐브로 계산했다' : n.current.owned_level !== null ? `계정을 받을 때 끼고 있던 큐브(Lv.${n.current.owned_level})` : '계정에 적힌 큐브';
</script>

<template>
  <div class="cube" data-testid="cube-board">
    <section class="cube__rec" aria-label="이 편성에 맞는 큐브" data-testid="cube-rec" :data-status="report.recommendation.status">
      <div class="nk-row">
        <h3 class="nk-subtitle">이 편성에 맞는 큐브</h3>
        <StatusPill label="추정" tone="estimate" detail="계산으로 어림한 값이다. 실제 전투 기록과 맞춰 본 적이 없다." />
        <StatusPill label="보유 여부 모름" tone="unknown" detail="계정 정보에는 계정을 받을 때 끼고 있던 큐브만 있다. 추천한 큐브를 갖고 있는지, 몇 레벨인지는 직접 확인한다." data-testid="cube-owned-unknown" />
      </div>
      <ul class="cube__picks">
        <li v-for="p in report.recommendation.picks" :key="p.nikke" class="cube__pick" :data-nikke="p.nikke" :data-changed="p.changed ? 'yes' : 'no'" data-testid="cube-pick">
          <NikkeTile :name="p.nikke" size="mini" :element="info(p.nikke).element" :burst="info(p.nikke).burst" />
          <span class="cube__who">{{ p.nikke }}</span>
          <strong data-testid="cube-pick-name">{{ p.cube }}</strong>
          <span v-if="p.changed" class="cube__change" data-tone="ok" data-testid="cube-pick-change">혼자 바꾸면 {{ rate(p.alone_change) }}</span>
          <span v-else class="nk-muted" data-testid="cube-pick-keep">지금 큐브 그대로 — 더 나은 것을 찾지 못했다</span>
          <span v-if="p.owned_level !== null" class="nk-muted" data-testid="cube-pick-owned">계정에서 본 레벨 Lv.{{ p.owned_level }}</span>
        </li>
      </ul>
      <p v-if="report.recommendation.status === 'computed'" class="cube__together" data-testid="cube-together">
        함께 끼우면 총딜 <strong :data-tone="tone(report.recommendation.gain ?? 0)" class="cube__gain">{{ rate(report.recommendation.gain_rate) }}</strong
        ><span class="nk-muted"> ({{ damageUnit(report.baseline.total_damage) }} → {{ damageUnit(report.recommendation.total_damage) }})</span>
      </p>
      <p v-else-if="report.recommendation.status === 'unchanged'" class="nk-note" data-testid="cube-together">견줘 본 큐브 가운데 지금 큐브보다 총딜이 느는 것이 없다.</p>
      <p v-else class="nk-note" data-testid="cube-together">
        <StatusPill label="계산하지 못함" tone="error" /> 추천한 큐브를 함께 끼운 총딜은 계산하지 못했다(0으로 치지 않는다). {{ report.recommendation.reason }}
      </p>
    </section>

    <!-- 접지 않는 것: 상한 때문에 보지 못한 큐브, 계산하지 못한 큐브, 지원하지 않는 큐브. -->
    <p v-if="report.skipped_cubes.length" class="nk-note" data-testid="cube-skipped">
      한 번에 {{ report.candidates.limit }}건까지만 계산한다. 보지 못한 큐브 {{ report.skipped_cubes.length }}종: {{ report.skipped_cubes.join(', ') }} — 니케 한 명만 골라 다시 보면 더 많이 견준다.
    </p>
    <p v-if="report.failed.length" class="nk-note" data-testid="cube-failed">
      계산하지 못한 것 {{ report.failed.length }}건(0으로 치지 않고 뺐다):
      <span v-for="(f, i) in report.failed" :key="i" class="cube__chip" data-testid="cube-failed-item">{{ f.nikke }} {{ f.cube }} — {{ f.reason }}</span>
    </p>
    <p v-if="report.unsupported.length" class="nk-note" data-testid="cube-unsupported">
      <StatusPill label="지원하지 않음" tone="unknown" /> {{ report.unsupported.join(', ') }} — 계산 도구가 효과를 계산하지 못하는 큐브라 견주지 않았다.
    </p>

    <section v-for="n in report.nikkes" :key="n.nikke" class="cube__nikke" :data-nikke="n.nikke" data-testid="cube-nikke">
      <div class="nk-row">
        <NikkeTile :name="n.nikke" size="mini" :element="info(n.nikke).element" :burst="info(n.nikke).burst" />
        <strong>{{ n.nikke }}</strong>
        <span class="nk-muted" data-testid="cube-current">지금 {{ n.current.name }} Lv.{{ n.current.level }} — {{ currentNote(n) }}</span>
      </div>
      <ul class="cube__rows">
        <li v-for="row in n.rows.slice(0, SHOWN)" :key="row.cube" class="cube__row" :data-cube="row.cube" data-testid="cube-row">
          <span class="cube__name" data-testid="cube-row-name">{{ row.cube }} <span class="nk-muted">Lv.{{ row.level }}</span></span>
          <strong class="cube__change" :data-tone="tone(row.gain)" data-testid="cube-row-change">{{ rate(row.change) }}</strong>
          <span class="nk-muted" data-testid="cube-row-total">{{ damageUnit(row.total_damage) }}</span>
          <span v-if="row.owned_level !== null" class="nk-muted" data-testid="cube-row-owned">계정에서 본 레벨 Lv.{{ row.owned_level }}</span>
        </li>
      </ul>
      <DetailsFold v-if="n.rows.length > SHOWN" summary="나머지 큐브" :count="n.rows.length - SHOWN" data-testid="cube-more">
        <ul class="cube__rows">
          <li v-for="row in n.rows.slice(SHOWN)" :key="row.cube" class="cube__row" :data-cube="row.cube" data-testid="cube-row">
            <span class="cube__name" data-testid="cube-row-name">{{ row.cube }} <span class="nk-muted">Lv.{{ row.level }}</span></span>
            <strong class="cube__change" :data-tone="tone(row.gain)" data-testid="cube-row-change">{{ rate(row.change) }}</strong>
            <span class="nk-muted" data-testid="cube-row-total">{{ damageUnit(row.total_damage) }}</span>
            <span v-if="row.owned_level !== null" class="nk-muted" data-testid="cube-row-owned">계정에서 본 레벨 Lv.{{ row.owned_level }}</span>
          </li>
        </ul>
      </DetailsFold>
      <p v-if="n.rows.length === 0" class="nk-muted" data-testid="cube-no-rows">이 니케는 견준 큐브가 없다.</p>
    </section>
  </div>
</template>

<style scoped>
.cube {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-4);
  min-width: 0;
}

.cube__rec,
.cube__nikke {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-3);
  padding: var(--nk-space-4);
  border: var(--nk-border-width) solid var(--nk-border);
  border-radius: var(--nk-radius-md);
}

.cube__rec {
  border-color: var(--nk-accent);
  background: var(--nk-surface-raised);
}

.cube__picks,
.cube__rows {
  display: flex;
  flex-direction: column;
  gap: var(--nk-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.cube__pick,
.cube__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--nk-space-3);
}

.cube__who,
.cube__name {
  min-width: calc(var(--nk-tile-lg) * 1.6);
  overflow-wrap: anywhere;
}

.cube__change {
  min-width: calc(var(--nk-tile-sm) + var(--nk-space-4));
  color: var(--nk-tone);
}

.cube__gain {
  color: var(--nk-tone);
}

.cube__together {
  margin: 0;
  font-size: var(--nk-font-lg);
}

.cube__chip {
  display: inline-block;
  margin-right: var(--nk-space-3);
}
</style>
