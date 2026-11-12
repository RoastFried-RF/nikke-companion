// 계정 화면이 저장한 계정 파일의 경로를 다른 화면(추천·비교, 요격전, 성장)의 계정 칸에 넣는 통로.
// 앱(App.vue)이 하나 만들어 내려 주고, 계정 칸을 가진 화면이 「경로를 받으면 내 칸에 넣는다」를 걸어 둔다.
// 아직 한 번도 열지 않은 화면은 열릴 때 기억해 둔 경로(lib/remember.ts)에서 같은 값을 읽는다.
//
// 넣는 것은 경로뿐이다 — 계산을 시작하지 않는다(실행은 사용자가 누른다).

import { inject, onScopeDispose, provide, type InjectionKey } from 'vue';
import { remember } from './remember';

/** 계정 칸을 기억하는 이름들(각 화면이 처음 열릴 때 읽는 이름과 같아야 한다). */
export const ACCOUNT_PATH_KEYS = ['compute.account', 'intercept.account', 'growth.account'] as const;

type Receiver = (path: string) => void;

export interface AccountLink {
  /** 저장한 계정 파일의 경로를 모든 계정 칸에 넣는다. 받은 화면의 수를 돌려준다. */
  adopt(path: string): number;
  /** 계정 칸을 가진 화면이 받는 쪽을 건다. 돌려받은 함수로 뗀다. */
  listen(receiver: Receiver): () => void;
}

const ACCOUNT_LINK: InjectionKey<AccountLink> = Symbol('account-link');

export function provideAccountLink(): AccountLink {
  const receivers = new Set<Receiver>();
  const link: AccountLink = {
    adopt(path) {
      const target = path.trim();
      if (!target) return 0;
      // 아직 열지 않은 화면과 다음 실행을 위해 기억해 둔다. 저장하지 못해도 열려 있는 칸에는 들어간다.
      for (const key of ACCOUNT_PATH_KEYS) remember(key, target);
      for (const receive of receivers) receive(target);
      return receivers.size;
    },
    listen(receiver) {
      receivers.add(receiver);
      return () => receivers.delete(receiver);
    },
  };
  provide(ACCOUNT_LINK, link);
  return link;
}

/** 계정 화면이 쓴다. 앱 밖에서(화면 하나만 띄운 테스트 등) 쓰면 null. */
export function useAccountLink(): AccountLink | null {
  return inject(ACCOUNT_LINK, null);
}

/**
 * 계정 칸을 가진 화면이 부른다: 계정 화면이 계정 파일을 저장하면 `receive`가 그 경로와 함께 불린다.
 * 화면이 사라지면 저절로 떼어진다. 앱 밖에서는 아무 일도 하지 않는다.
 */
export function onAccountAdopted(receive: Receiver): void {
  const link = inject(ACCOUNT_LINK, null);
  if (!link) return;
  onScopeDispose(link.listen(receive));
}
