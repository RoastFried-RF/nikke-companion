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
    // 저장소 루트의 계산 코드(src/core)를 그대로 가져다 쓴다. 복제하지 않는다.
    alias: { '@core': here('../src/core') },
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
  },
  };
});
