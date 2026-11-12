// 게임 이미지와 니케 정보: 화면 쪽의 도우미(lib/images.ts·lib/nikkeInfo.ts)와 Rust 명령과의 계약.
// 이미지는 코드로 만든 가짜 바이트다. 니케 정보의 카탈로그는 실제 엔진 데이터(tests/helpers/fakeEngine.ts)다.
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bossImage, gameIcon, nikkePortrait } from '../src/lib/backend';
import { bossImageUrl, clearImageCache, iconUrl, portraitUrl, toDataUrl } from '../src/lib/images';
import { clearNikkeCatalog, infoLabel, loadNikkeCatalog, nikkeInfo, nikkeInfoFrom, nikkeInfos, UNKNOWN_LABEL } from '../src/lib/nikkeInfo';
import capability from '../src-tauri/capabilities/overlay.json';
import tauriConf from '../src-tauri/tauri.conf.json';
import buildRs from '../src-tauri/build.rs?raw';
import cargoToml from '../src-tauri/Cargo.toml?raw';
import assetsRs from '../src-tauri/src/assets.rs?raw';
import libRs from '../src-tauri/src/lib.rs?raw';
import gitignore from '../../.gitignore?raw';
import bossBundle from '../../data/intercept/anomaly.json';
import imagesSource from '../src/lib/images.ts?raw';
import { catalog } from './helpers/fakeEngine';
import { fakeImage, fakeWebpData, MISSING, mockImages, urlOf } from './helpers/fakeImages';

beforeEach(() => {
  clearImageCache();
  clearNikkeCatalog();
});
afterEach(() => clearMocks());

/** 주석을 뺀 Rust 코드. */
const code = (source: string) =>
  source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
const beforeTests = (source: string) => source.slice(0, source.indexOf('#[cfg(test)]'));

