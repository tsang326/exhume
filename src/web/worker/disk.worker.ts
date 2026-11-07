import { transferablesOf } from '../logic/requests';
import { createSession, handleRequest } from './disk-handler';

const session = createSession();

self.onmessage = (e: MessageEvent<unknown>) => {
  const res = handleRequest(session, e.data);
  self.postMessage(res, transferablesOf(res));
};
