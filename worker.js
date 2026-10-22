// A/B test: keep ONLY the cloudflare:sockets import, trivial fetch handler.
// If this 1101s -> the import itself is broken. If 200 -> import is fine.
import { connect } from 'cloudflare:sockets';

export default {
  async fetch(request) {
    return new Response('IMPORT-OK', { status: 200 });
  },
};
