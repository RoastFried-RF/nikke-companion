// 편성 탐색 2단계 — 배치 순서 탐색과 시뮬 예산.
// 같은 5명이라도 배치 순서에 따라 총딜이 달라진다. 1단계(src/core/candidates.mjs)는 멤버 조합마다 배치를 하나만
// 만들므로, 여기서 1단계 상위 조합의 **배치 변형**을 만들고 정해진 시뮬 예산 안에서 무엇을 계산할지 정한다.
// 엔진을 부르지 않는 순수 함수만 있다(계산 흐름은 candidates.mjs의 suggestSquads). 형식은 docs/data-model.md §배치 탐색.
//
// ── 변형 규칙의 근거(엔진 문서) ─────────────────────────────────────────────────────────────────────
// 무작위 순열(5! = 120가지)을 다 돌리지 않는다. 엔진 문서가 「배치가 결과를 바꾼다」고 적은 두 가지만 바꾼다.
//
// (가) 같은 버스트 단계 안의 순서 — vendor/nikke-calc/docs/GAMEPLAY.md §버스트 사용 순서와 배치:
//      「스쿼드 멤버 순서는 같은 단계의 자동 사용 우선순위다. … 1·2·3단계 모두 같은 규칙으로 앞에서부터 쿨이 풀린
//      첫 니케가 쓴다」, 「같은 단계에 여러 명이면 앞사람이 준비돼 있는 한 계속 선점하고, 쿨이면 뒷사람이 나간다」.
//      → 단계가 같은 멤버끼리의 앞뒤만 뜻이 있다. 단계가 다른 멤버 사이의 앞뒤는 이 규칙에 나오지 않는다.
//      같은 절 「`burst_stage: "A"` 캐릭터」: 「자동 버스트 후보는 B3에만 넣는다」 → 전 단계(A) 니케는 3단계 묶음으로 센다.
//
// (나) 3번 자리에 누가 서는가 — vendor/nikke-calc/docs/CONTROL.md §카메라:
//      「카메라는 … 풀차지 버스트 게이지 배율이 붙는 대상」을 정하고, single 모드의 유도 규칙은 조작 주인이 한 명인
//      차지 무기가 아니면 「3번 자리(squad[2])」, 「전투가 시작되면 카메라는 3번 자리에서 출발한다」.
//      「비차지 무기는 `full_charge_mult`가 없어 무영향」 → 3번 자리 후보는 차지 무기 멤버 각각 + 비차지 대표 하나뿐이다.
//      「카메라만 옮기는 것은 공짜다」 절의 측정: 차지형이 있는 19스쿼드에서 97.1%~106.6%(평균 +1.21%).
//
// 그래서 배치 하나를 「단계별 순서 + 3번 자리」(서명)로 줄여 보고, 서명이 같은 배치는 한 번만 계산한다.
// 이 프로젝트의 확인(2026-11-12, 엔진 67835ca, 샘플 계정·솔로 레이드 S40, 한 조합의 120가지 배치 전부 × 두 조합):
// 총딜을 가른 것은 (가)였다(29.5억~38.7억, 18.5억~19.6억). (나)와 서명이 같은 배치끼리의 차이는 0.1% 이하였다.
// 그래서 예산이 모자라면 (가)만 바꾼 변형을 먼저, (나)만 바꾼 변형을 다음에, 둘 다 바꾼 변형을 마지막에 계산한다.
//
// 다루지 않는 것(결과의 caveats에도 적는다): 누가 버스트를 쓰지 않을지(`operation.no_burst`)·`burst_sequence` 같은
// 운용 지정, 스킬로 버스트 단계가 바뀌는 니케(라피 : 레드 후드의 `burst_stage_override`), 무기 변경으로 차지형이
// 되는 니케, 좌표 모드 보스에서 카메라 니케의 조준(지금은 보스 프리셋만 쓴다 — 간단 모드).

/** 전체 시뮬 횟수의 기본 예산(1단계 + 2단계). 시뮬 1회가 4~5초, 4개 병렬이면 2~3분이다. */
export const DEFAULT_BUDGET = 120;
/** 2단계를 적용하는 1단계 상위 조합 수의 기본값. */
export const DEFAULT_REFINE_TOP = 5;
/** 카메라가 출발하는 자리 — 3번 자리(squad[2]). CONTROL.md §카메라. */
export const CAMERA_SLOT = 2;

const ORDER_GROUPS = ['1', '2', '3'];
const infoOf = (catalog, name) => (Object.hasOwn(catalog?.nikkes ?? {}, name) ? catalog.nikkes[name] : null);

