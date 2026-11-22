import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { checkUpdate, installUpdate, updateMode } from '../src/lib/backend';
import { canStartWork, provideUpdates } from '../src/lib/updates';
import UpdateSection from '../src/pages/settings/UpdateSection.vue';
import conf from '../src-tauri/tauri.conf.json';
import pkg from '../package.json';
import libRs from '../src-tauri/src/lib.rs?raw';
import hooks from '../src-tauri/src/installer.nsh?raw';
import workflow from '../../.github/workflows/release.yml?raw';

vi.mock('../src/lib/backend', () => ({ checkUpdate: vi.fn(), installUpdate: vi.fn(), updateMode: vi.fn() }));

const computing = ref<string | null>(null);
function screen() {
  return mount({
    components: { UpdateSection },
    setup() {
      const updates = provideUpdates(computing);
      void updates.start();
      return { updates };
    },
    template: '<UpdateSection />',
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  computing.value = null;
  vi.mocked(updateMode).mockResolvedValue(true);
});

describe('앱 정보·업데이트', () => {
  it('저장소 실행은 확인하지 않는다', async () => {
    vi.mocked(updateMode).mockResolvedValue(false);
    const w = screen();
    await flushPromises();
    expect(w.text()).toContain('현재 판 ' + pkg.version);
    expect(w.text()).toContain('개발 실행에서는 업데이트하지 않는다');
    expect(checkUpdate).not.toHaveBeenCalled();
  });
  it('자동 확인 선택을 기억하고 수동 확인 중과 최신 판을 표시한다', async () => {
    localStorage.setItem('nikke-companion.auto-update', 'off');
    let finish!: (value: null) => void;
    vi.mocked(checkUpdate).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const w = screen();
    await flushPromises();
    expect(checkUpdate).not.toHaveBeenCalled();
    await w.get('input').setValue(true);
    expect(localStorage.getItem('nikke-companion.auto-update')).toBe('on');
    await w.get('button').trigger('click');
    expect(w.text()).toContain('확인하는 중');
    finish(null);
    await flushPromises();
    expect(w.text()).toContain('최신 판');
  });
  it('새 판과 노트를 보이고 계산 중 설치를 막으며 직접 누르면 진행을 표시한다', async () => {
    vi.mocked(checkUpdate).mockResolvedValue({ rid: 1, version: '1.2.3', body: '첫째\n둘째\n3\n4\n5\n숨긴 줄' });
    vi.mocked(installUpdate).mockImplementation(async (_, progress) => { progress(42, 100); });
    computing.value = 'tier';
    const w = screen();
    await flushPromises();
    expect(checkUpdate).toHaveBeenCalledTimes(1);
    expect(w.text()).toContain('1.2.3');
    expect(w.text()).toContain('둘째');
    expect(w.text()).not.toContain('숨긴 줄');
    expect(w.get('button').element.disabled).toBe(true);
    expect(installUpdate).not.toHaveBeenCalled();
    computing.value = null;
    await flushPromises();
    await w.get('button').trigger('click');
    expect(installUpdate).toHaveBeenCalledTimes(1);
    expect(w.get('progress').element.value).toBe(42);
    expect(computing.value).toBe('update');
  });
  it('계정 수집·정리 중에는 설치를, 설치 중에는 계정 작업을 시작할 수 없다', () => {
    expect(canStartWork('update', null, 'fetch')).toBe(false);
    expect(canStartWork('update', null, 'import')).toBe(false);
    expect(canStartWork('account', 'update', '')).toBe(false);
    expect(canStartWork('account', 'tier', '')).toBe(true);
  });
  it('설치 실패 뒤에 잠금을 풀고 새로 확인한 서명으로만 다시 설치한다', async () => {
    const first = { rid: 1, version: '1.2.3' };
    const refreshed = { rid: 2, version: '1.2.3' };
    vi.mocked(checkUpdate).mockResolvedValueOnce(first).mockResolvedValueOnce(refreshed);
    vi.mocked(installUpdate).mockRejectedValueOnce(new Error());
    const w = screen();
    await flushPromises();
    await w.get('button').trigger('click');
    await flushPromises();
    expect(computing.value).toBeNull();
    expect(w.text()).toContain('다시 시도');
    expect(w.text()).not.toContain('설치하고 다시 시작');
    await w.get('button').trigger('click');
    await flushPromises();
    expect(checkUpdate).toHaveBeenCalledTimes(2);
    expect(installUpdate).toHaveBeenCalledTimes(1);
    await w.get('button').trigger('click');
    expect(installUpdate).toHaveBeenNthCalledWith(1, first, expect.any(Function));
    expect(installUpdate).toHaveBeenNthCalledWith(2, refreshed, expect.any(Function));
  });
  it('확인 실패를 한국어로 알리고 다시 시도한다', async () => {
    vi.mocked(checkUpdate).mockRejectedValueOnce(new Error()).mockResolvedValueOnce(null);
    const w = screen();
    await flushPromises();
    expect(w.text()).toContain('다시 시도');
    await w.get('button').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('최신 판');
  });
});

it('설치판과 엔진 표식은 같은 앱 판을 쓴다', () => {
  // P-035: 판을 바꿀 때 세 파일을 맞추던 단언을 대신해 두 소비자가 앱 판을 어디서 받는지 확인한다.
  expect(conf.version).toBe('../package.json');
  expect(libRs).toMatch(/installed_engine\([^;]*app\.package_info\(\)\.version\.to_string\(\)/);
  expect(workflow).toContain('Get-Content -Raw app/package.json');
});

it('일반 제거에서 사용자가 데이터 삭제를 선택했을 때만 사용자 폴더를 지운다', () => {
  expect(hooks).toMatch(/!macro NSIS_HOOK_POSTUNINSTALL\s+\$\{If\} \$DeleteAppDataCheckboxState = 1\s+\$\{AndIf\} \$UpdateMode <> 1\s+SetShellVarContext current\s+\$\{If\} \$APPDATA != ""\s+RMDir \/r "\$APPDATA\\nikke-companion"\s+\$\{EndIf\}\s+\$\{EndIf\}\s+!macroend/);
});

it('설치 자원과 업데이트·서명 비밀의 출처를 제한한다', () => {
  expect(conf.plugins.updater.endpoints).toEqual(['https://github.com/RoastFried-RF/nikke-companion/releases/latest/download/latest.json']);
  expect(Object.keys(conf.plugins.updater).sort()).toEqual(['endpoints', 'pubkey']);
  expect(conf.bundle).toMatchObject({ active: true, targets: ['nsis'], createUpdaterArtifacts: true, windows: { allowDowngrades: false, nsis: { installMode: 'currentUser', installerHooks: 'src/installer.nsh' } } });
  expect(conf.bundle.windows.nsis.languages).toContain('Korean');
  for (const [src, dest] of Object.entries(conf.bundle.resources)) {
    expect(src + dest).not.toMatch(/\.git|session_cookie|profiles|__pycache__|data\/(?:accounts|captures)|\*\*/i);
    if (src.startsWith('../../extension/')) {
      expect(dest).toBe(src.slice('../../'.length));
      expect(dest).toMatch(/^extension\/(?:manifest\.json|popup\.(?:html|css|js)|lib\/[\w-]+\.js|README\.md)$/);
    } else {
      expect(src).toMatch(/(?:\.(?:py|webp|png|json)|\/LICENSE)$/);
      expect(dest).not.toMatch(/^extension\//);
    }
  }
  const actions = [...workflow.matchAll(/^\s*(?:-\s+)?uses:\s*(.+)$/gm)].map(match => match[1].trim());
  expect(actions).toHaveLength(4);
  for (const action of actions) expect(action).toMatch(/^[\w-]+\/[\w-]+@[a-f0-9]{40} # v\d+$/);
  expect(workflow).toContain('github.rest.repos.generateReleaseNotes(');
  expect(workflow).toContain('releaseBody: ${{ steps.notes.outputs.result }}');
  for (const key of ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD']) {
    const lines = workflow.split(/\r?\n/).filter(line => line.trim().startsWith(key + ':'));
    expect(lines.map(line => line.trim())).toEqual([key + ': ${{ secrets.' + key + ' }}']);
  }
});
