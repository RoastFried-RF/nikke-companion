import { createApp } from 'vue';
import App from './App.vue';
import { galleryRequested } from './lib/gallery';
import './style.css';
// 디자인 토큰(UI 개편). 변수만 정한다 — 기존 화면의 모양은 바뀌지 않는다.
import './styles/tokens.css';

// 부품 모아 보기는 개발 실행에서만 뜬다(주소에 ?gallery, 또는 VITE_UI_GALLERY=1로 시작).
// `import.meta.env.DEV`는 빌드할 때 false로 굳어 이 갈래와 그 화면의 코드가 빌드 결과에서 빠진다.
if (import.meta.env.DEV && galleryRequested(true, window.location.search, import.meta.env.VITE_UI_GALLERY)) {
  void import('./ui/gallery/UiGallery.vue').then(({ default: UiGallery }) => createApp(UiGallery).mount('#app'));
} else {
  createApp(App).mount('#app');
}