/**
 * 자동 버스트 순서를 다투는 묶음: '1' | '2' | '3', 없으면 null.
 * 전 단계(A) 니케는 3단계 묶음이다(GAMEPLAY.md §`burst_stage: "A"` 캐릭터).
 */
export function burstOrderGroup(info) {
  const stage = info?.burst_stage;
  if (stage === 'A') return '3';
  return ORDER_GROUPS.includes(stage) ? stage : null;
}

/**
 * 카메라의 풀차지 버스트 게이지 배율을 받을 수 있는 니케인가(차지 무기). 엔진의 판정(`_is_charge_nikke`)과 같이
 * `full_charge_mult`가 있으면 그렇다. 무기 정보가 아예 없으면 null(모름) — 후보에서 빼지 않는다.
 */
export function isChargeWeapon(info) {
  if (info === null || typeof info !== 'object') return null;
  if (info.full_charge_mult !== undefined && info.full_charge_mult !== null) return true;
  if (info.is_charge === true) return true;
  if (info.is_charge === false || typeof info.weapon_type === 'string') return false;
  return null;
}

/** 3번 자리에 섰을 때 카메라가 뜻을 갖는(또는 가질지 모르는) 멤버인가. */
const cameraMatters = (catalog, name) => isChargeWeapon(infoOf(catalog, name)) !== false;

/**
 * 배치의 서명: 단계별 순서(가)와 3번 자리의 카메라 대상(나). 카메라 대상은 차지 무기 멤버면 그 이름,
 * 비차지면 null(누가 서든 같다). 서명이 같은 배치는 위 규칙으로는 같은 배치다.
 * @param {string[]} members 배치 순서대로의 멤버 이름
 * @param {{nikkes: object}} catalog
 * @returns {{orders: {1: string[], 2: string[], 3: string[]}, camera: string | null, key: string}}
 */
export function placementSignature(members, catalog) {
  const orders = { 1: [], 2: [], 3: [] };
  for (const name of members) {
    const group = burstOrderGroup(infoOf(catalog, name));
    if (group) orders[group].push(name);
  }
  const third = members[CAMERA_SLOT];
  const camera = third !== undefined && cameraMatters(catalog, third) ? third : null;
  return { orders, camera, key: JSON.stringify([orders[1], orders[2], orders[3], camera]) };
}

