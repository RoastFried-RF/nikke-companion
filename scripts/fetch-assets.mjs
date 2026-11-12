#!/usr/bin/env node
// 리소스 받기: 게임사의 공식 도구 사이트 CDN에서 앱이 쓸 이미지를 data/assets/(gitignore)로 받는다.
//
//   node scripts/fetch-assets.mjs --list       받을 것의 종류별 개수만 보여 준다 (네트워크를 쓰지 않는다)
//   node scripts/fetch-assets.mjs --manifest   받을 목록을 data/assets/manifest.json에 쓴다 (네트워크를 쓰지 않는다)
//   node scripts/fetch-assets.mjs --run        목록을 쓰고 실제로 받는다 (사람이 실행한다 — 먼저 --list로 확인할 것)
//
// 받는 호스트는 한 곳으로 정해져 있고 바꾸는 옵션이 없다. 규칙은 scripts/fetch-assets-lib.mjs, 설명은 docs/ui-redesign.md §리소스.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASSETS_DIR,
  buildManifest,
  CDN_ORIGIN,
  countByKind,
  DEFAULT_CONCURRENCY,
  DEFAULT_DELAY_MS,
  KIND_LABELS,
  MANIFEST_FILE,
  runFetch,
} from './fetch-assets-lib.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ENGINE_DIR = path.join(ROOT, 'vendor', 'nikke-calc');
const SCRAPED = path.join(ENGINE_DIR, 'scraper', 'nikke_scraped.json');
const ENGINE_IMAGES = path.join(ENGINE_DIR, 'image');

const USAGE = [
  '쓰는 법:',
  '  node scripts/fetch-assets.mjs --list       받을 것의 종류별 개수 (네트워크를 쓰지 않는다)',
  `  node scripts/fetch-assets.mjs --manifest   받을 목록을 ${MANIFEST_FILE}에 쓴다 (네트워크를 쓰지 않는다)`,
  '  node scripts/fetch-assets.mjs --run        실제로 받는다 (이미 있는 것은 건너뛴다)',
].join('\n');

function loadManifest() {
  if (!fs.existsSync(SCRAPED)) {
    throw new Error(`엔진의 캐릭터 목록이 없다: ${SCRAPED} — 서브모듈(vendor/nikke-calc)을 받았는지 확인하라`);
  }
  const scraped = JSON.parse(fs.readFileSync(SCRAPED, 'utf8').replace(/^﻿/, ''));
  const enginePortraits = fs.existsSync(ENGINE_IMAGES) ? fs.readdirSync(ENGINE_IMAGES) : [];
  return { manifest: buildManifest({ scraped, enginePortraits }), enginePortraits };
}

/** 엔진 폴더에 이미 있는 초상화의 평균 크기(바이트). 받을 것의 크기를 어림하는 데만 쓴다. 없으면 null. */
function averagePortraitBytes(enginePortraits) {
  const sizes = enginePortraits
    .filter((file) => file.endsWith('.webp'))
    .slice(0, 400)
    .map((file) => fs.statSync(path.join(ENGINE_IMAGES, file)))
    .filter((stat) => stat.isFile())
    .map((stat) => stat.size);
  return sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : null;
}

const kb = (bytes) => `${Math.round(bytes / 1024).toLocaleString('ko-KR')} KB`;

