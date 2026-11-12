// Node 런타임 — 계산 엔진(vendor/nikke-calc) 어댑터. CLI와 테스트가 쓴다.
// 계산 모듈(src/core)은 이 파일을 import하지 않고 `deps.runtime`으로 받는다(src/core/runtime.mjs).
// 데스크톱 앱에서는 같은 일을 Rust 명령(app/src-tauri/src/engine.rs)이 한다.
// 엔진의 요청·결과 JSON 계약(vendor/nikke-calc/docs/SIM-JSON.md)만 쓴다. 엔진 코드는 고치지 않는다.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '../core/cache.mjs';
import { ENGINE_REPO } from '../core/runtime.mjs';

export const DEFAULT_ENGINE_DIR = path.resolve(fileURLToPath(new URL('../../vendor/nikke-calc', import.meta.url)));

/** 엔진이 아는 니케와 보스 프리셋. 이름 검증과 버스트 단계 확인에 쓴다. */
export function loadCatalog(engineDir = DEFAULT_ENGINE_DIR) {
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(engineDir, rel), 'utf8'));
  const nikkes = read('data/parsed_nikke.json');
  const bosses = Object.keys(read('data/boss_presets.json')).filter((k) => !k.startsWith('_'));
  return { nikkes, bosses };
}

/** 자동 티어가 읽는 엔진 데이터 파일(엔진 저장소 기준 경로). */
export const ENGINE_DATA_FILES = Object.freeze({ nikkes: 'data/parsed_nikke.json', skills: 'data/parsed_skills.json' });

/**
 * 엔진 데이터의 판과 스킬 파싱 현황 — 자동 티어(src/tier/evaluate.mjs의 `deps.engineData`)가 쓴다.
 *   files:  파일 → 내용 해시(SHA-256). 파일 바이트가 아니라 정규화한 JSON(`canonicalJson`)의 해시라서 줄바꿈·공백·키 순서와
 *           무관하다. 엔진 커밋이 같아도 데이터가 손으로 바뀌었으면(dirty) 이 값이 달라진다
 *   skills: 니케 이름 → 파싱된 스킬 효과 수. 이름이 없으면 미파싱이다(엔진 `timeline._check_names`와 같은 기준)
 * 런타임 계약(세 함수)에는 넣지 않았다 — 데스크톱 앱은 아직 티어를 계산하지 않는다.
 */
export function loadEngineData(engineDir = DEFAULT_ENGINE_DIR) {
  const files = {};
  const read = (rel) => {
    const doc = JSON.parse(fs.readFileSync(path.join(engineDir, rel), 'utf8'));
    files[rel] = createHash('sha256').update(canonicalJson(doc), 'utf8').digest('hex');
    return doc;
  };
  read(ENGINE_DATA_FILES.nikkes);
  const parsed = read(ENGINE_DATA_FILES.skills);
  const skills = Object.fromEntries(Object.entries(parsed).map(([name, effects]) => [name, Array.isArray(effects) ? effects.length : 0]));
  return { files, skills };
}

/**
 * 엔진 버전 `{repo, commit, dirty}`. 결과에 함께 남겨 어떤 엔진으로 계산했는지 추적하고, 시뮬 결과 캐시가
 * 이 값으로 쓸지 말지를 정한다(src/core/cache.mjs). `dirty`는 엔진이 결과에 싣는 `evaluator.dirty`와 같은 기준이다:
 * 추적 중인 파일에 커밋하지 않은 변경이 있나(`git status --porcelain -uno`). git을 못 부르면 commit·dirty가 null.
 * `--no-optional-locks`: 엔진 프로세스와 동시에 불려도 `.git/index`를 건드리지 않는다.
 */