/** 사전순(원래 순서가 맨 앞)의 모든 순열. */
function permutations(items) {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * 단계별 순서를 정한 배치(`base`)에서 `name`을 3번 자리로 옮긴다. 묶음 안의 앞뒤는 그대로 둔다 —
 * 같은 묶음에서 `name`보다 앞인 멤버는 1·2번 자리에, 뒤인 멤버는 4·5번 자리에 둔다. 그렇게 둘 수 없으면 null.
 */
function withThird(base, name, catalog) {
  if (base[CAMERA_SLOT] === name) return base;
  const group = burstOrderGroup(infoOf(catalog, name));
  const at = base.indexOf(name);
  const sameGroup = (other) => group !== null && burstOrderGroup(infoOf(catalog, other)) === group;
  const ahead = base.filter((other, i) => i < at && sameGroup(other));
  const behind = base.filter((other, i) => i > at && sameGroup(other));
  const frontSize = CAMERA_SLOT;
  const backSize = base.length - CAMERA_SLOT - 1;
  if (ahead.length > frontSize || behind.length > backSize) return null;
  const free = base.filter((other) => other !== name && !ahead.includes(other) && !behind.includes(other));
  const frontFree = free.slice(0, frontSize - ahead.length);
  const inFront = new Set([...ahead, ...frontFree]);
  // base의 순서를 지키며 앞·뒤로 나눈다 → 다른 묶음의 앞뒤도 그대로다.
  const front = base.filter((other) => inFront.has(other));
  const back = base.filter((other) => other !== name && !inFront.has(other));
  return [...front, name, ...back];
}

/**
 * 한 멤버 조합의 배치 변형. 순수 함수 — 같은 입력이면 같은 변형이 같은 순서로 나온다.
 *
 * 만드는 법: (가) 묶음마다 순서의 모든 순열 × (나) 3번 자리 후보(차지 무기 멤버 각각 + 비차지 대표 하나).
 * 원래 배치와 서명이 같은 것은 뺀다(원래 배치는 1단계에서 이미 계산했다). 서명마다 배치 하나만 만든다 —
 * 원래 배치의 자리 틀(몇 번 자리가 몇 단계인가)에 새 순서를 채우고, 3번 자리가 목표와 다를 때만 그 멤버를 옮긴다.
 *
 * 나오는 순서(= 예산이 모자랄 때 먼저 계산하는 순서): 단계 안 순서만 바꾼 것(tier 1) → 3번 자리만 바꾼 것(tier 2)
 * → 둘 다 바꾼 것(tier 3). 근거는 이 파일 머리말의 측정.
 *
 * @param {string[]} members 원래 배치
 * @param {{nikkes: object}} catalog
 * @returns {{members: string[], tier: 1 | 2 | 3, order_changed: string[], camera_changed: boolean, changes: string[]}[]}
 */
export function placementVariants(members, catalog) {
  const original = placementSignature(members, catalog);
  const groupOf = (name) => burstOrderGroup(infoOf(catalog, name));

  // (가) 묶음별 순서의 조합. 맨 앞이 원래 순서다.
  let orderSets = [{}];
  for (const g of ORDER_GROUPS) {
    const perms = permutations(original.orders[g]);
    orderSets = orderSets.flatMap((set) => perms.map((perm) => ({ ...set, [g]: perm })));
  }

  // (나) 3번 자리 후보. 맨 앞이 원래 대상이다. null = 비차지(누가 서든 같다).
  const charged = members.filter((name) => cameraMatters(catalog, name));
  const hasPlain = charged.length < members.length;
  const cameras = [original.camera, ...charged.filter((name) => name !== original.camera)];
  if (hasPlain && original.camera !== null) cameras.push(null);

  const variants = [];
  const seen = new Set([original.key, JSON.stringify(members)]);
  for (const orders of orderSets) {
    const next = { 1: 0, 2: 0, 3: 0 };
    const base = members.map((name) => {
      const g = groupOf(name);
      return g ? orders[g][next[g]++] : name;
    });
    for (const camera of cameras) {
      let placed = null;
      if (camera !== null) placed = withThird(base, camera, catalog);
      else if (!cameraMatters(catalog, base[CAMERA_SLOT])) placed = base;
      else {
        // 비차지 대표: 원래 3번 자리 멤버가 비차지면 그 멤버, 아니면 앞에서부터 옮길 수 있는 첫 비차지 멤버.
        const plain = base.filter((name) => !cameraMatters(catalog, name));
        const preferred = plain.includes(members[CAMERA_SLOT]) ? [members[CAMERA_SLOT], ...plain] : plain;
        for (const name of preferred) {
          placed = withThird(base, name, catalog);
          if (placed) break;
        }
      }
      if (!placed) continue;
      const signature = placementSignature(placed, catalog);
      const sequence = JSON.stringify(placed);
      if (seen.has(signature.key) || seen.has(sequence)) continue;
      seen.add(signature.key);
      seen.add(sequence);

      const orderChanged = ORDER_GROUPS.filter((g) => !sameList(signature.orders[g], original.orders[g]));
      const cameraChanged = signature.camera !== original.camera;
      const changes = orderChanged.map((g) => `버스트 ${g}단계 순서 ${signature.orders[g].join(' → ')}`);
      if (cameraChanged) {
        changes.push(
          signature.camera === null
            ? `3번 자리(카메라) ${placed[CAMERA_SLOT]} — 차지 무기가 아니라 카메라 배율이 없다`
            : `3번 자리(카메라) ${signature.camera}`,
        );
      }
      variants.push({
        members: placed,
        tier: cameraChanged ? (orderChanged.length ? 3 : 2) : 1,
        order_changed: orderChanged,
        camera_changed: cameraChanged,
        changes,
      });
    }
  }
  // 안정 정렬: 같은 tier 안에서는 만든 순서(바뀐 묶음이 적은 쪽이 대체로 앞)다.
  return variants
    .map((v, i) => ({ v, i }))
    .sort((a, b) => a.v.tier - b.v.tier || a.v.order_changed.length - b.v.order_changed.length || a.i - b.i)
    .map(({ v }) => v);
}

/**
 * 남은 예산으로 어느 변형을 계산할지 정한다. 순수 함수.
 * 조합마다 변형을 만들고, 순위 순으로 돌아가며 하나씩 고른다(1위의 첫 변형 → 2위의 첫 변형 → … → 1위의 둘째 변형 …).
 * 그래서 예산이 모자라도 상위 조합 모두가 앞 순서의 변형부터 고르게 계산된다.
 *
 * @param {{name: string, members: string[]}[]} combos 2단계 대상 조합(1단계 순위 순)
 * @param {{nikkes: object}} catalog
 * @param {number} remaining 2단계에 쓸 수 있는 시뮬 횟수(0 이상)
 * @returns {{plan: {name: string, members: string[], variants: object[], selected: object[]}[], total: number, requested: number, skipped: number}}
 */
export function planRefinement(combos, catalog, remaining) {
  const plan = combos.map((c) => ({ name: c.name, members: c.members, variants: placementVariants(c.members, catalog), selected: [] }));
  let left = Math.max(0, Math.floor(remaining));
  const rounds = Math.max(0, ...plan.map((p) => p.variants.length));
  for (let round = 0; round < rounds && left > 0; round += 1) {
    for (const p of plan) {
      if (left === 0) break;
      if (round < p.variants.length) {
        p.selected.push(p.variants[round]);
        left -= 1;
      }
    }
  }
  const total = plan.reduce((n, p) => n + p.variants.length, 0);
  const requested = plan.reduce((n, p) => n + p.selected.length, 0);
  return { plan, total, requested, skipped: total - requested };
}

/** 2단계 요청에 붙이는 편성 이름. 실패 목록에 그대로 보인다. */
export const variantName = (comboName, n) => `${comboName} · 배치 변형 ${n}`;

const pct = (ratio) => `${(ratio * 100).toFixed(1)}%`;

/**
 * 배치를 바꿔 얻은 비율의 표기. 보통은 소수 첫째 자리까지다. 차이가 아주 작아 「100.0%」로 보이면
 * (바꿨는데 그대로인 것처럼 읽힌다) 차이가 드러날 때까지 자릿수를 늘린다(넷째 자리까지).
 */
export function gainText(ratio) {
  for (let digits = 1; digits <= 4; digits += 1) {
    const text = (ratio * 100).toFixed(digits);
    if (Number(text) !== 100 || digits === 4) return `${text}%`;
  }
  return pct(ratio);
}

/**
 * 한 조합의 2단계 결과를 고른다: 원래 배치(1단계 결과)와 계산된 변형 가운데 총딜이 가장 높은 하나.
 * 원래 배치를 언제나 후보에 넣으므로 결과의 총딜은 1단계 총딜 이상이다. 같은 총딜이면 원래 배치,
 * 그다음은 먼저 계산한 변형이 이긴다(결정론).
 *
 * @param {object} original 1단계 순위 항목(compareSquads의 ranking 한 줄)
 * @param {{name: string, members: string[], variants: object[], selected: object[]}} item planRefinement의 한 줄
 * @param {Map<string, object>} computed 변형 이름(variantName) → 2단계 순위 항목. 엔진이 실패한 변형은 없다
 * @returns {object} 순위 항목 — 가장 좋은 배치의 수치에 조합 이름, 메모(notes), `placement`를 붙인 것
 */
export function pickBestPlacement(original, item, computed) {
  let best = original;
  let bestVariant = null;
  let simulated = 0;
  for (const [i, variant] of item.selected.entries()) {
    const entry = computed.get(variantName(item.name, i + 1));
    if (!entry) continue;
    simulated += 1;
    if (entry.total_damage > best.total_damage) {
      best = entry;
      bestVariant = variant;
    }
  }
  const failed = item.selected.length - simulated;
  const skipped = item.variants.length - item.selected.length;
  const gainRatio = original.total_damage > 0 ? best.total_damage / original.total_damage : null;

  let memo;
  if (bestVariant) {
    memo = `배치 탐색: 배치를 바꿔 총딜이 1단계 배치의 ${gainRatio === null ? '?' : gainText(gainRatio)}가 됐다 (변형 ${simulated}개 계산). 바꾼 것 — ${bestVariant.changes.join(', ')}.`;
  } else if (simulated > 0) {
    memo = `배치 탐색: 변형 ${simulated}개를 계산했지만 1단계 배치가 가장 좋다 (1단계 대비 ${pct(1)}).`;
  } else if (item.variants.length === 0) {
    memo = '배치 탐색: 이 조합에는 규칙으로 바꿀 배치가 없다 (1단계 배치 그대로).';
  } else {
    memo = '배치 탐색: 계산한 변형이 없다 (1단계 배치 그대로).';
  }
  if (skipped > 0) memo += ` 예산이 모자라 변형 ${skipped}개는 계산하지 못했다.`;
  if (failed > 0) memo += ` 변형 ${failed}개는 엔진이 계산하지 못했다.`;

  return {
    ...best,
    name: original.name,
    notes: [...best.notes, memo],
    placement: {
      changed: bestVariant !== null,
      changes: bestVariant ? [...bestVariant.changes] : [],
      original_members: [...item.members],
      original_total_damage: original.total_damage,
      gain_ratio: gainRatio,
      variants: { total: item.variants.length, simulated, skipped, failed },
    },
  };
}