describe('이미지 명령 호출', () => {
  it('명령 이름과 인자가 Rust 쪽과 같다', async () => {
    const { calls } = mockImages({ portraits: ['크라운'], bosses: { kraken: 'capture' }, icons: { 'element:작열': 'engine' } });
    await expect(nikkePortrait('크라운')).resolves.toEqual(fakeImage('portrait:크라운'));
    await expect(bossImage('kraken')).resolves.toEqual(fakeImage('boss:kraken', 'capture', 'image/png'));
    await expect(gameIcon('element', '작열')).resolves.toEqual(fakeImage('icon:element:작열'));
    expect(calls).toEqual([
      { cmd: 'nikke_portrait', args: { name: '크라운' } },
      { cmd: 'boss_image', args: { id: 'kraken' } },
      { cmd: 'game_icon', args: { kind: 'element', key: '작열' } },
    ]);
    expect(libRs).toMatch(/async fn nikke_portrait\(app: AppHandle, name: String\) -> Result<assets::GameImage, String>/);
    expect(libRs).toMatch(/async fn boss_image\(app: AppHandle, id: String\) -> Result<assets::GameImage, String>/);
    expect(libRs).toMatch(/async fn game_icon\(app: AppHandle, kind: String, key: String\) -> Result<assets::GameImage, String>/);
  });

  it('Rust가 넘기는 모양과 화면의 타입이 같은 네 칸이다', () => {
    const rust = assetsRs.slice(assetsRs.indexOf('pub struct GameImage {'), assetsRs.indexOf('impl GameImage {'));
    expect(rust.match(/^\s*pub (\w+):/gm)?.map((f) => f.trim())).toEqual(['pub found:', 'pub mime:', 'pub data:', 'pub source:']);
    expect(Object.keys(MISSING)).toEqual(['found', 'mime', 'data', 'source']);
    // 어디서 읽었는지의 낱말도 같다.
    expect(assetsRs).toMatch(/#\[serde\(rename_all = "lowercase"\)\]\s*pub enum ImageSource \{[^}]*Engine,[^}]*Assets,[^}]*Capture,\s*\}/);
  });

  it('새 명령 셋은 권한 목록에 있고, 파일·네트워크 플러그인은 더하지 않았다', () => {
    for (const cmd of ['nikke_portrait', 'boss_image', 'game_icon']) {
      expect(buildRs).toContain(`"${cmd}"`);
      expect(capability.permissions).toContain(`allow-${cmd.replaceAll('_', '-')}`);
    }
    for (const p of capability.permissions) expect(p).not.toMatch(/^(fs|shell|http|websocket|opener|process|dialog|updater|asset):/);
    expect(cargoToml).not.toMatch(/tauri-plugin-(fs|http|upload|shell|opener|dialog)|^\s*(reqwest|ureq|base64|image|webp)\s*=/m);
    // 이미지는 data: 주소로 그린다 — CSP를 넓히지 않았고, 파일을 주소로 바로 여는 길(asset 프로토콜)도 켜지 않았다.
    expect(tauriConf.app.security.csp).toContain("img-src 'self' data:;");
    expect(tauriConf.app.security.csp).not.toMatch(/blob:|asset:|https?:\/\/asset/);
    expect(JSON.stringify(tauriConf)).not.toMatch(/assetProtocol/);
  });
});

describe('이미지 읽기의 규칙(Rust)', () => {
  const rules = code(beforeTests(assetsRs));
  const glue = code(libRs.slice(libRs.indexOf('// ── 게임 이미지'), libRs.indexOf('// ── 계정 받기')));

  it('화면이 넘긴 문자열은 경로가 아니라 열쇠다 — 카탈로그·보스 묶음·아이콘 표에 있을 때만 읽는다', () => {
    // 초상화: 카탈로그에 있는지 본 뒤에야 파일 이름을 만든다.
    const portrait = rules.slice(rules.indexOf('pub fn portrait('), rules.indexOf('pub fn is_boss_id('));
    expect(portrait.indexOf('.is_some_and(|names| names.contains(name))')).toBeGreaterThan(-1);
    expect(portrait.indexOf('if !known {')).toBeLessThan(portrait.indexOf('safe_filename(name)'));
    // 보스: 글자 검사와 묶음 확인이 파일 읽기보다 먼저다.
    const boss = rules.slice(rules.indexOf('pub fn boss_image('), rules.indexOf('pub struct IconSlot'));
    expect(boss.indexOf('if !is_boss_id(id) {')).toBeGreaterThan(-1);
    expect(boss.indexOf('if !is_boss_id(id) {')).toBeLessThan(boss.indexOf('boss_ids(&file)'));
    expect(boss.indexOf('if !known {')).toBeLessThan(boss.indexOf('read_webp_or_png('));
    // 아이콘: 표에서 찾은 자리의 이름만 쓴다 — 화면이 준 글자는 파일 이름에 들어가지 않는다.
    const icon = rules.slice(rules.indexOf('pub fn icon('));
    expect(icon).toMatch(/let Some\(slot\) = icon_slot\(kind, key\) else \{\s*return GameImage::missing\(\);/);
    expect(icon).not.toMatch(/format!|join\(k(ind|ey)\)/);
    // 파일을 읽는 곳은 한 함수이고, 이름 하나짜리 경로와 이미지 형식·크기를 확인한다.
    expect(rules.match(/fs::read\(/g)).toHaveLength(1);
    const read = rules.slice(rules.indexOf('fn read_image('), rules.indexOf('fn read_webp_or_png('));
    for (const check of ['if !is_plain_file_name(file_name) {', 'meta.len() > MAX_IMAGE_BYTES', 'fs::canonicalize(dir)', 'real_file.parent() != Some(real_dir.as_path())', 'sniff_mime(&bytes)?']) {
      expect(read, check).toContain(check);
    }
    expect(assetsRs).toContain('pub const MAX_IMAGE_BYTES: u64 = 2 * 1024 * 1024;');
  });

  it('없는 이미지는 오류가 아니다 — 읽는 함수들은 실패하지 않는 모양이다', () => {
    for (const signature of [
      'pub fn portrait(dirs: &ImageDirs, index: &NameIndex, name: &str) -> GameImage',
      'pub fn boss_image(dirs: &ImageDirs, id: &str) -> GameImage',
      'pub fn icon(dirs: &ImageDirs, kind: &str, key: &str) -> GameImage',
    ]) {
      expect(rules).toContain(signature);
    }
    expect(rules).not.toMatch(/\bpanic!|\.unwrap\(\)|\.expect\(/);
  });

  it('이미지 모듈은 네트워크·프로세스·창에 닿지 않고 쓰지도 않는다 — 읽기만 한다', () => {
    expect(rules).not.toMatch(/std::net|std::process|Command::new|tauri|windows::|reqwest|ureq/);
    expect(rules).not.toMatch(/fs::write|fs::remove|fs::create_dir|fs::rename|fs::copy|File::create|OpenOptions/);
    // 화면이 폴더를 정하지 못한다: 엔진 폴더는 엔진 계산과 같은 설정에서, 저장소 루트는 실행 파일 자리에서 찾는다.
    expect(glue).toMatch(/engine_dir: engine_config\(app\)\.ok\(\)\.map\(\|config\| config\.engine_dir\),\s*repo_root: capture::find_repo_root\(&search_from\),/);
    expect(glue).not.toMatch(/std::env::var|PathBuf::from\(/);
    expect(glue.match(/#\[tauri::command\]/g)).toHaveLength(3);
  });

  it('읽는 자리: 엔진 폴더의 image/ · data/assets/ · data/captures/bosses/ — 받아 둔 것과 캡처는 저장소에 넣지 않는다', () => {
    expect(assetsRs).toContain('pub const ENGINE_IMAGE_DIR: &str = "image";');
    expect(assetsRs).toContain('pub const ASSETS_SUBDIR: [&str; 2] = ["data", "assets"];');
    expect(assetsRs).toContain('pub const BOSS_CAPTURES_SUBDIR: [&str; 3] = ["data", "captures", "bosses"];');
    expect(assetsRs).toContain('pub const BOSS_BUNDLE_FILE: [&str; 3] = ["data", "intercept", "anomaly.json"];');
    const ignored = gitignore.split(/\r?\n/);
    expect(ignored).toContain('data/assets/');
    expect(ignored).toContain('data/captures/');
    // 내장 보스 묶음의 id는 이미지 명령이 받는 글자뿐이다.
    for (const boss of bossBundle.bosses) expect(boss.id).toMatch(/^[a-z0-9_-]{1,64}$/);
  });
});

describe('이미지 주소(lib/images.ts)', () => {
  it('Rust가 넘긴 이미지를 data: 주소로 바꾼다 — 없거나 그릴 수 없는 형식이면 null', () => {
    expect(toDataUrl(fakeImage('a'))).toBe(`data:image/webp;base64,${fakeWebpData('a')}`);
    expect(toDataUrl(fakeImage('b', 'capture', 'image/png'))).toMatch(/^data:image\/png;base64,/);
    expect(toDataUrl(MISSING)).toBeNull();
    expect(toDataUrl(null)).toBeNull();
    expect(toDataUrl(undefined)).toBeNull();
    // found가 true여도 형식·내용이 이상하면 그리지 않는다.
    expect(toDataUrl({ found: true, mime: 'text/html', data: 'PGh0bWw+', source: 'assets' })).toBeNull();
    expect(toDataUrl({ found: true, mime: 'image/svg+xml', data: 'PHN2Zz4=', source: 'assets' })).toBeNull();
    expect(toDataUrl({ found: true, mime: 'image/webp', data: '', source: 'engine' })).toBeNull();
    expect(toDataUrl({ found: true, mime: null, data: 'AAAA', source: 'engine' })).toBeNull();
  });

  it('있는 이미지는 주소로, 없는 이미지는 null로 — 한 번 물은 것은 다시 묻지 않는다', async () => {
    const { calls } = mockImages({ portraits: ['크라운'], bosses: { kraken: 'assets' }, icons: { 'burst:1': 'assets' } });
    expect(await portraitUrl('크라운')).toBe(urlOf(fakeImage('portrait:크라운')));
    expect(await portraitUrl('없는 니케')).toBeNull();
    expect(await bossImageUrl('kraken')).toBe(urlOf(fakeImage('boss:kraken', 'assets')));
    expect(await bossImageUrl('ultra')).toBeNull();
    expect(await iconUrl('burst', '1')).toBe(urlOf(fakeImage('icon:burst:1', 'assets')));
    expect(await iconUrl('weapon', 'SR')).toBeNull();
    expect(calls).toHaveLength(6);
    // 같은 것을 다시 물어도(있든 없든) 명령을 다시 부르지 않는다.
    await Promise.all([portraitUrl('크라운'), portraitUrl('없는 니케'), bossImageUrl('kraken'), iconUrl('weapon', 'SR'), iconUrl('burst', '1')]);
    expect(calls).toHaveLength(6);
    // 종류가 다르면 이름이 같아도 다른 것이다.
    await iconUrl('element', '1');
    await bossImageUrl('크라운');
    expect(calls.slice(6).map((c) => c.cmd)).toEqual(['game_icon', 'boss_image']);
    // 버리면 다시 묻는다.
    clearImageCache();
    await portraitUrl('크라운');
    expect(calls).toHaveLength(9);
  });

  it('명령이 실패하면 없는 것으로 그리고, 다음에 다시 묻는다', async () => {
    let fail = true;
    let asked = 0;
    mockIPC(() => {
      asked += 1;
      if (fail) throw '작업을 끝내지 못했다';
      return fakeImage('뒤늦게');
    });
    expect(await portraitUrl('크라운')).toBeNull();
    fail = false;
    expect(await portraitUrl('크라운')).toBe(urlOf(fakeImage('뒤늦게')));
    expect(asked).toBe(2);
  });

  it('앱 창이 아닌 곳(명령을 부를 수 없는 곳)에서도 거부하지 않고 null을 준다', async () => {
    clearMocks();
    await expect(portraitUrl('크라운')).resolves.toBeNull();
    await expect(bossImageUrl('kraken')).resolves.toBeNull();
    await expect(iconUrl('element', '작열')).resolves.toBeNull();
  });

  it('이미지를 네트워크로 받지 않는다 — 주소는 data: 뿐이다', () => {
    expect(imagesSource).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|https?:|blob:|createObjectURL|convertFileSrc|asset:/);
    expect(imagesSource).toContain('`data:${image.mime};base64,${image.data}`');
  });
});

describe('니케 정보(lib/nikkeInfo.ts)', () => {
  it('이름으로 속성·버스트 단계·무기·기업·클래스·등급을 얻는다(실제 엔진 카탈로그)', () => {
    expect(nikkeInfoFrom(catalog, '크라운')).toEqual({
      name: '크라운',
      known: true,
      element: '철갑',
      burst: '2',
      weapon: 'MG',
      corp: '필그림',
      klass: '방어형',
      rarity: 'SSR',
    });
    // 카탈로그의 모든 니케에서 여섯 칸이 읽힌다 — 값은 카탈로그의 낱말 그대로다.
    const names = Object.keys(catalog.nikkes);
    expect(names.length).toBeGreaterThan(150);
    for (const name of names) {
      const info = nikkeInfoFrom(catalog, name);
      const row = catalog.nikkes[name];
      expect(info.known, name).toBe(true);
      expect([info.element, info.burst, info.weapon, info.corp, info.klass, info.rarity], name).toEqual([
        row.element_code,
        row.burst_stage,
        row.weapon_type,
        row.manufacturer,
        row.class,
        row.rarity,
      ]);
    }
    expect(new Set(names.map((n) => nikkeInfoFrom(catalog, n).element))).toEqual(new Set(['작열', '풍압', '철갑', '전격', '수냉']));
    expect(new Set(names.map((n) => nikkeInfoFrom(catalog, n).burst))).toEqual(new Set(['1', '2', '3', 'A']));
  });

  it('카탈로그에 없는 값은 「모름」이다 — 지어내지 않는다', () => {
    const unknown = { name: '없는 니케', known: false, element: null, burst: null, weapon: null, corp: null, klass: null, rarity: null };
    expect(nikkeInfoFrom(catalog, '없는 니케')).toEqual(unknown);
    expect(nikkeInfoFrom(null, '없는 니케')).toEqual(unknown);
    expect(nikkeInfoFrom(undefined, '크라운').known).toBe(false);
    // 객체에 원래 있는 이름(toString 등)을 니케로 착각하지 않는다.
    for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) expect(nikkeInfoFrom(catalog, name).known, name).toBe(false);
    // 칸이 빠졌거나 글자가 아닌 값은 그 칸만 「모름」이다.
    const partial = { nikkes: { 가: { element_code: '작열', burst_stage: 3, weapon_type: '', manufacturer: null }, 나: null }, bosses: [] } as never;
    expect(nikkeInfoFrom(partial, '가')).toEqual({ name: '가', known: true, element: '작열', burst: null, weapon: null, corp: null, klass: null, rarity: null });
    expect(nikkeInfoFrom(partial, '나').known).toBe(false);
    expect(UNKNOWN_LABEL).toBe('모름');
    expect(infoLabel(null)).toBe('모름');
    expect(infoLabel(undefined)).toBe('모름');
    expect(infoLabel('  ')).toBe('모름');
    expect(infoLabel('철갑')).toBe('철갑');
  });

  it('이미 있는 카탈로그 명령(engine_catalog)을 쓰고, 한 번만 읽는다', async () => {
    const { calls } = mockImages();
    expect((await nikkeInfo('크라운')).element).toBe('철갑');
    expect((await nikkeInfo('없는 니케')).known).toBe(false);
    const [a, b] = await nikkeInfos(['라피 : 레드 후드', '없는 니케']);
    expect([a.name, a.known, b.name, b.known]).toEqual(['라피 : 레드 후드', true, '없는 니케', false]);
    await loadNikkeCatalog();
    expect(calls.map((c) => c.cmd)).toEqual(['engine_catalog']);
    // 니케 정보를 위한 Rust 명령을 따로 만들지 않았다.
    expect(libRs).not.toMatch(/fn nikke_info\(/);
  });

  it('카탈로그를 읽지 못해도 거부하지 않는다 — 전부 「모름」이고, 다음에 다시 읽는다', async () => {
    const { calls } = mockImages({ catalogFails: true });
    const info = await nikkeInfo('크라운');
    expect(info).toEqual({ name: '크라운', known: false, element: null, burst: null, weapon: null, corp: null, klass: null, rarity: null });
    expect((await nikkeInfos(['크라운']))[0].known).toBe(false);
    expect(calls.length).toBe(2);
    clearMocks();
    mockImages();
    expect((await nikkeInfo('크라운')).known).toBe(true);
  });
});