export function engineVersion(engineDir = DEFAULT_ENGINE_DIR) {
  const git = (...args) => {
    const r = spawnSync('git', ['--no-optional-locks', '-C', engineDir, ...args], { encoding: 'utf8', windowsHide: true });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  const commit = git('rev-parse', 'HEAD') || null;
  const status = commit === null ? null : git('status', '--porcelain', '-uno');
  return { repo: ENGINE_REPO, commit, dirty: status === null ? null : status !== '' };
}

/** 시뮬 결과 캐시 폴더(gitignore). 형식은 docs/data-model.md §시뮬 결과 캐시. */
export const DEFAULT_CACHE_DIR = path.resolve(fileURLToPath(new URL('../../data/cache/sim', import.meta.url)));

/**
 * 파일 저장소 — `withCache`(src/core/cache.mjs)에 넘기는 저장소 계약의 Node 구현.
 * 항목 하나가 파일 하나다: `<dir>/<키 앞 두 글자>/<키>.json`. 폴더는 처음 저장할 때 만든다.
 * 없는 파일은 빗나감(undefined)이고, 읽을 수 없거나 JSON이 아닌 파일은 던진다 — 감싼 쪽이 경고로 바꾸고 다시 계산한다.
 * 쓰기는 임시 파일에 쓴 뒤 이름을 바꾼다(여러 프로세스가 같이 써도 반쯤 쓴 파일이 읽히지 않게).
 */
export function createFileCacheStore(dir = DEFAULT_CACHE_DIR) {
  const fileOf = (key) => {
    if (typeof key !== 'string' || !/^[0-9a-f]{16,128}$/.test(key)) throw new Error(`캐시 키가 16진수 해시가 아니다: ${String(key).slice(0, 80)}`);
    return path.join(dir, key.slice(0, 2), `${key}.json`);
  };
  return {
    dir,
    get(key) {
      const file = fileOf(key);
      let text;
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch (e) {
        if (e.code === 'ENOENT') return undefined;
        throw new Error(`캐시 파일을 읽을 수 없다 (${file}): ${e.message}`);
      }
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error(`캐시 파일이 JSON이 아니다 (${file}): ${e.message}`);
      }
    },
    set(key, entry) {
      const file = fileOf(key);
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(tmp, JSON.stringify(entry) + '\n', 'utf8');
        fs.renameSync(tmp, file);
      } catch (e) {
        try {
          fs.rmSync(tmp, { force: true });
        } catch {
          // 임시 파일을 만들지도 못했다 — 지울 것이 없다.
        }
        throw new Error(`캐시 파일을 쓸 수 없다 (${file}): ${e.message}`);
      }
    },
  };
}

function runWorker(lines, { engineDir, python, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-m', 'runner.sim', '--batch'], {
      cwd: engineDir,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`엔진 시간 초과 (${Math.round(timeoutMs / 1000)}초)`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (d) => (out += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`엔진을 실행할 수 없다 (${python}): ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const rows = [];
      for (const line of out.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          rows.push(JSON.parse(line));
        } catch {
          reject(new Error(`엔진 출력이 JSON이 아니다: ${line.slice(0, 200)}`));
          return;
        }
      }
      // 배치를 시작하지도 못했으면(코드≠0) 줄 단위 결과가 아니다.
      if (code !== 0) {
        reject(new Error(`엔진 종료 코드 ${code}: ${rows[0]?.error?.message ?? err.slice(-500)}`));
        return;
      }
      resolve(rows);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(lines.join('\n') + '\n');
  });
}

/**
 * 요청 여러 건을 엔진 배치로 돌린다. 반환 배열은 입력 순서와 같다.
 * 요청마다 결과 객체 또는 `{error: {type, message, path}}`가 온다 — 한 건의 오류가 다른 건을 막지 않는다.
 */
export async function runBatch(requests, options = {}) {
  const {
    engineDir = DEFAULT_ENGINE_DIR,
    python = process.env.NIKKE_PYTHON ?? 'python',
    concurrency = Math.max(1, Math.min(4, os.cpus().length - 1)),
    timeoutMs = 10 * 60_000,
  } = options;
  if (requests.length === 0) return [];
  const workers = Math.min(concurrency, requests.length);
  const chunks = Array.from({ length: workers }, () => []);
  requests.forEach((req, i) => chunks[i % workers].push(JSON.stringify({ ...req, id: i })));
  const rows = (await Promise.all(chunks.map((lines) => runWorker(lines, { engineDir, python, timeoutMs })))).flat();
  const results = new Array(requests.length).fill(null);
  for (const row of rows) {
    if (Number.isInteger(row.id) && row.id >= 0 && row.id < results.length) results[row.id] = row;
  }
  const missing = results.findIndex((r) => r === null);
  if (missing >= 0) throw new Error(`엔진이 요청 ${missing}의 결과를 돌려주지 않았다`);
  return results;
}

const defined = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined));

/**
 * 계산 모듈에 넘기는 런타임 객체(src/core/runtime.mjs의 계약).
 * @param {{engineDir?: string, python?: string, concurrency?: number, timeoutMs?: number}} [options]
 */
export function createNodeRuntime(options = {}) {
  const fixed = defined(options);
  return {
    loadCatalog: () => loadCatalog(fixed.engineDir),
    engineVersion: () => engineVersion(fixed.engineDir),
    runBatch: (requests, perCall) => runBatch(requests, { ...fixed, ...defined(perCall) }),
  };
}

/** 기본 설정(vendor/nikke-calc, PATH의 python)의 Node 런타임. */
export const nodeRuntime = createNodeRuntime();
