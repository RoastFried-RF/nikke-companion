/// <reference types="vite/client" />

/** 개발 실행에서만 채워지는 샘플 결과 파일의 절대 경로. 빌드·테스트에서는 빈 문자열(vite.config.ts). */
declare const __DEV_SAMPLE_REPORT__: string;

/**
 * 개발 실행에서만 채워지는 샘플 파일의 절대 경로: 입력(계정·전투 조건·후보 편성·업그레이드 후보·보스 묶음)과
 * 티어 결과. 빌드·테스트에서는 null.
 */
declare const __DEV_SAMPLES__: {
  account: string;
  condition: string;
  squads: string;
  upgrades: string;
  bosses: string;
  tier: string;
} | null;
