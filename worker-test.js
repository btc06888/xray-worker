// Minimal diagnostic worker: no cloudflare:sockets import.
// If this returns 200, the pipeline is fine and the sockets import was the problem.
export default {
  async fetch(request) {
    return new Response('OK-TEST', { status: 200 });
  },
};
