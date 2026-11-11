// 계산 엔진(vendor/nikke-calc) 어댑터.
// 엔진의 요청·결과 JSON 계약(vendor/nikke-calc/docs/SIM-JSON.md)만 쓴다. 엔진 코드는 고치지 않는다.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_ENGINE_DIR = path.resolve(fileURLToPath(new URL('../../vendor/nikke-calc', import.meta.url)));

/** 엔진이 아는 니케와 보스 프리셋. 이름 검증과 버스트 단계 확인에 쓴다. */
export function loadCatalog(engineDir = DEFAULT_ENGINE_DIR) {
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(engineDir, rel), 'utf8'));
  const nikkes = read('data/parsed_nikke.json');
  const bosses = Object.keys(read('data/boss_presets.json')).filter((k) => !k.startsWith('_'));
  return { nikkes, bosses };
}

/** 엔진 버전. 결과에 함께 남겨 어떤 엔진으로 계산했는지 추적한다. */
export function engineVersion(engineDir = DEFAULT_ENGINE_DIR) {
  const r = spawnSync('git', ['-C', engineDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return { repo: 'Jgaram/nikke-calc', commit: r.status === 0 ? r.stdout.trim() : null };
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