function printList(manifest, enginePortraits) {
  const counts = countByKind(manifest);
  const total = manifest.entries.length;
  const average = averagePortraitBytes(enginePortraits);
  console.log('리소스 받기 — 받을 것 (이 목록을 만드는 데 네트워크를 쓰지 않았다)');
  console.log(`  출처: ${manifest.host}`);
  console.log(`        ${manifest.host_note}`);
  console.log(`  저장: ${ASSETS_DIR}/ (gitignore — 저장소에 넣지 않는다)`);
  console.log(`  속도: 한 번에 ${DEFAULT_CONCURRENCY}개, 요청 사이 ${DEFAULT_DELAY_MS}ms`);
  console.log('');
  console.log('받을 것');
  if (counts.length === 0) console.log('  없다');
  for (const { label, count } of counts) console.log(`  ${label}: ${count}개`);
  console.log(`  합계: ${total}개` + (total > 0 && average ? ` — 어림 크기 ${kb(average * total)}(엔진 폴더의 초상화 평균 ${kb(average)} 기준)` : ''));
  const present = manifest.already_present?.portrait ?? 0;
  if (present > 0) console.log(`  (${KIND_LABELS.portrait} ${present}장은 엔진 폴더의 image/에 이미 있어 받지 않는다 — 앱이 거기서 읽는다)`);
  if (manifest.skipped.length) console.log(`  (목록에서 뺀 것 ${manifest.skipped.length}건: ${manifest.skipped.map((s) => `${s.name} — ${s.reason}`).join('; ')})`);
  console.log('');
  console.log('받지 않는 것 (주소를 확인하지 못했다 — 추측하지 않는다)');
  for (const u of manifest.unresolved) {
    console.log(`  ${u.label} ${u.wanted.length}종: ${u.reason}`);
    console.log(`    대신: ${u.instead}`);
  }
}

function writeManifest(manifest) {
  const file = path.join(ROOT, MANIFEST_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return file;
}

async function main(argv) {
  const known = ['--list', '--manifest', '--run', '--help'];
  const unknown = argv.filter((a) => !known.includes(a));
  if (unknown.length) {
    console.error(`모르는 인자: ${unknown.join(' ')}\n${USAGE}`);
    return 2;
  }
  if (argv.length === 0 || argv.includes('--help')) {
    console.log(USAGE);
    return argv.length === 0 ? 2 : 0;
  }
  if (argv.length > 1) {
    console.error(`--list · --manifest · --run 가운데 하나만 준다\n${USAGE}`);
    return 2;
  }

  const { manifest, enginePortraits } = loadManifest();
  printList(manifest, enginePortraits);
  if (argv[0] === '--list') return 0;

  const file = writeManifest(manifest);
  console.log('');
  console.log(`목록을 썼다: ${path.relative(ROOT, file).replaceAll('\\', '/')}`);
  if (argv[0] === '--manifest') return 0;

  // --run: 여기서만 네트워크를 쓴다. 받는 호스트는 CDN_ORIGIN 한 곳이다(바꾸는 인자·환경 변수가 없다).
  if (manifest.entries.length === 0) {
    console.log('받을 것이 없다 — 네트워크를 쓰지 않고 끝낸다.');
    return 0;
  }
  console.log('');
  console.log(`${manifest.entries.length}개를 ${CDN_ORIGIN}에서 받는다…`);
  const report = await runFetch(manifest, {
    root: ROOT,
    onEvent: (event) => {
      if (event.type === 'downloaded') console.log(`  받음  ${event.entry.dest} (${kb(event.bytes)})`);
      else if (event.type === 'skipped') console.log(`  있음  ${event.entry.dest}`);
      else console.log(`  실패  ${event.entry?.name ?? '?'} — ${event.reason}`);
    },
  });
  console.log('');
  console.log(`받음 ${report.downloaded.length} · 이미 있음 ${report.skipped.length} · 실패 ${report.failed.length} · 거부 ${report.rejected.length} · 시도하지 않음 ${report.not_attempted.length}`);
  for (const f of [...report.rejected, ...report.failed]) console.log(`  실패: [${KIND_LABELS[f.kind] ?? f.kind}] ${f.name} — ${f.reason}`);
  if (report.halted) console.log('연달아 실패해 멈췄다 — 주소 규칙이 바뀌었거나 서버가 요청을 막았을 수 있다. 다시 두드리지 말고 원인을 먼저 확인하라.');
  return report.failed.length || report.rejected.length || report.not_attempted.length ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    console.error(`리소스 받기를 하지 못했다: ${e?.message ?? e}`);
    process.exitCode = 1;
  },
);
