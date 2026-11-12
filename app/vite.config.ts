import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig(({ command, mode }) => {
  // 개발 실행(tauri dev)에서만 샘플 경로를 입력란에 미리 채운다. 빌드와 테스트에서는 비운다.
  const dev = command === 'serve' && mode !== 'test';
  return {
  plugins: [vue()],
  // Tauri가 띄운 터미널에서 Rust 오류가 지워지지 않게 한다.
  clearScreen: false,
  resolve: {
    // 저장소 루트의 계산 코드(src/core, src/tier)를 그대로 가져다 쓴다. 복제하지 않는다.
    alias: { '@core': here('../src/core'), '@tier': here('../src/tier') },
  },
  define: {
    __DEV_SAMPLE_REPORT__: JSON.stringify(dev ? here('./tests/fixtures/compare.sample.json') : ''),
    // 계산 실행 칸의 샘플 입력(검증용 데이터). 빌드와 테스트에서는 null이다.
    __DEV_SAMPLES__: JSON.stringify(
      dev
        ? {
            account: here('../data/samples/account.sample.json'),
            condition: here('../data/samples/condition.solo-raid.json'),
            squads: here('../data/samples/squads.sample.json'),
            upgrades: here('../data/samples/upgrades.sample.json'),
            // 요격전의 보스 묶음은 게임 화면에서 확인한 실제 묶음이다(검증용 묶음이 아니다).
            bosses: here('../data/intercept/anomaly.json'),
            // 티어 화면의 샘플은 실제 CLI로 만든 테스트 입력이다(일부 니케만 계산한 결과).
            tier: here('./tests/fixtures/tier.sample.json'),
          }
        : null,
    ),
  },
  server: {
    // tauri.conf.json의 devUrl과 같은 포트. 다른 포트로 옮겨 가지 않는다.
    port: 1420,
    strictPort: true,
    // 이 PC 안에서만 연다.
    host: 'localhost',
    // 루트의 src/core를 읽을 수 있게 한다.
    fs: { allow: [here('..')] },
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
    // 테스트 실행기는 CSS 파일의 내용을 비워 버린다. 전역 스타일 둘(디자인 토큰·예전 변수)은 내용 그대로 읽게 한다 —
    // tests/DesignTokens.test.ts가 토큰의 이름·값을 확인하고, tests/contract.test.ts의 정적 검사도 이 내용을 본다.
    css: { include: [/src[\\/]styles[\\/]tokens\.css/, /src[\\/]style\.css/] },
  },
  };
});
