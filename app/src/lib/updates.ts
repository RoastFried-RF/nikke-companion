import { computed, inject, provide, ref, type Ref, type InjectionKey } from 'vue';
import { checkUpdate, installUpdate, updateMode, type AvailableUpdate } from './backend';
import { recall, remember } from './remember';
import { version } from '../../package.json';

type Phase = 'loading' | 'development' | 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'failed';
export type AccountWork = '' | 'cookie' | 'login' | 'take' | 'clear' | 'claim' | 'fetch' | 'import';

/** 계정 받기와 계산은 각자의 자리를 쓰고, 앱을 끝내는 설치는 두 자리가 모두 빌 때만 시작한다. */
export function canStartWork(work: 'update' | 'account', engineOwner: string | null, accountWork: AccountWork): boolean {
  return accountWork === '' && (work === 'update' ? engineOwner === null : engineOwner !== 'update');
}

export function createUpdates(engineOwner: Ref<string | null>) {
  const phase = ref<Phase>('loading');
  const automatic = ref(recall('auto-update') !== 'off');
  const available = ref<AvailableUpdate | null>(null);
  const bytes = ref(0);
  const total = ref<number>();
  const enabled = ref(false);
  const accountWork = ref<AccountWork>('');
  const canStartAccount = computed(() => canStartWork('account', engineOwner.value, accountWork.value));
  const canInstall = computed(() => available.value !== null && phase.value === 'available'
    && canStartWork('update', engineOwner.value, accountWork.value));
  function setAutomatic(value: boolean) {
    automatic.value = value;
    remember('auto-update', value ? 'on' : 'off');
  }
  async function check(atStartup = false) {
    if (available.value || !['loading', 'idle', 'latest', 'failed'].includes(phase.value)) return;
    phase.value = 'checking';
    try {
      if (!enabled.value) enabled.value = await updateMode();
      if (!enabled.value) {
        phase.value = 'development';
        return;
      }
      if (atStartup && !automatic.value) {
        phase.value = 'idle';
        return;
      }
      available.value = await checkUpdate();
      phase.value = available.value ? 'available' : 'latest';
    } catch {
      phase.value = 'failed';
    }
  }
  const start = () => check(true);
  async function install() {
    if (!canInstall.value || !available.value) return;
    engineOwner.value = 'update';
    phase.value = 'downloading';
    bytes.value = 0;
    total.value = undefined;
    try {
      await installUpdate(available.value, (received, size) => {
        bytes.value = received;
        total.value = size;
      });
    } catch {
      available.value = null;
      phase.value = 'failed';
      engineOwner.value = null;
    }
  }
  return { version, automatic, phase, available, bytes, total, accountWork, canStartAccount, canInstall, setAutomatic, start, check, install };
}
const key: InjectionKey<ReturnType<typeof createUpdates>> = Symbol('updates');
export function provideUpdates(engineOwner: Ref<string | null>) {
  const updates = createUpdates(engineOwner);
  provide(key, updates);
  return updates;
}
export const useUpdates = () => inject(key, null);
