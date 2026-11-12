import { createApp } from 'vue';
import App from './App.vue';
import Overlay from './Overlay.vue';
import { OVERLAY_WINDOW, windowLabel } from './lib/backend';
import { galleryRequested } from './lib/gallery';
import './style.css';
// 디자인 토큰(UI 개편)과 데스크톱 앱 화면들이 함께 쓰는 모양.
import './styles/tokens.css';
import './styles/app.css';

// 부품 모아 보기는 개발 실행에서만 뜬다(주소에 ?gallery, 또는 VITE_UI_GALLERY=1로 시작).
// `import.meta.env.DEV`는 빌드할 때 false로 굳어 이 갈래와 그 화면의 코드가 빌드 결과에서 빠진다.
if (import.meta.env.DEV && galleryRequested(true, window.location.search, import.meta.env.VITE_UI_GALLERY)) {
  void import('./ui/gallery/UiGallery.vue').then(({ default: UiGallery }) => createApp(UiGallery).mount('#app'));
} else {
  // 창이 둘이다(src-tauri/tauri.conf.json): 오버레이 창('main')은 결과만 보여 주는 작은 화면을, 데스크톱 앱 창('app')은
  // 메뉴와 화면 여섯을 그린다. 앱 밖(브라우저의 개발 서버)에서는 앱 창의 화면을 그린다.
  createApp(windowLabel() === OVERLAY_WINDOW ? Overlay : App).mount('#app');
}
