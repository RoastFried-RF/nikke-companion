// 테스트용 미리 불러오기(`node --import`): 이 프로세스가 네트워크를 쓰려 하면 곧바로 실패하게 만든다.
// 「--list는 네트워크를 쓰지 않는다」를 확인하는 데 쓴다(tests/unit/fetch-assets.test.mjs).
// tests/unit 밖에 둔다 — `node --test tests/unit/`가 이 파일을 테스트로 돌리지 않게.
import dns from 'node:dns';
import net from 'node:net';

const refuse = (what) => () => {
  console.error(`NETWORK-ATTEMPT: ${what}`);
  process.exit(97);
};

globalThis.fetch = refuse('fetch');
net.Socket.prototype.connect = refuse('net.Socket.connect');
dns.lookup = refuse('dns.lookup');
dns.promises.lookup = refuse('dns.promises.lookup');
