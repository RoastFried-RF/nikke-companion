<script setup lang="ts">
// 계산의 진행 표시: 도는 동안의 단계·건수·예산·경과 시간, 중단으로 끝난 뒤의 '중단됨' 줄.
// 추천·비교, 요격전, 성장 비교가 같은 표시를 쓴다(lib/engineRun.ts의 실행 상태를 그대로 그린다).
import type { EngineRun } from '../lib/engineRun';
import type { BossProgress, SearchStage } from '../types';

defineProps<{ run: EngineRun }>();

/** 진행 줄 앞에 붙이는 보스 이름(요격전 추천). 그 밖의 계산에서는 붙이지 않는다. */
function bossLabel(b: BossProgress | null): string {
  return b ? `보스 ${b.index + 1}/${b.total}(${b.boss.name}) ` : '';
}

/** 진행 줄 앞에 붙이는 단계 이름. 배치 탐색을 끈 추천(단계가 하나)과 비교에서는 붙이지 않는다. */
function stageLabel(s: SearchStage | null): string {
  if (!s || s.stages < 2) return '';
  return `${s.stage}/${s.stages}단계(${s.stage === 1 ? '멤버 조합' : '배치'}) `;
}
</script>

<template>
  <p v-if="run.stopped && !run.computing" class="run__stopped" role="status" data-testid="compute-stopped">
    중단됨 — 계산을 멈췄다. 결과는 계산 전 그대로다.
  </p>

  <p v-if="run.computing" class="run__progress" role="status" aria-live="polite" data-testid="compute-progress">
    <template v-if="run.progress">
      엔진 계산 중 — {{ bossLabel(run.boss) }}{{ stageLabel(run.stage) }}{{ run.progress.done }}/{{ run.progress.total }}건 끝남
      <span class="run__bar" role="progressbar" aria-valuemin="0" :aria-valuemax="run.progress.total" :aria-valuenow="run.progress.done">
        <span class="run__bar-fill" :style="{ width: `${run.progress.total ? (run.progress.done / run.progress.total) * 100 : 0}%` }"></span>
      </span>
    </template>
    <template v-else-if="run.stage || run.boss">{{ bossLabel(run.boss) }}{{ stageLabel(run.stage) }}계산 준비 중</template>
    <template v-else>입력 파일과 엔진 데이터를 읽는 중</template>
    <!-- 예산은 엔진에 맡긴 요청 수로 센다(캐시에서 채운 요청도 센다) — 계산 코드가 단계마다 알려 준 값이다. -->
    <span v-if="run.stage" class="run__budget" data-testid="compute-budget">
      {{ run.boss ? '이 보스의 ' : '' }}예산 {{ run.stage.budget }}건 중 {{ run.stage.used + run.stage.requests }}건
    </span>
    <span class="run__elapsed" data-testid="compute-elapsed">{{ run.elapsed }}초</span>
  </p>
</template>

<style scoped>
.run__stopped {
  margin: 0;
  color: var(--muted);
}

.run__progress {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  margin: 0;
  color: var(--accent);
}

.run__bar {
  flex: 1;
  min-width: 48px;
  height: 4px;
  border-radius: 2px;
  background: var(--line);
  overflow: hidden;
}

.run__bar-fill {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 0.2s ease;
}

.run__budget {
  color: var(--muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.run__elapsed {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
</style>
